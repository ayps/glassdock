// Decides when the dock opens and closes.
//
// Opening works like an iPad's Dock with a mouse: resting the pointer at the top
// of the screen does nothing (so Chrome's tabs and the search box work as usual).
// Pushing on, past the top edge, slides a thin glass lip out of the top centre;
// push a little more and the dock springs open. Stop early, click or type, and
// the lip pulls back. Ctrl + Alt + Space opens or closes the dock from anywhere.
//
// The dock closes once the pointer has left it for a moment.

use std::{
    sync::Arc,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

use crate::{capture, platform, rawin, Shared};

/// Width of the strip along the top edge where pushing counts, as a share of the monitor width.
const ZONE_SHARE: f64 = 0.4;
/// Default distance to push past the edge to open the dock, in mouse counts.
/// The page can change it (Push distance: short / medium / long).
const PUSH_DEFAULT: f64 = 70.0;
/// A fast throw at the top edge carries on for a moment after the pointer stops.
/// Movement in the poll that reaches the edge doesn't count, and push in this
/// short window after arriving only counts a quarter.
const SETTLE_MS: u64 = 140;
/// Stop pushing for this long and the lip starts pulling back.
const RELAX_MS: u64 = 450;
/// Fallback when pushing can't be measured (pen, touch screen, remote desktop):
/// hold the pointer still at the top this long.
const DWELL_FALLBACK_MS: u64 = 650;
/// How long the pointer may be away from the dock before it closes (ms).
const AWAY_MS: u64 = 450;
/// Opened with the keyboard: stays open this long even if the pointer never comes.
const KEY_OPEN_MS: u64 = 6000;
const POLL_MS: u64 = 16;
const POLL_IDLE_MS: u64 = 40;

/// The lip window's size in logical px (the lip itself is drawn smaller inside it).
const LIP_W: f64 = 320.0;
const LIP_H: f64 = 50.0;
/// Height of the screen strip captured for the frosted glass (logical px):
/// the gap above the dock + the dock + the blur's bleed below it.
const BACKDROP_H: f64 = 4.0 + 100.0 + 60.0;

#[derive(Clone, Copy, Debug)]
pub struct Mon {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
}

pub struct DockState {
    pub visible: bool,
    /// A panel is open for typing: don't close when the pointer wanders off.
    pub hold: bool,
    pub hiding: bool,
    pub logical_w: f64,
    pub logical_h: f64,
    pub monitor: Option<Mon>,
    /// Opened with the keyboard: don't close before this time unless the pointer visits and leaves.
    pub key_open_until: Option<Instant>,
    /// Colour of the meeting heads-up glow on the closed lip, or None.
    pub alert: Option<String>,
    /// "dark" or "light", to match the dock.
    pub theme: String,
    /// Keep the dock out of screen sharing, recordings and screenshots.
    pub private: bool,
    /// How far to push past the top edge (mouse counts). Doubled over full-screen apps.
    pub push_need: f64,
}

impl Default for DockState {
    fn default() -> Self {
        Self {
            visible: false,
            hold: false,
            hiding: false,
            logical_w: 1880.0,
            logical_h: 160.0,
            monitor: None,
            key_open_until: None,
            alert: None,
            theme: "dark".into(),
            private: true,
            push_need: PUSH_DEFAULT,
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct ShowPayload {
    width: f64, // monitor size in logical px
    height: f64,
    scale: f64,
    /// Picture of the screen behind the dock, for the frosted glass.
    backdrop: Option<capture::Backdrop>,
}

#[derive(Clone, serde::Serialize, PartialEq)]
struct LipPayload {
    /// 0 = hidden, up to 1 = about to open.
    p: f64,
    alert: Option<String>,
    theme: String,
}

fn monitors(app: &AppHandle) -> Vec<Mon> {
    app.available_monitors()
        .map(|list| {
            list.iter()
                .map(|m| Mon {
                    x: m.position().x,
                    y: m.position().y,
                    w: m.size().width,
                    h: m.size().height,
                    scale: m.scale_factor(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The main display (where the meeting glow appears until the pointer visits another one).
fn primary(app: &AppHandle) -> Option<Mon> {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|m| Mon { x: m.position().x, y: m.position().y, w: m.size().width, h: m.size().height, scale: m.scale_factor() })
        .or_else(|| monitors(app).first().copied())
}

fn monitor_at(app: &AppHandle, px: f64, py: f64) -> Option<Mon> {
    let all = monitors(app);
    all.iter()
        .copied()
        .find(|m| px >= m.x as f64 && px < m.x as f64 + m.w as f64 && py >= m.y as f64 && py < m.y as f64 + m.h as f64)
        .or_else(|| all.first().copied())
}

fn in_hot_zone(m: &Mon, px: f64, py: f64) -> bool {
    let left = m.x as f64 + m.w as f64 * (1.0 - ZONE_SHARE) / 2.0;
    let right = left + m.w as f64 * ZONE_SHARE;
    let top = m.y as f64;
    py >= top && py <= top + 1.0 && px >= left && px <= right
}

/// Centre the window at the top of monitor `m`, sized to what the page asked for.
pub fn place(app: &AppHandle, shared: &Arc<Shared>, m: Mon) {
    let Some(win) = app.get_webview_window("dock") else { return };
    let (lw, lh) = {
        let s = shared.dock.lock().unwrap();
        (s.logical_w, s.logical_h)
    };
    let pw = (lw * m.scale).round().min(m.w as f64);
    let ph = (lh * m.scale).round();
    let x = m.x as f64 + (m.w as f64 - pw) / 2.0;
    let _ = win.set_size(PhysicalSize::new(pw as u32, ph as u32));
    let _ = win.set_position(PhysicalPosition::new(x.round() as i32, m.y));
}

// ------------------------------------------------------------------ the lip

struct Lip {
    shown: bool,
    last: Option<LipPayload>,
    mon: Option<Mon>,
}

impl Lip {
    /// Show the lip at `p` (0..1) on monitor `m`, or the heads-up glow, or nothing.
    fn set(&mut self, app: &AppHandle, shared: &Arc<Shared>, p: f64, m: Option<Mon>) {
        let (alert, theme, visible) = {
            let s = shared.dock.lock().unwrap();
            (s.alert.clone(), s.theme.clone(), s.visible)
        };
        let alert = if visible { None } else { alert };
        let p = (p * 50.0).round() / 50.0; // fewer, chunkier updates
        let payload = LipPayload { p, alert: alert.clone(), theme };
        let want = p > 0.0 || alert.is_some();
        let Some(win) = app.get_webview_window("lip") else { return };
        let target = m.or(self.mon).or_else(|| primary(app));
        if want {
            if let Some(m) = target {
                if self.mon.map(|o| o.x != m.x || o.y != m.y).unwrap_or(true) || !self.shown {
                    let pw = (LIP_W * m.scale).round();
                    let ph = (LIP_H * m.scale).round();
                    let x = m.x as f64 + (m.w as f64 - pw) / 2.0;
                    let _ = win.set_size(PhysicalSize::new(pw as u32, ph as u32));
                    let _ = win.set_position(PhysicalPosition::new(x.round() as i32, m.y));
                    self.mon = Some(m);
                }
            }
        }
        if self.last.as_ref() != Some(&payload) {
            let _ = win.emit("lip:state", payload.clone());
            self.last = Some(payload);
        }
        if want && !self.shown {
            platform::show_without_focus(&win);
            self.shown = true;
        } else if !want && self.shown {
            platform::hide_window(&win);
            self.shown = false;
        }
    }

    /// Hide at once (the dock is about to open over it).
    fn hide_now(&mut self, app: &AppHandle) {
        if let Some(win) = app.get_webview_window("lip") {
            if self.shown {
                platform::hide_window(&win);
            }
            let _ = win.emit("lip:state", LipPayload { p: 0.0, alert: None, theme: String::new() });
        }
        self.shown = false;
        self.last = None;
    }
}

// ------------------------------------------------------------------ open / close

fn show(app: &AppHandle, shared: &Arc<Shared>, m: Mon, lip: &mut Lip) {
    // The lip must be gone before the screen behind the dock is captured.
    let lip_was_up = lip.shown;
    lip.hide_now(app);
    if lip_was_up {
        thread::sleep(Duration::from_millis(30));
    }
    let backdrop = {
        let w = m.w as i32;
        let h = ((BACKDROP_H * m.scale).round() as i32).min(m.h as i32);
        capture::grab(m.x, m.y, w, h, m.scale)
    };
    {
        let mut s = shared.dock.lock().unwrap();
        s.visible = true;
        s.hiding = false;
        s.monitor = Some(m);
    }
    place(app, shared, m);
    let _ = app.emit(
        "dock:show",
        ShowPayload { width: m.w as f64 / m.scale, height: m.h as f64 / m.scale, scale: m.scale, backdrop },
    );
    if let Some(win) = app.get_webview_window("dock") {
        platform::show_without_focus(&win);
    }
}

fn begin_hide(app: &AppHandle, shared: &Arc<Shared>) {
    {
        let mut s = shared.dock.lock().unwrap();
        s.hiding = true;
        s.key_open_until = None;
    }
    let _ = app.emit("dock:hide", ());
    // If the page never answers (e.g. it is reloading), hide anyway.
    let (app2, shared2) = (app.clone(), shared.clone());
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(700));
        if shared2.dock.lock().unwrap().hiding {
            finish_hide(&app2, &shared2);
        }
    });
}

pub fn finish_hide(app: &AppHandle, shared: &Arc<Shared>) {
    {
        let mut s = shared.dock.lock().unwrap();
        if !s.hiding {
            return;
        }
        s.visible = false;
        s.hiding = false;
        s.hold = false;
    }
    if let Some(win) = app.get_webview_window("dock") {
        platform::hide_window(&win);
    }
}

/// The pointer is over the window (plus a little slack, so a fast exit
/// along the edge doesn't close it).
fn pointer_on_dock(app: &AppHandle, px: f64, py: f64, scale: f64) -> bool {
    let Some(win) = app.get_webview_window("dock") else { return false };
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else { return false };
    let slack = 16.0 * scale;
    let (x, y) = (pos.x as f64, pos.y as f64);
    px >= x - slack
        && px <= x + size.width as f64 + slack
        && py >= y - slack
        && py <= y + size.height as f64 + slack
}

// ------------------------------------------------------------------ keyboard shortcut

/// Requests from the shortcut handler to the watcher thread.
static TOGGLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Ctrl + Alt + Space was pressed.
pub fn toggle_from_keyboard() {
    TOGGLE.store(true, std::sync::atomic::Ordering::SeqCst);
}

// ------------------------------------------------------------------ the watcher

pub fn start(app: AppHandle, shared: Arc<Shared>) {
    rawin::start();
    if let Some(w) = app.get_webview_window("lip") {
        // Clicks pass straight through to your app. (Set before prepare_window, which
        // must come last: changing this rewrites the window's style flags.)
        let _ = w.set_ignore_cursor_events(true);
        platform::prepare_window(&w);
        platform::exclude_from_capture(&w, true);
    }
    thread::spawn(move || {
        let mut lip = Lip { shown: false, last: None, mon: None };
        let mut push = 0.0_f64;
        let mut arrived: Option<Instant> = None; // when the pointer reached the top edge
        let mut last_push = Instant::now();
        let mut cancelled = false; // a click or key press cancelled this visit to the edge
        let mut still: Option<(Instant, f64, f64)> = None; // for the fallback
        let mut away: Option<Instant> = None;
        let mut visited = false; // pointer has been on the dock since it opened
        loop {
            let in_zone_now = arrived.is_some();
            thread::sleep(Duration::from_millis(if in_zone_now || lip.shown { POLL_MS } else { POLL_IDLE_MS }));
            let input = rawin::take();
            let Ok(p) = app.cursor_position() else { continue };
            let (visible, hiding, hold, mon, key_until) = {
                let s = shared.dock.lock().unwrap();
                (s.visible, s.hiding, s.hold, s.monitor, s.key_open_until)
            };

            // Keyboard shortcut: open on the monitor under the pointer, or close.
            if TOGGLE.swap(false, std::sync::atomic::Ordering::SeqCst) {
                if visible && !hiding {
                    begin_hide(&app, &shared);
                } else if !visible {
                    if let Some(m) = monitor_at(&app, p.x, p.y) {
                        show(&app, &shared, m, &mut lip);
                        shared.dock.lock().unwrap().key_open_until =
                            Some(Instant::now() + Duration::from_millis(KEY_OPEN_MS));
                        visited = false;
                        away = None;
                    }
                }
                push = 0.0;
                continue;
            }

            if !visible {
                let zone = monitors(&app).into_iter().find(|m| in_hot_zone(m, p.x, p.y));
                let Some(m) = zone else {
                    // Left the edge: reset, and let the lip show only the heads-up glow (if any).
                    arrived = None;
                    cancelled = false;
                    still = None;
                    push = 0.0;
                    lip.set(&app, &shared, 0.0, None);
                    continue;
                };
                let now = Instant::now();
                let first = arrived.is_none();
                let t0 = *arrived.get_or_insert(now);
                if input.clicked || input.key || platform::mouse_button_down() {
                    cancelled = true; // using the app at the top: stay out of the way until the pointer leaves
                }
                if cancelled || platform::presentation_mode() {
                    push = 0.0;
                    lip.set(&app, &shared, 0.0, Some(m));
                    continue;
                }
                let base = shared.dock.lock().unwrap().push_need;
                let need = if platform::fullscreen_app_running() { base * 2.0 } else { base };

                if rawin::push_available() {
                    let mut up = input.up as f64;
                    if first {
                        up = 0.0; // this movement carried the pointer to the edge; it isn't a push
                    } else if now.duration_since(t0) < Duration::from_millis(SETTLE_MS) {
                        up *= 0.25; // the tail end of a fast throw, not a push
                    }
                    if up > 0.0 {
                        push += up;
                        last_push = now;
                    } else if now.duration_since(last_push) > Duration::from_millis(RELAX_MS) {
                        push *= 0.9; // stopped pushing: pull back gently
                        if push < 4.0 {
                            push = 0.0;
                        }
                    }
                    if push >= need {
                        push = 0.0;
                        arrived = None;
                        show(&app, &shared, m, &mut lip);
                        visited = false;
                        away = None;
                    } else {
                        lip.set(&app, &shared, push / need, Some(m));
                    }
                } else {
                    // Can't measure pushing: open after holding the pointer still at the top.
                    let moved = still.map(|(_, x, y)| (x - p.x).abs() > 2.0 || (y - p.y).abs() > 2.0).unwrap_or(true);
                    if moved {
                        still = Some((now, p.x, p.y));
                    }
                    let held = still.map(|(t, _, _)| now.duration_since(t)).unwrap_or_default();
                    let k = held.as_millis() as f64 / DWELL_FALLBACK_MS as f64;
                    if k >= 1.0 {
                        still = None;
                        arrived = None;
                        show(&app, &shared, m, &mut lip);
                        visited = false;
                        away = None;
                    } else {
                        lip.set(&app, &shared, k * 0.8, Some(m));
                    }
                }
            } else if hold {
                away = None;
            } else if !hiding {
                let scale = mon.map(|m| m.scale).unwrap_or(1.0);
                if pointer_on_dock(&app, p.x, p.y, scale) {
                    away = None;
                    visited = true;
                } else if !visited && key_until.map(|t| Instant::now() < t).unwrap_or(false) {
                    away = None; // opened from the keyboard; give the pointer time to get there
                } else {
                    let t = *away.get_or_insert_with(Instant::now);
                    if t.elapsed() >= Duration::from_millis(AWAY_MS) {
                        away = None;
                        begin_hide(&app, &shared);
                    }
                }
            }
        }
    });
}

/// The page changed the heads-up glow, theme or privacy setting.
pub fn set_style(app: &AppHandle, shared: &Arc<Shared>, alert: Option<String>, theme: String, private: bool, push: f64) {
    {
        let mut s = shared.dock.lock().unwrap();
        s.push_need = push.clamp(30.0, 1000.0);
        s.alert = alert;
        s.theme = theme;
        s.private = private;
    }
    if let Some(w) = app.get_webview_window("dock") {
        platform::exclude_from_capture(&w, private);
    }
}

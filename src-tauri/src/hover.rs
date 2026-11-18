// Opens the dock when the pointer rests in the top-middle of any monitor, and
// closes it once the pointer has left the dock for a moment.

use std::{
    sync::Arc,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

use crate::{platform, Shared};

/// Width of the hot zone, as a share of the monitor width, centred.
const ZONE_SHARE: f64 = 0.4;
/// How long the pointer must rest in the zone (ms). Longer over full-screen apps,
/// so a game or a video never pops the dock by accident.
const DWELL_MS: u64 = 250;
const DWELL_FULLSCREEN_MS: u64 = 900;
/// How long the pointer may be away from the dock before it closes (ms).
const AWAY_MS: u64 = 450;
const POLL_MS: u64 = 40;

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
}

impl Default for DockState {
    fn default() -> Self {
        Self { visible: false, hold: false, hiding: false, logical_w: 1880.0, logical_h: 160.0, monitor: None }
    }
}

#[derive(Clone, serde::Serialize)]
struct ShowPayload {
    width: f64, // monitor size in logical px
    height: f64,
    scale: f64,
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

fn show(app: &AppHandle, shared: &Arc<Shared>, m: Mon) {
    {
        let mut s = shared.dock.lock().unwrap();
        s.visible = true;
        s.hiding = false;
        s.monitor = Some(m);
    }
    place(app, shared, m);
    let _ = app.emit(
        "dock:show",
        ShowPayload { width: m.w as f64 / m.scale, height: m.h as f64 / m.scale, scale: m.scale },
    );
    if let Some(win) = app.get_webview_window("dock") {
        platform::show_without_focus(&win);
    }
}

fn begin_hide(app: &AppHandle, shared: &Arc<Shared>) {
    shared.dock.lock().unwrap().hiding = true;
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

pub fn start(app: AppHandle, shared: Arc<Shared>) {
    thread::spawn(move || {
        let mut dwell: Option<(Instant, i32)> = None; // when, and which monitor (by x)
        let mut away: Option<Instant> = None;
        loop {
            thread::sleep(Duration::from_millis(POLL_MS));
            let Ok(p) = app.cursor_position() else { continue };
            let (visible, hiding, hold, mon) = {
                let s = shared.dock.lock().unwrap();
                (s.visible, s.hiding, s.hold, s.monitor)
            };

            if !visible {
                // Not while dragging: dragging a window to the top opens Snap Layouts.
                let hot = if platform::mouse_button_down() {
                    None
                } else {
                    monitors(&app).into_iter().find(|m| in_hot_zone(m, p.x, p.y))
                };
                match hot {
                    Some(m) => {
                        let need = if platform::fullscreen_app_running() { DWELL_FULLSCREEN_MS } else { DWELL_MS };
                        let start = match dwell {
                            Some((t, mx)) if mx == m.x => t,
                            _ => {
                                let t = Instant::now();
                                dwell = Some((t, m.x));
                                t
                            }
                        };
                        if start.elapsed() >= Duration::from_millis(need) {
                            dwell = None;
                            away = None;
                            show(&app, &shared, m);
                        }
                    }
                    None => dwell = None,
                }
            } else if hold {
                away = None;
            } else if !hiding {
                let scale = mon.map(|m| m.scale).unwrap_or(1.0);
                if pointer_on_dock(&app, p.x, p.y, scale) {
                    away = None;
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

// GlassDock's native side.
//
// The page (src/) draws the dock. This side does what a web page can't:
// watches the pointer across all monitors, places and shows the window,
// reads the wallpaper and the hardware statistics.

mod accent;
mod capture;
mod claude;
mod github;
mod google;
mod hover;
mod media;
mod platform;
mod rawin;
mod recycle;
mod stats;
mod store;
mod wall;

use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub struct Shared {
    pub dock: Mutex<hover::DockState>,
    pub stats: Mutex<stats::Stats>,
    pub google: google::Google,
    pub github: github::GitHub,
    pub claude: claude::Live,
    /// GlassDock's settings folder (also where Claude usage is saved).
    pub dir: std::path::PathBuf,
}

/// The page reports the size it needs (logical px) after laying out the cards.
#[tauri::command]
fn set_dock_size(app: tauri::AppHandle, shared: State<'_, Arc<Shared>>, width: f64, height: f64) {
    let mon = {
        let mut s = shared.dock.lock().unwrap();
        s.logical_w = width;
        s.logical_h = height;
        s.monitor
    };
    if let Some(m) = mon {
        hover::place(&app, &shared, m);
    }
}

/// The page finished its slide-out animation.
#[tauri::command]
fn hide_done(app: tauri::AppHandle, shared: State<'_, Arc<Shared>>) {
    hover::finish_hide(&app, &shared);
}

#[tauri::command]
fn get_wallpaper() -> Result<wall::WallInfo, String> {
    wall::read()
}

#[tauri::command]
fn system_stats(shared: State<'_, Arc<Shared>>) -> stats::Snapshot {
    shared.stats.lock().unwrap().snapshot()
}

/// What's playing right now. `art_key` is the track the page already has artwork
/// for; artwork is only sent again when the track changes.
#[tauri::command]
async fn media_now(art_key: Option<String>) -> Option<media::NowPlaying> {
    media::now_playing(art_key.as_deref())
}

#[tauri::command]
async fn media_action(action: String) -> bool {
    media::action(&action)
}

/// A panel opened (`on`) or closed: take keyboard focus, or give it back.
#[tauri::command]
fn panel_focus(app: tauri::AppHandle, on: bool) {
    if let Some(w) = app.get_webview_window("dock") {
        if on {
            platform::take_focus(&w);
        } else {
            platform::release_focus(&w);
        }
    }
}

/// Keep the dock open even if the pointer leaves (while typing, or during a sign-in).
#[tauri::command]
fn set_hold(shared: State<'_, Arc<Shared>>, hold: bool) {
    shared.dock.lock().unwrap().hold = hold;
}

#[tauri::command]
fn open_url(url: String) {
    if url.starts_with("https://") {
        google::open_url(&url);
    }
}

#[tauri::command]
fn google_status(shared: State<'_, Arc<Shared>>) -> google::Status {
    shared.google.status()
}

#[tauri::command]
fn google_set_client(shared: State<'_, Arc<Shared>>, json: String) -> Result<(), String> {
    shared.google.set_client(&json)
}

#[tauri::command]
async fn google_sign_in(shared: State<'_, Arc<Shared>>) -> Result<String, String> {
    shared.google.sign_in().await
}

#[tauri::command]
async fn google_sign_out(shared: State<'_, Arc<Shared>>, email: String) -> Result<(), String> {
    shared.google.sign_out(&email).await;
    Ok(())
}

#[tauri::command]
async fn google_api(
    shared: State<'_, Arc<Shared>>,
    email: String,
    method: String,
    url: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    shared.google.api(&email, &method, &url, body).await
}

#[tauri::command]
async fn github_status(shared: State<'_, Arc<Shared>>) -> Result<Option<String>, String> {
    Ok(shared.github.login().await)
}

#[tauri::command]
async fn github_set_token(shared: State<'_, Arc<Shared>>, token: String) -> Result<String, String> {
    shared.github.set_token(&token).await
}

#[tauri::command]
fn github_clear(shared: State<'_, Arc<Shared>>) {
    shared.github.clear();
}

#[tauri::command]
async fn github_query(
    shared: State<'_, Arc<Shared>>,
    query: String,
    variables: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    shared.github.query(&query, variables.unwrap_or(serde_json::json!({}))).await
}

#[derive(serde::Serialize)]
struct ClaudeUsage {
    configured: bool,
    /// "ok", "no_login" (Claude Code isn't signed in here), "expired", or an error.
    live: String,
    data: serde_json::Value,
}

/// Plan usage: straight from Anthropic when Claude Code is signed in on this PC,
/// otherwise the last numbers Claude Code's status line saved.
#[tauri::command]
async fn claude_usage(shared: State<'_, Arc<Shared>>) -> Result<ClaudeUsage, String> {
    let live = shared.claude.get().await;
    let (data, live_status) = match live {
        Ok(v) => (v, "ok".to_string()),
        Err(e) => (claude::usage(&shared.dir), e),
    };
    Ok(ClaudeUsage { configured: claude::configured() || live_status == "ok", live: live_status, data })
}

#[tauri::command]
fn claude_setup(shared: State<'_, Arc<Shared>>, replace: bool) -> Result<(), String> {
    claude::setup(&shared.dir, replace)
}

#[tauri::command]
fn system_accent() -> Option<accent::Accent> {
    accent::read()
}

#[tauri::command]
fn recycle_bin() -> Option<recycle::Bin> {
    recycle::query()
}

#[tauri::command]
fn recycle_empty() -> Result<(), String> {
    recycle::empty()
}

#[tauri::command]
fn recycle_open() {
    recycle::open();
}

/// Saved settings (settings.json), or null on first run.
#[tauri::command]
fn settings_load(shared: State<'_, Arc<Shared>>) -> Option<String> {
    store::load(&shared.dir)
}

#[tauri::command]
fn settings_save(shared: State<'_, Arc<Shared>>, json: String) -> Result<(), String> {
    store::save(&shared.dir, &json)
}

/// Meeting heads-up glow on the lip (a CSS colour, or none), the dock theme,
/// and whether to keep the dock out of screen sharing and screenshots.
#[tauri::command]
fn set_lip_style(
    app: tauri::AppHandle,
    shared: State<'_, Arc<Shared>>,
    alert: Option<String>,
    theme: String,
    private: bool,
    push: f64,
) {
    hover::set_style(&app, &shared, alert, theme, private, push);
}

/// A newer GlassDock on GitHub Releases, if there is one (its version number).
#[tauri::command]
async fn update_check(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().ok()?.check().await.ok()??;
    Some(update.version)
}

/// Download and install the update, then restart.
#[tauri::command]
async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("You're on the latest version.")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

pub fn run() {
    tauri::Builder::default()
        // "Start with Windows": adds GlassDock to Windows' startup list, like Discord does.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        // Ctrl + Alt + Space opens or closes the dock from anywhere.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|_app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        hover::toggle_from_keyboard();
                    }
                })
                .build(),
        )
        // Updates from GitHub Releases (signed; see docs/RELEASING.md).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir().join("GlassDock"));
            let shared = Arc::new(Shared {
                dock: Mutex::new(hover::DockState::default()),
                stats: Mutex::new(stats::Stats::new()),
                google: google::Google::new(dir.clone()),
                github: github::GitHub::new(),
                claude: claude::Live::default(),
                dir,
            });
            app.manage(shared.clone());
            if let Some(w) = app.get_webview_window("dock") {
                platform::prepare_window(&w);
            }
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                // Another app may already own this combination; the dock still works by pushing.
                let _ = app
                    .global_shortcut()
                    .register(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space));
            }
            hover::start(app.handle().clone(), shared);
            wall::watch(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_dock_size, hide_done, get_wallpaper, system_stats, media_now, media_action,
            panel_focus, set_hold, open_url, google_status, google_set_client, google_sign_in, google_sign_out, google_api,
            github_status, github_set_token, github_clear, github_query, claude_usage, claude_setup, system_accent,
            recycle_bin, recycle_empty, recycle_open, settings_load, settings_save, set_lip_style, update_check,
            update_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running GlassDock");
}

// Whatever is playing in Windows (Spotify, browsers, Apple Music, Media Player...),
// read through Windows' own media controls: the same source as the volume flyout.
// Not every app reports every detail, so each field may be missing.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    /// Identifies the track; the page uses it to know when the artwork changes.
    key: String,
    title: String,
    artist: String,
    app: String,
    playing: bool,
    can_prev: bool,
    can_next: bool,
    can_toggle: bool,
    /// Seconds; None when the app doesn't report a timeline.
    position: Option<f64>,
    duration: Option<f64>,
    /// data: URL of the album art, only when the track changed.
    art: Option<String>,
}

/// "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" -> "Spotify", "msedge.exe" -> "Msedge".
#[allow(dead_code)]
fn app_name(aumid: &str) -> String {
    let s = aumid.rsplit('!').next().unwrap_or(aumid);
    let s = s.trim_end_matches(".exe").trim_end_matches(".EXE");
    let s = s.rsplit(['.', '\\']).next().unwrap_or(s);
    let known = [("msedge", "Edge"), ("chrome", "Chrome"), ("firefox", "Firefox"), ("zunemusic", "Media Player")];
    for (k, v) in known {
        if s.to_lowercase().contains(k) {
            return v.to_string();
        }
    }
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

#[cfg(windows)]
mod imp {
    use super::{app_name, NowPlaying};
    use base64::Engine;
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows::core::Result;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    fn session() -> Option<Session> {
        // Each command runs on a worker thread; make sure it can use Windows Runtime.
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let mgr = Manager::RequestAsync().ok()?.get().ok()?;
        mgr.GetCurrentSession().ok()
    }

    /// Windows times are in 100-nanosecond ticks.
    const TICKS: f64 = 10_000_000.0;

    fn art(s: &Session) -> Result<String> {
        let props = s.TryGetMediaPropertiesAsync()?.get()?;
        let stream = props.Thumbnail()?.OpenReadAsync()?.get()?;
        let size = stream.Size()? as u32;
        let ctype = stream.ContentType()?.to_string();
        let reader = DataReader::CreateDataReader(&stream)?;
        reader.LoadAsync(size)?.get()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf)?;
        let ctype = if ctype.starts_with("image/") { ctype } else { "image/jpeg".into() };
        Ok(format!("data:{};base64,{}", ctype, base64::engine::general_purpose::STANDARD.encode(buf)))
    }

    pub fn now_playing(art_key: Option<&str>) -> Option<NowPlaying> {
        let s = session()?;
        let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();
        if title.is_empty() && artist.is_empty() {
            return None;
        }
        let app = s.SourceAppUserModelId().map(|h| app_name(&h.to_string())).unwrap_or_default();
        let key = format!("{title}\u{1f}{artist}\u{1f}{album}");

        let info = s.GetPlaybackInfo().ok()?;
        let playing = info.PlaybackStatus().map(|st| st == Status::Playing).unwrap_or(false);
        let ctl = info.Controls().ok();
        let flag = |f: &dyn Fn(&windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackControls) -> Result<bool>| {
            ctl.as_ref().and_then(|c| f(c).ok()).unwrap_or(false)
        };

        // Position is reported as of LastUpdatedTime; move it forward while playing.
        let (mut position, mut duration) = (None, None);
        if let Ok(tl) = s.GetTimelineProperties() {
            let start = tl.StartTime().map(|t| t.Duration).unwrap_or(0) as f64 / TICKS;
            let end = tl.EndTime().map(|t| t.Duration).unwrap_or(0) as f64 / TICKS;
            let dur = end - start;
            if dur > 1.0 && dur < 6.0 * 3600.0 {
                let mut pos = tl.Position().map(|t| t.Duration).unwrap_or(0) as f64 / TICKS - start;
                if playing {
                    if let Ok(upd) = tl.LastUpdatedTime() {
                        // DateTime counts from 1601; Unix time from 1970.
                        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
                            + 11_644_473_600.0;
                        let since = now - upd.UniversalTime as f64 / TICKS;
                        if since > 0.0 && since < dur {
                            pos += since;
                        }
                    }
                }
                position = Some(pos.clamp(0.0, dur));
                duration = Some(dur);
            }
        }

        let art = if art_key == Some(key.as_str()) { None } else { art(&s).ok() };
        Some(NowPlaying {
            key,
            title,
            artist,
            app,
            playing,
            can_prev: flag(&|c| c.IsPreviousEnabled()),
            can_next: flag(&|c| c.IsNextEnabled()),
            can_toggle: flag(&|c| c.IsPlayPauseToggleEnabled()),
            position,
            duration,
            art,
        })
    }

    pub fn action(action: &str) -> bool {
        let Some(s) = session() else { return false };
        let op = match action {
            "toggle" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "prev" => s.TrySkipPreviousAsync(),
            _ => return false,
        };
        op.and_then(|o| o.get()).unwrap_or(false)
    }
}

#[cfg(not(windows))]
mod imp {
    use super::NowPlaying;
    pub fn now_playing(_art_key: Option<&str>) -> Option<NowPlaying> {
        None
    }
    pub fn action(_action: &str) -> bool {
        false
    }
}

pub use imp::*;

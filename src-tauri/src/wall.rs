// Reads the current desktop wallpaper so the page can paint the glass from it
// and tint the dock to match. Windows keeps a copy of whatever wallpaper is set
// (including Bing's daily image) in TranscodedWallpaper.

use base64::Engine;
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ImageReader};
use serde::Serialize;
use std::{fs, path::PathBuf, thread, time::Duration};
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallInfo {
    data_url: String,
    tint: [u8; 3],
}

fn wallpaper_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let p = PathBuf::from(appdata).join(r"Microsoft\Windows\Themes\TranscodedWallpaper");
    p.exists().then_some(p)
}

/// Cheap fingerprint (modified time + size) to notice a new wallpaper.
fn fingerprint() -> Option<(std::time::SystemTime, u64)> {
    let meta = fs::metadata(wallpaper_path()?).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

pub fn read() -> Result<WallInfo, String> {
    let path = wallpaper_path().ok_or("no wallpaper file found")?;
    let img = ImageReader::open(&path)
        .and_then(|r| r.with_guessed_format())
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;

    // A small copy is plenty: the page blurs it heavily.
    let small = img.resize(1280, 1280, FilterType::Triangle).to_rgb8();

    // Average colour of the top sixth, where the dock sits.
    let rows = (small.height() / 6).max(1);
    let (mut r, mut g, mut b, mut n) = (0u64, 0u64, 0u64, 0u64);
    for y in 0..rows {
        for x in 0..small.width() {
            let p = small.get_pixel(x, y);
            r += p[0] as u64;
            g += p[1] as u64;
            b += p[2] as u64;
            n += 1;
        }
    }
    let n = n.max(1);
    let tint = [(r / n) as u8, (g / n) as u8, (b / n) as u8];

    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 80).encode_image(&small).map_err(|e| e.to_string())?;
    let data_url = format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg));
    Ok(WallInfo { data_url, tint })
}

/// Check every 30 s for a new wallpaper (Bing changes it daily).
pub fn watch(app: AppHandle) {
    thread::spawn(move || {
        let mut last = fingerprint();
        loop {
            thread::sleep(Duration::from_secs(30));
            let now = fingerprint();
            if now != last {
                last = now;
                let _ = app.emit("wallpaper:changed", ());
            }
        }
    });
}

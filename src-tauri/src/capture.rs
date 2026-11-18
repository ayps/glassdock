// Frosted glass over any app: just before the dock opens, take a quick picture of
// the strip of screen it will cover, shrink it and hand it to the page, which blurs
// it behind the cards. The picture never leaves the PC and isn't saved anywhere.

use base64::Engine;
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, RgbImage};
use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Backdrop {
    /// Small JPEG of the strip, as a data URL.
    pub data_url: String,
    /// Size of the strip in logical px (the page scales the picture to this).
    pub width: f64,
    pub height: f64,
    /// Average colour, used to tint the glass.
    pub tint: [u8; 3],
}

/// Shrink factor: the page blurs heavily, so a quarter-size picture is plenty.
const SHRINK: u32 = 4;

/// Capture `w`×`h` physical px at (`x`, `y`) on the virtual screen.
pub fn grab(x: i32, y: i32, w: i32, h: i32, scale: f64) -> Option<Backdrop> {
    let (bgra, w, h) = imp::capture(x, y, w, h)?;
    let mut rgb = RgbImage::new(w as u32, h as u32);
    for (i, px) in rgb.pixels_mut().enumerate() {
        let o = i * 4;
        *px = image::Rgb([bgra[o + 2], bgra[o + 1], bgra[o]]);
    }
    let small = image::imageops::resize(&rgb, (w as u32 / SHRINK).max(1), (h as u32 / SHRINK).max(1), FilterType::Triangle);
    let (mut r, mut g, mut b) = (0u64, 0u64, 0u64);
    for p in small.pixels() {
        r += p[0] as u64;
        g += p[1] as u64;
        b += p[2] as u64;
    }
    let n = (small.width() * small.height()).max(1) as u64;
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 82).encode_image(&small).ok()?;
    Some(Backdrop {
        data_url: format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg)),
        width: w as f64 / scale,
        height: h as f64 / scale,
        tint: [(r / n) as u8, (g / n) as u8, (b / n) as u8],
    })
}

#[cfg(windows)]
mod imp {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };

    /// BGRA pixels, top row first.
    pub fn capture(x: i32, y: i32, w: i32, h: i32) -> Option<(Vec<u8>, i32, i32)> {
        if w <= 0 || h <= 0 {
            return None;
        }
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return None;
            }
            let mem = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(mem, bmp.into());
            let ok = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY).is_ok();
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // negative: top row first
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut buf = vec![0u8; (w * h * 4) as usize];
            // The bitmap must not be selected into a DC while GetDIBits reads it.
            SelectObject(mem, old);
            let lines = if ok {
                GetDIBits(mem, bmp, 0, h as u32, Some(buf.as_mut_ptr() as *mut core::ffi::c_void), &mut info, DIB_RGB_COLORS)
            } else {
                0
            };
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            (lines == h).then_some((buf, w, h))
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn capture(_x: i32, _y: i32, _w: i32, _h: i32) -> Option<(Vec<u8>, i32, i32)> {
        None
    }
}

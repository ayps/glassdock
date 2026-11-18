// The Recycle Bin across all drives: how much is in it, open it, empty it.

#[derive(serde::Serialize)]
pub struct Bin {
    items: i64,
    bytes: i64,
}

#[cfg(windows)]
mod imp {
    use super::Bin;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{
        SHEmptyRecycleBinW, SHQueryRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND, SHQUERYRBINFO,
    };

    pub fn query() -> Option<Bin> {
        let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
        // A null path means "all drives".
        unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) }.ok()?;
        Some(Bin { items: info.i64NumItems, bytes: info.i64Size })
    }

    /// The dock asks for confirmation itself, so Windows' own prompt is skipped.
    pub fn empty() -> Result<(), String> {
        unsafe { SHEmptyRecycleBinW(None, PCWSTR::null(), SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND) }
            .map_err(|e| e.message().to_string())
    }

    pub fn open() {
        let _ = std::process::Command::new("explorer.exe").arg("shell:RecycleBinFolder").spawn();
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Bin;
    pub fn query() -> Option<Bin> {
        None
    }
    pub fn empty() -> Result<(), String> {
        Err("Only available on Windows.".into())
    }
    pub fn open() {}
}

pub use imp::*;

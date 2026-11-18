// Saves the dock's settings (widget order, themes, cities...) to settings.json in
// GlassDock's own folder. Written to a temporary file first and then swapped in,
// so a shutdown mid-save can never leave a broken or empty file behind.

use std::{fs, path::Path};

const NAME: &str = "settings.json";

pub fn load(dir: &Path) -> Option<String> {
    let s = fs::read_to_string(dir.join(NAME)).ok()?;
    serde_json::from_str::<serde_json::Value>(&s).ok()?.is_object().then_some(s)
}

pub fn save(dir: &Path, json: &str) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if !v.is_object() {
        return Err("settings must be an object".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("settings.json.tmp");
    {
        use std::io::Write;
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, dir.join(NAME)).map_err(|e| e.to_string())
}

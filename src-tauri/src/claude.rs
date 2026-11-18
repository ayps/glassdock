// Claude plan usage, through Claude Code's documented status line.
//
// Claude Code hands its status-line command a JSON object that includes
// `rate_limits.five_hour` and `rate_limits.seven_day`, each with
// `used_percentage` and `resets_at` (Unix seconds). GlassDock installs a tiny
// PowerShell script as that command. The script saves the numbers to
// claude-usage.json next to GlassDock's settings, and the dock reads that file.
// So the figures are real, but only refresh while Claude Code is running.

use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}};

const SCRIPT_NAME: &str = "glassdock-statusline.ps1";
const DATA_NAME: &str = "claude-usage.json";

const SCRIPT: &str = r#"# GlassDock status-line bridge for Claude Code.
# Saves the plan usage Claude Code reports, then prints a short status line.
$raw = [Console]::In.ReadToEnd()
try { $j = $raw | ConvertFrom-Json } catch { exit 0 }
$out = Join-Path $PSScriptRoot 'claude-usage.json'
if ($j.rate_limits) {
  $data = @{ rate_limits = $j.rate_limits; updated = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
  try { [IO.File]::WriteAllText($out, ($data | ConvertTo-Json -Depth 6)) } catch { }
}
$parts = @()
if ($j.model.display_name) { $parts += $j.model.display_name }
$fh = $j.rate_limits.five_hour.used_percentage
$wk = $j.rate_limits.seven_day.used_percentage
if ($fh -ne $null -and $fh -le 100) { $parts += ('session {0:N0}%' -f $fh) }
if ($wk -ne $null -and $wk -le 100) { $parts += ('week {0:N0}%' -f $wk) }
Write-Output ($parts -join '  ·  ')
"#;

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

fn settings_path() -> Option<PathBuf> {
    Some(home()?.join(".claude").join("settings.json"))
}

fn command_for(dir: &Path) -> String {
    let script = dir.join(SCRIPT_NAME).to_string_lossy().replace('\\', "/");
    format!("powershell -NoProfile -ExecutionPolicy Bypass -File \"{script}\"")
}

/// Reads Claude Code's settings, tolerating a missing file and a byte-order mark.
fn read_settings(p: &Path) -> Result<Value, String> {
    match fs::read_to_string(p) {
        Ok(s) => serde_json::from_str(s.trim_start_matches('\u{feff}'))
            .map_err(|_| "Claude Code's settings.json isn't valid JSON, so I left it alone.".to_string()),
        Err(_) => Ok(json!({})),
    }
}

/// Is our script set as Claude Code's status line?
pub fn configured() -> bool {
    settings_path()
        .and_then(|p| read_settings(&p).ok())
        .and_then(|v| v.pointer("/statusLine/command").and_then(Value::as_str).map(|c| c.contains(SCRIPT_NAME)))
        .unwrap_or(false)
}

/// Install the script and point Claude Code's status line at it.
/// If another status line is already set, nothing changes unless `replace` is true.
pub fn setup(dir: &Path, replace: bool) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(SCRIPT_NAME), SCRIPT).map_err(|e| e.to_string())?;

    let path = settings_path().ok_or("Couldn't find your user folder.")?;
    let mut settings = read_settings(&path)?;
    if let Some(existing) = settings.pointer("/statusLine/command").and_then(Value::as_str) {
        if !existing.contains(SCRIPT_NAME) && !replace {
            return Err(format!("existing:{existing}"));
        }
    }
    if path.exists() {
        let _ = fs::copy(&path, path.with_extension("json.glassdock-backup"));
    } else if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if !settings.is_object() {
        settings = json!({});
    }
    settings["statusLine"] = json!({ "type": "command", "command": command_for(dir), "padding": 0 });
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

/// The last numbers Claude Code reported, or null if there are none yet.
pub fn usage(dir: &Path) -> Value {
    let Ok(s) = fs::read_to_string(dir.join(DATA_NAME)) else { return Value::Null };
    serde_json::from_str(s.trim_start_matches('\u{feff}')).unwrap_or(Value::Null)
}

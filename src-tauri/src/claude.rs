// Claude plan usage.
//
// First choice: ask Anthropic's usage service directly, the same check Claude Code's
// /status command makes, using the sign-in Claude Code saved on this PC
// (%USERPROFILE%\.claude\.credentials.json). The token is only read, never
// changed or refreshed, and only ever sent to api.anthropic.com. This refreshes on
// its own every few minutes, with no terminal open.
//
// Fallback: Claude Code's documented status line, described below.
//
// Claude Code hands its status-line command a JSON object that includes
// `rate_limits.five_hour` and `rate_limits.seven_day`, each with
// `used_percentage` and `resets_at` (Unix seconds). GlassDock installs a tiny
// PowerShell script as that command. The script saves the numbers to
// claude-usage.json next to GlassDock's settings, and the dock reads that file.
// So the figures are real, but only refresh while Claude Code is running.

use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

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

// ------------------------------------------------------------------ direct usage check

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
/// How often to ask Anthropic (the widget may ask more often; it gets the saved answer).
const EVERY: Duration = Duration::from_secs(5 * 60);
/// After a failure, wait a little before trying again.
const RETRY: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct Live {
    last: Mutex<Option<(Instant, Result<Value, String>)>>,
}

/// Claude Code's saved sign-in: (access token, expiry in ms since 1970).
fn claude_code_login() -> Option<(String, Option<i64>)> {
    let p = home()?.join(".claude").join(".credentials.json");
    let v: Value = serde_json::from_str(fs::read_to_string(p).ok()?.trim_start_matches('\u{feff}')).ok()?;
    let o = v.get("claudeAiOauth")?;
    let token = o.get("accessToken")?.as_str()?.to_string();
    Some((token, o.get("expiresAt").and_then(Value::as_i64)))
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// "2026-02-06T22:00:00.123+00:00" or "...Z" to Unix seconds.
fn parse_time(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, se) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    // Days since 1970 for a civil date (Howard Hinnant's algorithm).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let mut t = days * 86400 + h * 3600 + mi * 60 + se;
    // Time-zone offset at the end (+hh:mm / -hh:mm); "Z" means UTC.
    let rest = &s[19..];
    if let Some(i) = rest.find(|c| c == '+' || c == '-') {
        let off = &rest[i..];
        let sign = if off.starts_with('-') { -1 } else { 1 };
        let oh = off.get(1..3).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);
        let om = off.get(4..6).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);
        t -= sign * (oh * 3600 + om * 60);
    }
    Some(t)
}

fn window(v: &Value) -> Value {
    if v.is_null() {
        return Value::Null;
    }
    let mut out = json!({});
    if let Some(p) = v.get("utilization").and_then(Value::as_f64) {
        out["used_percentage"] = json!(p);
    }
    if let Some(t) = v.get("resets_at").and_then(Value::as_str).and_then(parse_time) {
        out["resets_at"] = json!(t);
    }
    out
}

async fn fetch() -> Result<Value, String> {
    let (token, expires) = claude_code_login().ok_or("no_login")?;
    if let Some(ms) = expires {
        if ms / 1000 < now_secs() {
            return Err("expired".into());
        }
    }
    let res = reqwest::Client::new()
        .get(USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "GlassDock")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("expired".into());
    }
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    if v.get("five_hour").is_none() && v.get("seven_day").is_none() {
        return Err("no usage in the answer".into());
    }
    Ok(json!({
        "updated": now_secs(),
        "source": "live",
        "rate_limits": { "five_hour": window(&v["five_hour"]), "seven_day": window(&v["seven_day"]) }
    }))
}

impl Live {
    /// The latest numbers from Anthropic, asking again only when the saved answer is old.
    /// Err("no_login") / Err("expired") / Err(other) when it can't.
    pub async fn get(&self) -> Result<Value, String> {
        if let Some((at, r)) = self.last.lock().unwrap().as_ref() {
            let wait = if r.is_ok() { EVERY } else { RETRY };
            if at.elapsed() < wait {
                return r.clone();
            }
        }
        let r = fetch().await;
        // Keep showing the last good numbers through a brief network hiccup.
        let keep = {
            let last = self.last.lock().unwrap();
            match (&r, last.as_ref()) {
                (Err(e), Some((_, Ok(prev)))) if e != "expired" && e != "no_login" => Some(prev.clone()),
                _ => None,
            }
        };
        let r = keep.map(Ok).unwrap_or(r);
        *self.last.lock().unwrap() = Some((Instant::now(), r.clone()));
        r
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn times() {
        assert_eq!(super::parse_time("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(super::parse_time("2026-02-06T22:00:00+00:00"), Some(1770415200));
        assert_eq!(super::parse_time("2026-02-06T23:30:00.5+01:30"), Some(1770415200));
    }
}

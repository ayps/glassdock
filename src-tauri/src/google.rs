// Google sign-in for Calendar and Tasks, for any number of accounts.
//
// How it works (the standard "desktop app" OAuth flow):
//   1. You create a Desktop-app client in Google Cloud and give the dock its JSON.
//   2. "Add account" opens Google's sign-in page in your browser. Google sends
//      the browser back to a tiny one-time web server on 127.0.0.1, which picks
//      up a code. PKCE makes sure only this app can use that code.
//   3. The code is swapped for a refresh token, which is kept in Windows
//      Credential Manager (never in a plain file). Short-lived access tokens
//      are made from it as needed and only kept in memory.
// The page then asks for Google API calls through `api()`, which only allows
// Google's Calendar and Tasks addresses and adds the token itself, so the token
// never reaches the page.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

const SCOPES: &str = "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks";
const KEYRING_SERVICE: &str = "GlassDock";
const ALLOWED: [&str; 2] = ["https://www.googleapis.com/calendar/v3/", "https://tasks.googleapis.com/tasks/v1/"];

#[derive(Serialize, Deserialize, Default, Clone)]
struct Config {
    client_id: String,
    client_secret: String,
    accounts: Vec<String>,
}

pub struct Google {
    path: PathBuf,
    cfg: Mutex<Config>,
    tokens: Mutex<HashMap<String, (String, Instant)>>,
    http: reqwest::Client,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    has_client: bool,
    accounts: Vec<String>,
}

fn entry(email: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("google:{email}")).map_err(|e| e.to_string())
}

/// Percent-encode a query value.
fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn dec(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                let h = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
                match h {
                    Some(v) => {
                        out.push(v);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn random_url_safe(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

pub fn open_url(url: &str) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

impl Google {
    pub fn new(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("google.json");
        let cfg = fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Self { path, cfg: Mutex::new(cfg), tokens: Mutex::new(HashMap::new()), http: reqwest::Client::new() }
    }

    fn save(&self) {
        let cfg = self.cfg.lock().unwrap().clone();
        if let Ok(s) = serde_json::to_string_pretty(&cfg) {
            let _ = fs::write(&self.path, s);
        }
    }

    pub fn status(&self) -> Status {
        let c = self.cfg.lock().unwrap();
        Status { has_client: !c.client_id.is_empty(), accounts: c.accounts.clone() }
    }

    /// Accepts the JSON file Google Cloud gives you for a Desktop-app client.
    pub fn set_client(&self, json: &str) -> Result<(), String> {
        let v: Value = serde_json::from_str(json).map_err(|_| "That file isn't valid JSON.".to_string())?;
        let inner = v.get("installed").or_else(|| v.get("web")).unwrap_or(&v);
        let id = inner.get("client_id").and_then(Value::as_str).unwrap_or_default();
        let secret = inner.get("client_secret").and_then(Value::as_str).unwrap_or_default();
        if id.is_empty() || secret.is_empty() {
            return Err("No client_id / client_secret found. Download the JSON of a Desktop-app client.".into());
        }
        {
            let mut c = self.cfg.lock().unwrap();
            c.client_id = id.to_string();
            c.client_secret = secret.to_string();
        }
        self.save();
        Ok(())
    }

    /// Runs the browser sign-in and returns the account's email.
    pub async fn sign_in(&self) -> Result<String, String> {
        let (client_id, client_secret) = {
            let c = self.cfg.lock().unwrap();
            (c.client_id.clone(), c.client_secret.clone())
        };
        if client_id.is_empty() {
            return Err("Add your Google client JSON first.".into());
        }

        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let redirect = format!("http://127.0.0.1:{port}");
        let verifier = random_url_safe(48);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let state = random_url_safe(16);
        let url = format!(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}\
             &code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt={}",
            enc(&client_id), enc(&redirect), enc(SCOPES), challenge, state, enc("consent select_account")
        );
        open_url(&url);

        // Wait up to 5 minutes for the browser to come back with the code.
        let code = tokio::time::timeout(Duration::from_secs(300), async {
            loop {
                let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.map_err(|e| e.to_string())?;
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
                let params: HashMap<String, String> = query
                    .split('&')
                    .filter_map(|kv| kv.split_once('='))
                    .map(|(k, v)| (k.to_string(), dec(v)))
                    .collect();
                if params.is_empty() {
                    let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
                    continue; // e.g. the browser asking for a favicon
                }
                let ok = params.get("state") == Some(&state) && params.contains_key("code");
                let body = if ok {
                    "<h2 style='font-family:system-ui'>GlassDock is connected. You can close this tab.</h2>"
                } else {
                    "<h2 style='font-family:system-ui'>Sign-in was cancelled. You can close this tab.</h2>"
                };
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                return if ok {
                    Ok(params["code"].clone())
                } else {
                    Err(params.get("error").cloned().unwrap_or_else(|| "Sign-in was cancelled.".into()))
                };
            }
        })
        .await
        .map_err(|_| "Sign-in timed out.".to_string())??;

        let tok: Value = self
            .http
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", client_id.as_str()),
                ("client_secret", client_secret.as_str()),
                ("code", code.as_str()),
                ("code_verifier", verifier.as_str()),
                ("redirect_uri", redirect.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        let refresh = tok.get("refresh_token").and_then(Value::as_str).ok_or("Google sent no refresh token.")?;
        let access = tok.get("access_token").and_then(Value::as_str).unwrap_or_default().to_string();
        let expires = tok.get("expires_in").and_then(Value::as_u64).unwrap_or(3000);
        // The id_token's middle part is JSON that includes the account's email.
        let email = tok
            .get("id_token")
            .and_then(Value::as_str)
            .and_then(|t| t.split('.').nth(1))
            .and_then(|p| URL_SAFE_NO_PAD.decode(p.trim_end_matches('=')).ok())
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| v.get("email").and_then(Value::as_str).map(str::to_string))
            .ok_or("Couldn't read the account's email.")?;

        entry(&email)?.set_password(refresh).map_err(|e| e.to_string())?;
        self.tokens.lock().unwrap().insert(email.clone(), (access, Instant::now() + Duration::from_secs(expires)));
        {
            let mut c = self.cfg.lock().unwrap();
            if !c.accounts.contains(&email) {
                c.accounts.push(email.clone());
            }
        }
        self.save();
        Ok(email)
    }

    pub async fn sign_out(&self, email: &str) {
        if let Ok(e) = entry(email) {
            if let Ok(t) = e.get_password() {
                let _ = self.http.post("https://oauth2.googleapis.com/revoke").form(&[("token", t.as_str())]).send().await;
            }
            let _ = e.delete_credential();
        }
        self.tokens.lock().unwrap().remove(email);
        self.cfg.lock().unwrap().accounts.retain(|a| a != email);
        self.save();
    }

    async fn access_token(&self, email: &str, force: bool) -> Result<String, String> {
        if !force {
            if let Some((t, exp)) = self.tokens.lock().unwrap().get(email) {
                if *exp > Instant::now() + Duration::from_secs(60) {
                    return Ok(t.clone());
                }
            }
        }
        let (id, secret) = {
            let c = self.cfg.lock().unwrap();
            (c.client_id.clone(), c.client_secret.clone())
        };
        let refresh = entry(email)?.get_password().map_err(|_| "reauth".to_string())?;
        let tok: Value = self
            .http
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", id.as_str()),
                ("client_secret", secret.as_str()),
                ("refresh_token", refresh.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let access = tok.get("access_token").and_then(Value::as_str).ok_or("reauth")?.to_string();
        let expires = tok.get("expires_in").and_then(Value::as_u64).unwrap_or(3000);
        self.tokens.lock().unwrap().insert(email.to_string(), (access.clone(), Instant::now() + Duration::from_secs(expires)));
        Ok(access)
    }

    /// A Calendar or Tasks API call on behalf of `email`.
    pub async fn api(&self, email: &str, method: &str, url: &str, body: Option<Value>) -> Result<Value, String> {
        if !ALLOWED.iter().any(|p| url.starts_with(p)) {
            return Err("That address isn't allowed.".into());
        }
        let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
        for attempt in 0..2 {
            let token = self.access_token(email, attempt == 1).await?;
            let mut req = self.http.request(m.clone(), url).bearer_auth(&token);
            if let Some(b) = &body {
                req = req.json(b);
            }
            let resp = req.send().await.map_err(|e| e.to_string())?;
            let status = resp.status();
            if status.as_u16() == 401 && attempt == 0 {
                continue; // token went stale: refresh and try once more
            }
            let text = resp.text().await.map_err(|e| e.to_string())?;
            if !status.is_success() {
                let msg = serde_json::from_str::<Value>(&text)
                    .ok()
                    .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_string))
                    .unwrap_or(text);
                return Err(format!("{}: {}", status.as_u16(), msg));
            }
            return Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).map_err(|e| e.to_string())? });
        }
        Err("reauth".into())
    }
}

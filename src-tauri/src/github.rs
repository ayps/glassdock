// GitHub, with a personal access token you create on github.com.
// The token is kept in Windows Credential Manager and only ever sent to
// GitHub's GraphQL address; the page asks for queries and never sees it.

use serde_json::{json, Value};
use std::sync::Mutex;

const KEYRING_SERVICE: &str = "GlassDock";
const KEYRING_USER: &str = "github";
const GRAPHQL: &str = "https://api.github.com/graphql";

pub struct GitHub {
    http: reqwest::Client,
    login: Mutex<Option<String>>,
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

impl GitHub {
    pub fn new() -> Self {
        Self { http: reqwest::Client::new(), login: Mutex::new(None) }
    }

    async fn post(&self, token: &str, query: &str, variables: Value) -> Result<Value, String> {
        let resp = self
            .http
            .post(GRAPHQL)
            .bearer_auth(token)
            .header("User-Agent", "GlassDock")
            .json(&json!({ "query": query, "variables": variables }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        let v: Value = resp.json().await.map_err(|e| e.to_string())?;
        if status.as_u16() == 401 {
            return Err("GitHub rejected the token (expired or revoked).".into());
        }
        if let Some(msg) = v.pointer("/errors/0/message").and_then(Value::as_str) {
            if v.get("data").map_or(true, Value::is_null) {
                return Err(msg.to_string());
            }
        }
        if !status.is_success() {
            return Err(format!("GitHub error {}", status.as_u16()));
        }
        Ok(v.get("data").cloned().unwrap_or(Value::Null))
    }

    /// Checks the token by asking who it belongs to, then saves it.
    pub async fn set_token(&self, token: &str) -> Result<String, String> {
        let token = token.trim();
        if token.is_empty() {
            return Err("Paste a token first.".into());
        }
        let data = self.post(token, "query { viewer { login } }", json!({})).await?;
        let login = data.pointer("/viewer/login").and_then(Value::as_str).ok_or("Couldn't read your GitHub username.")?;
        entry()?.set_password(token).map_err(|e| e.to_string())?;
        *self.login.lock().unwrap() = Some(login.to_string());
        Ok(login.to_string())
    }

    pub async fn login(&self) -> Option<String> {
        if let Some(l) = self.login.lock().unwrap().clone() {
            return Some(l);
        }
        let token = entry().ok()?.get_password().ok()?;
        let data = self.post(&token, "query { viewer { login } }", json!({})).await.ok()?;
        let login = data.pointer("/viewer/login").and_then(Value::as_str)?.to_string();
        *self.login.lock().unwrap() = Some(login.clone());
        Some(login)
    }

    pub fn clear(&self) {
        if let Ok(e) = entry() {
            let _ = e.delete_credential();
        }
        *self.login.lock().unwrap() = None;
    }

    pub async fn query(&self, query: &str, variables: Value) -> Result<Value, String> {
        let token = entry()?.get_password().map_err(|_| "not-connected".to_string())?;
        self.post(&token, query, variables).await
    }
}

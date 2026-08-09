#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::too_many_lines,
    clippy::unused_async,
    clippy::needless_pass_by_value,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::manual_let_else,
    clippy::format_push_string
)]
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use tracing::{error, info};

use crate::settings::config_dir;

/// An agent token with capabilities and scopes.
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AgentToken {
    pub id: String,
    pub name: String,
    pub token_hash: String,
    pub token_prefix: String,
    pub capabilities: HashSet<String>,
    #[serde(default)]
    pub scopes: HashMap<String, Vec<String>>,
    pub created_at: u64,
    #[serde(default)]
    pub expires_at: Option<u64>,
    #[serde(default)]
    pub last_used_at: Option<u64>,
    #[serde(default)]
    pub description: String,
}

/// Minimal token info stored in request extensions for handler extraction.
#[derive(Clone, Debug)]
pub struct TokenInfo {
    pub token_id: String,
    pub is_global: bool,
    pub capabilities: HashSet<String>,
    pub scopes: HashMap<String, Vec<String>>,
}

impl TokenInfo {
    /// Global token has all capabilities.
    #[must_use]
    pub fn global() -> Self {
        let caps: HashSet<String> =
            ALL_CAPABILITIES.iter().map(std::string::ToString::to_string).collect();
        Self {
            token_id: "global".into(),
            is_global: true,
            capabilities: caps,
            scopes: HashMap::new(),
        }
    }

    #[must_use]
    pub fn has_capability(&self, cap: &str) -> bool {
        self.is_global || self.capabilities.contains(cap)
    }

    #[must_use]
    pub fn check_scope(&self, cap: &str, resource: &str) -> bool {
        if self.is_global {
            return true;
        }
        if !self.capabilities.contains(cap) {
            return false;
        }
        match self.scopes.get(cap) {
            Some(scopes) => scopes.iter().any(|s| s == resource),
            None => true, // no scope restriction = allowed
        }
    }
}

pub const ALL_CAPABILITIES: &[&str] = &[
    "terminal:read",
    "terminal:write",
    "terminal:create",
    "terminal:kill",
    "workspace:read",
    "workspace:write",
    "workspace:execute",
    "plugin:exec",
    "settings:read",
    "settings:write",
];

fn tokens_path() -> PathBuf {
    config_dir().join("tokens.json")
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

/// SHA-256 hash for token strings.
fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex_encode(&hasher.finalize())
}

fn generate_token_string() -> String {
    use rand::RngExt;
    let mut rng = rand::rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.random::<u8>()).collect();
    format!("dnt_{}", hex_encode(&bytes))
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
    }
    s
}

pub struct TokenManager {
    tokens: DashMap<String, AgentToken>,
    revoked: DashMap<String, u64>,
    global_token: Arc<RwLock<String>>,
}

pub type TokenState = Arc<TokenManager>;

impl TokenManager {
    #[must_use]
    pub fn new(global_token: Arc<RwLock<String>>) -> Self {
        let mgr = Self { tokens: DashMap::new(), revoked: DashMap::new(), global_token };
        mgr.load();
        mgr
    }

    fn load(&self) {
        let path = tokens_path();
        if !path.exists() {
            return;
        }
        match std::fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str::<Vec<AgentToken>>(&data) {
                Ok(tokens) => {
                    for t in tokens {
                        self.tokens.insert(t.id.clone(), t);
                    }
                    info!("Loaded {} agent tokens", self.tokens.len());
                }
                Err(e) => error!("parse tokens: {}", e),
            },
            Err(e) => error!("read tokens: {}", e),
        }
    }

    fn save(&self) -> Result<(), String> {
        let dir = config_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let tokens: Vec<AgentToken> = self.tokens.iter().map(|e| e.value().clone()).collect();
        let json = serde_json::to_string_pretty(&tokens).map_err(|e| e.to_string())?;
        std::fs::write(tokens_path(), json).map_err(|e| e.to_string())
    }

    /// Create a new agent token. Returns (`raw_token_string`, `agent_token`).
    pub fn create(
        &self,
        name: String,
        description: String,
        capabilities: HashSet<String>,
        scopes: HashMap<String, Vec<String>>,
        expires_in: Option<u64>,
    ) -> Result<(String, AgentToken), String> {
        let raw = generate_token_string();
        let hash = hash_token(&raw);
        let prefix = raw[..12.min(raw.len())].to_string();

        let id = uuid::Uuid::new_v4().to_string();
        let now = now_unix();
        let agent_token = AgentToken {
            id: id.clone(),
            name,
            token_hash: hash,
            token_prefix: format!("{prefix}..."),
            capabilities,
            scopes,
            created_at: now,
            expires_at: expires_in.map(|s| now + s),
            last_used_at: None,
            description,
        };
        self.tokens.insert(id, agent_token.clone());
        self.save()?;
        Ok((raw, agent_token))
    }

    #[must_use]
    pub fn list(&self) -> Vec<AgentToken> {
        self.tokens.iter().map(|e| e.value().clone()).collect()
    }

    #[must_use]
    pub fn get(&self, id: &str) -> Option<AgentToken> {
        self.tokens.get(id).map(|e| e.value().clone())
    }

    pub fn update(
        &self,
        id: &str,
        name: Option<String>,
        capabilities: Option<HashSet<String>>,
        scopes: Option<HashMap<String, Vec<String>>>,
    ) -> Result<AgentToken, String> {
        let mut entry = self.tokens.get_mut(id).ok_or("token not found")?;
        if let Some(n) = name {
            entry.name = n;
        }
        if let Some(c) = capabilities {
            entry.capabilities = c;
        }
        if let Some(s) = scopes {
            entry.scopes = s;
        }
        let token = entry.value().clone();
        drop(entry);
        self.save()?;
        Ok(token)
    }

    pub fn revoke(&self, id: &str) -> Result<(), String> {
        let token = self.tokens.remove(id).map(|(_, t)| t).ok_or("token not found")?;
        self.revoked.insert(token.token_hash, now_unix());
        self.save()?;
        Ok(())
    }

    /// Validate a raw token string. Returns `TokenInfo` if valid.
    #[must_use]
    pub fn validate(&self, raw: &str) -> Option<TokenInfo> {
        // Check global token first
        let global = self.global_token.try_read().ok()?;
        if !global.is_empty() && crate::auth::constant_time_eq(raw, &global) {
            return Some(TokenInfo::global());
        }

        // Hash and look up
        let hash = hash_token(raw);
        let entry = self.tokens.iter().find(|e| e.value().token_hash == hash)?;
        let token = entry.value();

        // Check revoked
        if self.revoked.contains_key(&hash) {
            return None;
        }

        // Check expired
        if let Some(exp) = token.expires_at {
            if now_unix() > exp {
                return None;
            }
        }

        Some(TokenInfo {
            token_id: token.id.clone(),
            is_global: false,
            capabilities: token.capabilities.clone(),
            scopes: token.scopes.clone(),
        })
    }

    /// Update `last_used_at` for a token by hash.
    pub fn touch(&self, raw: &str) {
        let hash = hash_token(raw);
        if let Some(mut entry) = self.tokens.iter_mut().find(|e| e.value().token_hash == hash) {
            entry.last_used_at = Some(now_unix());
        }
    }

    pub fn start_cleanup_task(self: &Arc<Self>) {
        let mgr = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_hours(1));
            loop {
                interval.tick().await;
                let now = now_unix();
                // Remove expired tokens
                let expired: Vec<String> = mgr
                    .tokens
                    .iter()
                    .filter_map(|e| {
                        let t = e.value();
                        if t.expires_at.is_some_and(|exp| now > exp) {
                            Some(t.id.clone())
                        } else {
                            None
                        }
                    })
                    .collect();
                for id in expired {
                    if let Some((_, token)) = mgr.tokens.remove(&id) {
                        info!("Expired token removed: {}", token.name);
                    }
                }
                // Clean revoked entries older than 24h
                let old_revoked: Vec<String> =
                    mgr.revoked
                        .iter()
                        .filter_map(|e| {
                            if now - *e.value() > 86400 {
                                Some(e.key().clone())
                            } else {
                                None
                            }
                        })
                        .collect();
                for key in old_revoked {
                    mgr.revoked.remove(&key);
                }
            }
        });
    }
}

// ── Sessions Token Middleware ──

/// State for the sessions token middleware, holding both the global token and token manager.
#[derive(Clone)]
pub struct SessionsAuthState {
    pub global_token: Arc<tokio::sync::RwLock<String>>,
    pub tokens: TokenState,
}

/// Middleware that validates tokens and injects `TokenInfo` into request extensions.
/// Dual-track: accepts agent Bearer (with capability), global Bearer (full caps),
/// `?token=` query param (browser WS compatibility), or no Bearer for HTTP requests
/// (defers to outer `auth_middleware` for session cookie; injects global).
///
/// WS upgrade requests bypass outer `auth_middleware` (exempt list), so they MUST
/// carry a Bearer header or `?token=` query param - otherwise 401.
pub async fn sessions_token_middleware(
    State(auth): State<SessionsAuthState>,
    mut request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    // Extract Bearer token from Authorization header
    let bearer = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim);

    // Fall back to ?token= query param (browser WS clients can't set headers)
    let query_token = request.uri().query().and_then(|q| {
        q.split('&').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            if k == "token" {
                Some(v.to_string())
            } else {
                None
            }
        })
    });

    let raw_token = bearer.or(query_token.as_deref());

    let Some(raw_token) = raw_token else {
        // No Bearer and no ?token= query param.
        let is_ws_upgrade = request
            .headers()
            .get(axum::http::header::UPGRADE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.eq_ignore_ascii_case("websocket"));
        if is_ws_upgrade {
            // WS routes are in the outer auth_middleware exempt list, so we can't
            // assume a session cookie was validated. Require explicit token.
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": {"code": "UNAUTHORIZED", "message": "WS requires Bearer or ?token= query param"}})),
            )
                .into_response();
        }
        // HTTP request: outer auth_middleware has already validated the session
        // cookie. Inject TokenInfo::global() so handler capability checks pass.
        request.extensions_mut().insert(TokenInfo::global());
        return next.run(request).await;
    };

    // Check global token first
    {
        let global = auth.global_token.read().await;
        if !global.is_empty() && crate::auth::constant_time_eq(raw_token, &global) {
            request.extensions_mut().insert(TokenInfo::global());
            return next.run(request).await;
        }
    }

    // Check agent token
    match auth.tokens.validate(raw_token) {
        Some(info) => {
            auth.tokens.touch(raw_token);
            request.extensions_mut().insert(info);
            next.run(request).await
        }
        None => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": {"code": "UNAUTHORIZED", "message": "Invalid or expired token"}})),
        )
            .into_response(),
    }
}

// ── HTTP Handlers ──

#[derive(Deserialize)]
pub struct CreateTokenRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub capabilities: HashSet<String>,
    #[serde(default)]
    pub scopes: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub expires_in: Option<u64>,
}

#[derive(Deserialize)]
pub struct UpdateTokenRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub capabilities: Option<HashSet<String>>,
    #[serde(default)]
    pub scopes: Option<HashMap<String, Vec<String>>>,
}

pub async fn create_token(
    State(state): State<TokenState>,
    axum::Extension(token_info): axum::Extension<TokenInfo>,
    Json(req): Json<CreateTokenRequest>,
) -> impl IntoResponse {
    // Check capability
    if !token_info.has_capability("settings:write") {
        return (
            StatusCode::FORBIDDEN,
            Json(
                serde_json::json!({"error": {"code": "CAPABILITY_DENIED", "message": "Token lacks settings:write capability"}}),
            ),
        );
    }

    // Validate capabilities
    let valid_caps: HashSet<&str> = ALL_CAPABILITIES.iter().copied().collect();
    for cap in &req.capabilities {
        if !valid_caps.contains(cap.as_str()) {
            return (
                StatusCode::BAD_REQUEST,
                Json(
                    serde_json::json!({"error": {"code": "INVALID_REQUEST", "message": format!("unknown capability: {cap}")}}),
                ),
            );
        }
    }

    match state.create(req.name, req.description, req.capabilities, req.scopes, req.expires_in) {
        Ok((raw, token)) => {
            (StatusCode::CREATED, Json(serde_json::json!({"token": raw, "token_info": token})))
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": {"code": "INTERNAL_ERROR", "message": e}})),
        ),
    }
}

pub async fn list_tokens(
    State(state): State<TokenState>,
    axum::Extension(token_info): axum::Extension<TokenInfo>,
) -> impl IntoResponse {
    if !token_info.has_capability("settings:read") {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": {"code": "CAPABILITY_DENIED", "message": "Token lacks settings:read capability"}})),
        )
            .into_response();
    }
    Json(serde_json::json!({"tokens": state.list()})).into_response()
}

pub async fn get_token_detail(
    State(state): State<TokenState>,
    axum::Extension(token_info): axum::Extension<TokenInfo>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !token_info.has_capability("settings:read") {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": {"code": "CAPABILITY_DENIED", "message": "Token lacks settings:read capability"}})),
        )
            .into_response();
    }
    match state.get(&id) {
        Some(t) => Json(serde_json::json!(t)).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": {"code": "NOT_FOUND", "message": "token not found"}})),
        )
            .into_response(),
    }
}

pub async fn update_token(
    State(state): State<TokenState>,
    axum::Extension(token_info): axum::Extension<TokenInfo>,
    Path(id): Path<String>,
    Json(req): Json<UpdateTokenRequest>,
) -> impl IntoResponse {
    if !token_info.has_capability("settings:write") {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": {"code": "CAPABILITY_DENIED", "message": "Token lacks settings:write capability"}})),
        )
            .into_response();
    }
    match state.update(&id, req.name, req.capabilities, req.scopes) {
        Ok(t) => Json(serde_json::json!(t)).into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": {"code": "NOT_FOUND", "message": e}})),
        )
            .into_response(),
    }
}

pub async fn revoke_token(
    State(state): State<TokenState>,
    axum::Extension(token_info): axum::Extension<TokenInfo>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !token_info.has_capability("settings:write") {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": {"code": "CAPABILITY_DENIED", "message": "Token lacks settings:write capability"}})),
        )
            .into_response();
    }
    match state.revoke(&id) {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": {"code": "NOT_FOUND", "message": e}})),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_manager() -> Arc<TokenManager> {
        Arc::new(TokenManager::new(Arc::new(RwLock::new("test-global-token".into()))))
    }

    #[test]
    fn test_create_and_validate() {
        let mgr = make_manager();
        let caps: HashSet<String> =
            ["terminal:read", "terminal:write"].iter().map(|s| s.to_string()).collect();
        let (raw, token) =
            mgr.create("test".into(), "desc".into(), caps, HashMap::new(), None).unwrap();
        assert!(raw.starts_with("dnt_"));
        assert_eq!(token.name, "test");

        // Validate with the raw token
        let info = mgr.validate(&raw).unwrap();
        assert!(!info.is_global);
        assert!(info.has_capability("terminal:read"));
        assert!(info.has_capability("terminal:write"));
        assert!(!info.has_capability("workspace:write"));
    }

    #[test]
    fn test_validate_global_token() {
        let mgr = make_manager();
        let info = mgr.validate("test-global-token").unwrap();
        assert!(info.is_global);
        assert!(info.has_capability("terminal:read"));
        assert!(info.has_capability("workspace:write"));
    }

    #[test]
    fn test_revoke() {
        let mgr = make_manager();
        let caps: HashSet<String> = ["terminal:read"].iter().map(|s| s.to_string()).collect();
        let (raw, token) =
            mgr.create("test".into(), "".into(), caps, HashMap::new(), None).unwrap();
        assert!(mgr.validate(&raw).is_some());

        mgr.revoke(&token.id).unwrap();
        assert!(mgr.validate(&raw).is_none());
    }

    #[test]
    fn test_expiration() {
        let mgr = make_manager();
        let caps: HashSet<String> = ["terminal:read"].iter().map(|s| s.to_string()).collect();
        // expires_in=1 so it expires 1 second from now, then manually set to past
        let (raw, mut token) =
            mgr.create("test".into(), "".into(), caps, HashMap::new(), Some(1)).unwrap();
        // Manually set to past
        token.expires_at = Some(now_unix() - 10);
        mgr.tokens.insert(token.id.clone(), token);
        assert!(mgr.validate(&raw).is_none());
    }

    #[test]
    fn test_update() {
        let mgr = make_manager();
        let caps: HashSet<String> = ["terminal:read"].iter().map(|s| s.to_string()).collect();
        let (_, token) = mgr.create("test".into(), "".into(), caps, HashMap::new(), None).unwrap();

        let new_caps: HashSet<String> = ["workspace:read"].iter().map(|s| s.to_string()).collect();
        let updated = mgr.update(&token.id, Some("updated".into()), Some(new_caps), None).unwrap();
        assert_eq!(updated.name, "updated");
        assert!(updated.capabilities.contains("workspace:read"));
        assert!(!updated.capabilities.contains("terminal:read"));
    }

    #[test]
    fn test_scope_check() {
        let mut info = TokenInfo {
            token_id: "test".into(),
            is_global: false,
            capabilities: ["terminal:write"].iter().map(|s| s.to_string()).collect(),
            scopes: HashMap::new(),
        };
        // No scope restriction = allowed
        assert!(info.check_scope("terminal:write", "any-pane"));

        // With scope restriction
        info.scopes.insert("terminal:write".into(), vec!["pane-1".into()]);
        assert!(info.check_scope("terminal:write", "pane-1"));
        assert!(!info.check_scope("terminal:write", "pane-2"));
    }
}

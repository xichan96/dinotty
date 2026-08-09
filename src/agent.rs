#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::too_many_lines,
    clippy::unused_async,
    clippy::needless_pass_by_value,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::must_use_candidate,
    clippy::manual_let_else
)]
use crate::audit::AuditState;
use crate::session::SessionManager;
use crate::settings::SettingsState;
use crate::token::{TokenInfo, TokenState};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, RwLock};

/// Maximum concurrent run requests per token.
const MAX_CONCURRENT_RUNS: usize = 10;
/// Default timeout for agent run (5 minutes).
const DEFAULT_TIMEOUT_MS: u64 = 300_000;
/// Maximum timeout (1 hour).
const MAX_TIMEOUT_MS: u64 = 3_600_000;

/// Shared state for tracking concurrent runs per token.
pub type AgentRunLimiter = Arc<RwLock<HashMap<String, usize>>>;

#[derive(Clone)]
pub struct AgentState {
    pub manager: Arc<SessionManager>,
    pub settings: SettingsState,
    pub tokens: TokenState,
    pub audit: AuditState,
    pub run_limiter: AgentRunLimiter,
}

// ── Request/Response Types ──

#[derive(Deserialize)]
pub struct AgentRunRequest {
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub pane_id: Option<String>,
    #[serde(default = "default_true")]
    pub strip_ansi: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize)]
pub struct AgentRunResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration: u64,
    pub pane_id: String,
    pub method: String,
}

#[derive(Serialize)]
pub struct AgentErrorResponse {
    pub error: AgentError,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
}

#[derive(Serialize)]
pub struct AgentError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct AgentSendRequest {
    pub command: String,
    #[serde(default)]
    pub pane_id: Option<String>,
}

#[derive(Deserialize)]
pub struct AgentReadQuery {
    #[serde(default = "default_active")]
    pub pane_id: String,
    #[serde(default)]
    pub scrollback: Option<usize>,
    #[serde(default = "default_true")]
    pub strip_ansi: bool,
}

fn default_active() -> String {
    "active".into()
}

#[derive(Serialize)]
pub struct AgentReadResponse {
    pub pane_id: String,
    pub lines: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scrollback: Option<Vec<String>>,
    pub cursor: CursorInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Serialize)]
pub struct CursorInfo {
    pub row: usize,
    pub col: usize,
}

// ── Helper: resolve pane_id ──

fn resolve_pane_id(requested: Option<&str>, manager: &SessionManager) -> Option<String> {
    match requested {
        Some("auto") | None => {
            // Use active pane or first available
            manager
                .active_pane_id
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
                .filter(|id| manager.sessions.contains_key(id))
                .or_else(|| manager.sessions.iter().next().map(|e| e.key().clone()))
        }
        Some(id) if manager.sessions.contains_key(id) => Some(id.to_string()),
        _ => None,
    }
}

fn resolve_pane_id_from_str(requested: &str, manager: &SessionManager) -> Option<String> {
    if requested == "active" || requested.is_empty() {
        resolve_pane_id(None, manager)
    } else {
        resolve_pane_id(Some(requested), manager)
    }
}

/// Strip ANSI escape sequences from a string.
#[must_use]
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip escape sequence
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&nc) = chars.peek() {
                    if nc.is_ascii_alphabetic() || nc == 'm' {
                        chars.next();
                        break;
                    }
                    chars.next();
                }
            } else if chars.peek() == Some(&']') {
                // OSC sequence — skip until ST or BEL
                chars.next();
                while let Some(nc) = chars.next() {
                    if nc == '\x07' {
                        break;
                    }
                    if nc == '\x1b' && chars.peek() == Some(&'\\') {
                        chars.next();
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

// ── POST /api/sessions/:pane_id/run ──

pub async fn sessions_run(
    State(state): State<AgentState>,
    axum::Extension(token_info): axum::Extension<TokenInfo>,
    Json(req): Json<AgentRunRequest>,
) -> impl IntoResponse {
    // Check open_api setting
    {
        let s = state.settings.read().await;
        if !s.open_api.enabled {
            return error_response(
                StatusCode::FORBIDDEN,
                "CAPABILITY_DENIED",
                "Agent API is disabled. Enable open_api in settings.",
            );
        }
    }

    // Check capability
    if !token_info.has_capability("terminal:write") {
        return error_response(
            StatusCode::FORBIDDEN,
            "CAPABILITY_DENIED",
            "Token lacks terminal:write capability",
        );
    }

    // Validate timeout
    let timeout = req.timeout.unwrap_or(DEFAULT_TIMEOUT_MS).min(MAX_TIMEOUT_MS);
    if req.timeout.is_some_and(|t| t > MAX_TIMEOUT_MS) {
        return error_response(
            StatusCode::BAD_REQUEST,
            "INVALID_REQUEST",
            &format!("timeout exceeds maximum of {MAX_TIMEOUT_MS}ms"),
        );
    }

    // Resolve pane
    let pane_id = match resolve_pane_id(req.pane_id.as_deref(), &state.manager) {
        Some(id) => id,
        None => {
            return error_response(StatusCode::NOT_FOUND, "NOT_FOUND", "No active terminal session")
        }
    };

    // Acquire run slot
    {
        let mut limiter = state.run_limiter.write().await;
        let count = limiter.entry("default".into()).or_insert(0);
        if *count >= MAX_CONCURRENT_RUNS {
            return error_response_with_headers(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                &format!("Maximum {MAX_CONCURRENT_RUNS} concurrent runs"),
                vec![("Retry-After", "5")],
            );
        }
        *count += 1;
    }

    // Execute the command
    let result = execute_command(&state, &pane_id, &req.command, timeout).await;

    // Release run slot
    {
        let mut limiter = state.run_limiter.write().await;
        if let Some(count) = limiter.get_mut("default") {
            *count = count.saturating_sub(1);
        }
    }

    match result {
        Ok(resp) => {
            // Audit log (only for agent tokens; global/session-cookie callers are trusted UI users)
            if !token_info.is_global {
                state.audit.record(
                    "agent",
                    "terminal:execute",
                    &pane_id,
                    serde_json::json!({
                        "command": req.command,
                        "exit_code": resp.exit_code,
                        "duration": resp.duration,
                    }),
                );
            }
            (StatusCode::OK, Json(serde_json::to_value(&resp).unwrap())).into_response()
        }
        Err((status, err)) => error_response(status, &err.code, &err.message),
    }
}

async fn execute_command(
    state: &AgentState,
    pane_id: &str,
    command: &str,
    timeout_ms: u64,
) -> Result<AgentRunResponse, (StatusCode, AgentError)> {
    let session = state.manager.sessions.get(pane_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            AgentError {
                code: "NOT_FOUND".into(),
                message: "Pane not found".into(),
                details: None,
            },
        )
    })?;

    // Send command + newline
    {
        // Clear any pending command tracking and start fresh
        session
            .screen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .begin_command_tracking();

        let cmd = format!("{command}\n");
        session.write_input_sync(cmd.as_bytes()).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                AgentError {
                    code: "INTERNAL_ERROR".into(),
                    message: format!("Failed to write to PTY: {e}"),
                    details: None,
                },
            )
        })?;
    }

    // Wait for command completion via OSC 133 or timeout
    let start = Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);
    let poll_interval = std::time::Duration::from_millis(50);

    loop {
        tokio::time::sleep(poll_interval).await;

        // Check for command results from OSC 133
        let results = session
            .screen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .drain_command_results();
        if let Some(result) = results.into_iter().next() {
            let stdout = session
                .screen
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take_command_output();
            return Ok(AgentRunResponse {
                exit_code: result.exit_code,
                stdout,
                stderr: String::new(),
                duration: result.duration_ms,
                pane_id: pane_id.to_string(),
                method: result.method,
            });
        }

        // Check for prompt detection fallback (after 100ms silence)
        {
            let mut screen =
                session.screen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if screen.should_check_prompt() {
                if let Some(result) = screen.detect_prompt() {
                    let stdout = screen.take_command_output();
                    return Ok(AgentRunResponse {
                        exit_code: result.exit_code,
                        stdout,
                        stderr: String::new(),
                        duration: result.duration_ms,
                        pane_id: pane_id.to_string(),
                        method: result.method,
                    });
                }
            }
        }

        // Check timeout
        if start.elapsed() >= timeout {
            // Force-finish command tracking
            let (stdout, result) = session
                .screen
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .finish_command_tracking(-1);

            return Ok(AgentRunResponse {
                exit_code: -1,
                stdout,
                stderr: String::new(),
                duration: result.duration_ms,
                pane_id: pane_id.to_string(),
                method: "timeout".into(),
            });
        }
    }
}

// ── POST /api/sessions/:pane_id/send ──

pub async fn sessions_send(
    State(state): State<AgentState>,
    axum::Extension(token_info): axum::Extension<TokenInfo>,
    Json(req): Json<AgentSendRequest>,
) -> impl IntoResponse {
    {
        let s = state.settings.read().await;
        if !s.open_api.enabled {
            return error_response(
                StatusCode::FORBIDDEN,
                "CAPABILITY_DENIED",
                "Agent API is disabled",
            );
        }
    }

    if !token_info.has_capability("terminal:write") {
        return error_response(
            StatusCode::FORBIDDEN,
            "CAPABILITY_DENIED",
            "Token lacks terminal:write capability",
        );
    }

    let pane_id = match resolve_pane_id(req.pane_id.as_deref(), &state.manager) {
        Some(id) => id,
        None => {
            return error_response(StatusCode::NOT_FOUND, "NOT_FOUND", "No active terminal session")
        }
    };

    match state.manager.sessions.get(&pane_id) {
        Some(session) => {
            let cmd = format!("{}\n", req.command);
            if let Err(e) = session.write_input_sync(cmd.as_bytes()) {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    &format!("Write failed: {e}"),
                );
            }
            if !token_info.is_global {
                state.audit.record(
                    "agent",
                    "terminal:send",
                    &pane_id,
                    serde_json::json!({"command": req.command}),
                );
            }
            (StatusCode::OK, Json(serde_json::json!({"ok": true, "pane_id": pane_id})))
                .into_response()
        }
        None => error_response(StatusCode::NOT_FOUND, "NOT_FOUND", "Pane not found"),
    }
}

// ── GET /api/sessions/:pane_id/read ──

pub async fn sessions_read(
    State(state): State<AgentState>,
    axum::Extension(token_info): axum::Extension<TokenInfo>,
    Query(q): Query<AgentReadQuery>,
) -> impl IntoResponse {
    {
        let s = state.settings.read().await;
        if !s.open_api.enabled {
            return error_response(
                StatusCode::FORBIDDEN,
                "CAPABILITY_DENIED",
                "Agent API is disabled",
            );
        }
    }

    if !token_info.has_capability("terminal:read") {
        return error_response(
            StatusCode::FORBIDDEN,
            "CAPABILITY_DENIED",
            "Token lacks terminal:read capability",
        );
    }

    let pane_id = match resolve_pane_id_from_str(&q.pane_id, &state.manager) {
        Some(id) => id,
        None => {
            return error_response(StatusCode::NOT_FOUND, "NOT_FOUND", "No active terminal session")
        }
    };

    match state.manager.sessions.get(&pane_id) {
        Some(session) => {
            let screen = session.screen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let lines_raw = screen.snapshot_plain();
            let lines = if q.strip_ansi { strip_ansi(&lines_raw) } else { lines_raw };
            let lines: Vec<String> = lines.split('\n').map(String::from).collect();

            let scrollback = q.scrollback.map(|n| {
                let raw = screen.snapshot_scrollback_plain(Some(n.min(10000)));
                if q.strip_ansi {
                    raw.iter().map(|s| strip_ansi(s)).collect()
                } else {
                    raw
                }
            });

            let (cols, rows) =
                *session.size.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let _ = (cols, rows);

            let cursor = {
                let (row, col) = screen.cursor_position();
                CursorInfo { row, col }
            };

            let cwd = session.cwd_for_workspace().and_then(|path| path.to_str().map(String::from));

            (
                StatusCode::OK,
                Json(serde_json::json!(AgentReadResponse {
                    pane_id,
                    lines,
                    scrollback,
                    cursor,
                    cwd,
                })),
            )
                .into_response()
        }
        None => error_response(StatusCode::NOT_FOUND, "NOT_FOUND", "Pane not found"),
    }
}

// ── WS /ws/events ──

pub async fn events_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AgentState>,
    State(settings): State<SettingsState>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let s = settings.read().await;
    let allowed_origins = s.auth.allowed_origins.clone();
    let trusted_proxies = s.auth.trusted_proxies.clone();
    drop(s);
    let real_ip = crate::auth::real_client_ip(&headers, addr.ip(), &trusted_proxies);
    if !crate::auth::check_ws_origin(&headers, &allowed_origins, real_ip, &trusted_proxies) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| handle_agent_ws(socket, state)).into_response()
}

async fn handle_agent_ws(socket: WebSocket, state: AgentState) {
    let (ws_tx, mut ws_rx) = socket.split();
    let (ws_out_tx, mut ws_out_rx) = mpsc::unbounded_channel::<Message>();

    // Writer task
    let writer_task = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        while let Some(msg) = ws_out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Ping task
    let ping_tx = ws_out_tx.clone();
    let ping_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await;
        loop {
            interval.tick().await;
            if ping_tx.send(Message::Ping(vec![])).is_err() {
                break;
            }
        }
    });

    // Subscribe to event bus
    let mut event_rx = state.manager.event_bus.subscribe();

    // Event forwarding task
    let evt_ws_out = ws_out_tx.clone();
    let evt_task = tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            let msg = serde_json::json!({
                "type": "event",
                "event": event,
            });
            if evt_ws_out.send(Message::Text(serde_json::to_string(&msg).unwrap())).is_err() {
                break;
            }
        }
    });

    // Track running commands for this connection
    let running_commands: Arc<RwLock<HashMap<String, bool>>> =
        Arc::new(RwLock::new(HashMap::new()));

    // Process incoming messages
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match msg_type {
                        "run" => {
                            let id =
                                val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let command = val
                                .get("command")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let timeout = val
                                .get("timeout")
                                .and_then(serde_json::Value::as_u64)
                                .unwrap_or(DEFAULT_TIMEOUT_MS)
                                .min(MAX_TIMEOUT_MS);

                            let ws_out = ws_out_tx.clone();
                            let st = state.clone();
                            let running = running_commands.clone();
                            let id_clone = id.clone();

                            tokio::spawn(async move {
                                running.write().await.insert(id_clone.clone(), true);

                                let pane_id = if let Some(p) = resolve_pane_id(None, &st.manager) {
                                    p
                                } else {
                                    let err = serde_json::json!({"type": "error", "id": id_clone, "error": {"code": "NOT_FOUND", "message": "No active session"}});
                                    let _ = ws_out.send(Message::Text(err.to_string()));
                                    running.write().await.remove(&id_clone);
                                    return;
                                };

                                match execute_command(&st, &pane_id, &command, timeout).await {
                                    Ok(resp) => {
                                        let result = serde_json::json!({
                                            "type": "result",
                                            "id": id_clone,
                                            "exit_code": resp.exit_code,
                                            "stdout": resp.stdout,
                                            "stderr": resp.stderr,
                                            "duration": resp.duration,
                                            "pane_id": resp.pane_id,
                                            "method": resp.method,
                                        });
                                        let _ = ws_out.send(Message::Text(result.to_string()));
                                    }
                                    Err((_, err)) => {
                                        let msg = serde_json::json!({"type": "error", "id": id_clone, "error": err});
                                        let _ = ws_out.send(Message::Text(msg.to_string()));
                                    }
                                }
                                running.write().await.remove(&id_clone);
                            });
                        }
                        "subscribe" => {
                            // Client subscribes to specific events — already handled by event forwarding
                            let ack = serde_json::json!({"type": "subscribed"});
                            let _ = ws_out_tx.send(Message::Text(ack.to_string()));
                        }
                        "ping" => {
                            let _ = ws_out_tx.send(Message::Text(r#"{"type":"pong"}"#.to_string()));
                        }
                        _ => {}
                    }
                }
            }
            Message::Ping(data) => {
                let _ = ws_out_tx.send(Message::Pong(data));
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    writer_task.abort();
    ping_task.abort();
    evt_task.abort();
}

// ── Error helpers ──

fn error_response(status: StatusCode, code: &str, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({"error": {"code": code, "message": message}}))).into_response()
}

fn error_response_with_headers(
    status: StatusCode,
    code: &str,
    message: &str,
    headers: Vec<(&str, &str)>,
) -> axum::response::Response {
    let mut builder = axum::response::Response::builder().status(status);
    for (k, v) in headers {
        builder = builder.header(k, v);
    }
    let body = Json(serde_json::json!({"error": {"code": code, "message": message}}));
    builder
        .header("content-type", "application/json")
        .body(axum::body::Body::from(serde_json::to_string(&body.0).unwrap()))
        .unwrap()
}

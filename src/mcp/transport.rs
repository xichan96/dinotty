#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    extract::State,
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    Json,
};
use futures_util::stream::Stream;
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, RwLock};

use super::server::{self, JsonRpcRequest, JsonRpcResponse, McpServer};
use crate::settings::SettingsState;

pub type McpState = Arc<McpServer>;

/// Run MCP stdio transport as a proxy to the main HTTP service. Reads
/// line-delimited JSON-RPC from stdin, forwards each request to
/// `POST {base_url}/mcp/message` with the Bearer token, and writes the
/// response body (the complete JSON-RPC response) back to stdout.
pub async fn run_stdio(base_url: &str, token: &str) {
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();
    let client = reqwest::Client::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let id = serde_json::from_str::<serde_json::Value>(trimmed)
                    .ok()
                    .and_then(|v| v.get("id").cloned());

                let response = client
                    .post(format!("{base_url}/mcp/message"))
                    .bearer_auth(token)
                    .header("content-type", "application/json")
                    .body(trimmed.to_string())
                    .send()
                    .await;

                let output = match response {
                    Ok(resp) => match resp.text().await {
                        // Notifications (no id) get an empty 200 body; skip them.
                        Ok(body) if body.is_empty() => String::new(),
                        Ok(mut body) => {
                            if !body.ends_with('\n') {
                                body.push('\n');
                            }
                            body
                        }
                        Err(e) => {
                            let resp = JsonRpcResponse::error(
                                id,
                                server::INTERNAL_ERROR,
                                format!("stdio proxy read error: {e}"),
                            );
                            format!("{}\n", serde_json::to_string(&resp).unwrap_or_default())
                        }
                    },
                    Err(e) => {
                        let resp = JsonRpcResponse::error(
                            id,
                            -32000,
                            format!("cannot reach MCP server at {base_url}: {e}"),
                        );
                        format!("{}\n", serde_json::to_string(&resp).unwrap_or_default())
                    }
                };

                if !output.is_empty() {
                    let _ = stdout.write_all(output.as_bytes()).await;
                    let _ = stdout.flush().await;
                }
            }
            Err(e) => {
                eprintln!("MCP stdin error: {e}");
                break;
            }
        }
    }
}

/// Shared SSE state for all connected clients.
pub struct SseState {
    clients: RwLock<Vec<mpsc::UnboundedSender<String>>>,
}

impl Default for SseState {
    fn default() -> Self {
        Self::new()
    }
}

impl SseState {
    #[must_use]
    pub fn new() -> Self {
        Self { clients: RwLock::new(Vec::new()) }
    }
}

/// Custom stream wrapper for SSE that wraps an mpsc receiver.
struct MpscReceiverStream {
    rx: mpsc::UnboundedReceiver<String>,
}

impl Stream for MpscReceiverStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.rx.poll_recv(cx) {
            Poll::Ready(Some(data)) => Poll::Ready(Some(Ok(Event::default().data(data)))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}

/// GET /mcp/sse — SSE endpoint for server-to-client messages.
pub async fn mcp_sse_handler(
    State(_server): State<McpState>,
    State(sse_state): State<Arc<SseState>>,
    State(settings): State<SettingsState>,
) -> Response {
    if !settings.read().await.mcp.http_enabled {
        return (StatusCode::NOT_FOUND, "mcp http disabled").into_response();
    }

    let (tx, rx) = mpsc::unbounded_channel::<String>();

    // Send initial endpoint event so the client knows where to POST messages
    let _ = tx.send(
        r#"{"jsonrpc":"2.0","method":"endpoint","params":{"uri":"/mcp/message"}}"#.to_string(),
    );

    // Register this client
    {
        let mut clients = sse_state.clients.write().await;
        clients.push(tx);
    }

    let stream = MpscReceiverStream { rx };
    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

/// POST /mcp/message — Client-to-server JSON-RPC messages.
pub async fn mcp_message_handler(
    State(server): State<McpState>,
    State(sse_state): State<Arc<SseState>>,
    State(settings): State<SettingsState>,
    axum::Extension(token_info): axum::Extension<crate::token::TokenInfo>,
    Json(request): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    let settings = settings.read().await;
    // HTTP and stdio clients both POST here; stdio is off by default.
    if !(settings.mcp.http_enabled || settings.mcp.stdio_enabled) {
        return (StatusCode::NOT_FOUND, "mcp disabled").into_response();
    }

    let response = server::handle_request(&server, request, &token_info).await;

    if let Some(resp) = response {
        let json = serde_json::to_string(&resp).unwrap_or_default();

        // Broadcast response to all SSE clients, removing disconnected ones
        let mut clients = sse_state.clients.write().await;
        clients.retain(|tx| tx.send(json.clone()).is_ok());

        (StatusCode::OK, Json(resp)).into_response()
    } else {
        StatusCode::OK.into_response()
    }
}

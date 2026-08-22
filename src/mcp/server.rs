#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::too_many_lines,
    clippy::unused_async,
    clippy::needless_pass_by_value,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::manual_let_else,
    clippy::match_same_arms
)]
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

use super::resources::McpResources;
use super::tools::McpTools;

/// MCP Server state shared across transports.
pub struct McpServer {
    pub tools: McpTools,
    pub resources: McpResources,
    pub server_info: ServerInfo,
}

#[derive(Serialize)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
}

impl McpServer {
    pub fn new(
        session_manager: Arc<crate::session::SessionManager>,
        settings: crate::settings::SettingsState,
    ) -> Self {
        Self {
            tools: McpTools::new(session_manager.clone(), settings.clone()),
            resources: McpResources::new(session_manager),
            server_info: ServerInfo {
                name: "dinotty".into(),
                version: env!("CARGO_PKG_VERSION").into(),
            },
        }
    }
}

// ── JSON-RPC 2.0 Types ──

#[derive(Deserialize, Debug)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Serialize, Debug)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Serialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcResponse {
    #[must_use]
    pub fn success(id: Option<Value>, result: Value) -> Self {
        Self { jsonrpc: "2.0".into(), id, result: Some(result), error: None }
    }

    #[must_use]
    pub fn error(id: Option<Value>, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: None,
            error: Some(JsonRpcError { code, message, data: None }),
        }
    }
}

// Error codes
pub const PARSE_ERROR: i32 = -32700;
pub const INVALID_REQUEST: i32 = -32600;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;
pub const INTERNAL_ERROR: i32 = -32603;

/// Process a single JSON-RPC request and return a response (or None for notifications).
pub async fn handle_request(
    server: &McpServer,
    request: JsonRpcRequest,
    token_info: &crate::token::TokenInfo,
) -> Option<JsonRpcResponse> {
    // Notifications (no id) don't get responses
    let is_notification = request.id.is_none();

    let response = match request.method.as_str() {
        "initialize" => handle_initialize(server, request.id.clone(), request.params).await,
        "ping" => JsonRpcResponse::success(request.id.clone(), serde_json::json!({})),
        "tools/list" => handle_tools_list(server, request.id.clone()).await,
        "tools/call" => {
            handle_tools_call(server, request.id.clone(), request.params, token_info).await
        }
        "resources/list" => handle_resources_list(server, request.id.clone()).await,
        "resources/read" => handle_resources_read(server, request.id.clone(), request.params).await,
        "resources/subscribe" => {
            JsonRpcResponse::success(request.id.clone(), serde_json::json!({}))
        }
        "resources/templates/list" => handle_resource_templates(server, request.id.clone()).await,
        "prompts/list" => {
            JsonRpcResponse::success(request.id.clone(), serde_json::json!({"prompts": []}))
        }
        _ => JsonRpcResponse::error(
            request.id,
            METHOD_NOT_FOUND,
            format!("Unknown method: {}", request.method),
        ),
    };

    if is_notification {
        None
    } else {
        Some(response)
    }
}

async fn handle_initialize(
    server: &McpServer,
    id: Option<Value>,
    _params: Option<Value>,
) -> JsonRpcResponse {
    JsonRpcResponse::success(
        id,
        serde_json::json!({
            "protocolVersion": "2024-11-05",
            "serverInfo": server.server_info,
            "capabilities": {
                "tools": {"listChanged": true},
                "resources": {"subscribe": true, "listChanged": true},
                "prompts": {"listChanged": false},
                "logging": {}
            }
        }),
    )
}

async fn handle_tools_list(server: &McpServer, id: Option<Value>) -> JsonRpcResponse {
    let tools = server.tools.list_tools();
    JsonRpcResponse::success(id, serde_json::json!({"tools": tools}))
}

async fn handle_tools_call(
    server: &McpServer,
    id: Option<Value>,
    params: Option<Value>,
    token_info: &crate::token::TokenInfo,
) -> JsonRpcResponse {
    let params = match params {
        Some(p) => p,
        None => return JsonRpcResponse::error(id, INVALID_PARAMS, "Missing params".into()),
    };

    let name = match params.get("name").and_then(|v| v.as_str()) {
        Some(n) => n.to_string(),
        None => return JsonRpcResponse::error(id, INVALID_PARAMS, "Missing tool name".into()),
    };

    // Check capability based on tool name
    let required_cap = match name.as_str() {
        "terminal_execute" | "terminal_send" => "terminal:write",
        "terminal_read" | "terminal_list" => "terminal:read",
        "file_read" | "file_list" => "workspace:read",
        "file_write" => "workspace:write",
        "git_status" | "git_diff" => "workspace:read",
        _ => {
            return JsonRpcResponse::error(id, METHOD_NOT_FOUND, format!("Unknown tool: {name}"));
        }
    };

    if !token_info.has_capability(required_cap) {
        return JsonRpcResponse::error(
            id,
            INTERNAL_ERROR,
            format!("Token lacks {required_cap} capability"),
        );
    }

    let arguments = params.get("arguments").cloned().unwrap_or(serde_json::json!({}));

    match server.tools.call_tool(&name, arguments, token_info).await {
        Ok(result) => JsonRpcResponse::success(
            id,
            serde_json::json!({
                "content": [{"type": "text", "text": result}],
            }),
        ),
        Err(e) => JsonRpcResponse::error(id, INTERNAL_ERROR, e),
    }
}

async fn handle_resources_list(server: &McpServer, id: Option<Value>) -> JsonRpcResponse {
    let resources = server.resources.list_resources();
    JsonRpcResponse::success(id, serde_json::json!({"resources": resources}))
}

async fn handle_resources_read(
    server: &McpServer,
    id: Option<Value>,
    params: Option<Value>,
) -> JsonRpcResponse {
    let params = match params {
        Some(p) => p,
        None => return JsonRpcResponse::error(id, INVALID_PARAMS, "Missing params".into()),
    };

    let uri = match params.get("uri").and_then(|v| v.as_str()) {
        Some(u) => u,
        None => return JsonRpcResponse::error(id, INVALID_PARAMS, "Missing resource URI".into()),
    };

    match server.resources.read_resource(uri) {
        Ok(content) => JsonRpcResponse::success(
            id,
            serde_json::json!({
                "contents": [{"uri": uri, "mimeType": "text/plain", "text": content}],
            }),
        ),
        Err(e) => JsonRpcResponse::error(id, INTERNAL_ERROR, e),
    }
}

async fn handle_resource_templates(server: &McpServer, id: Option<Value>) -> JsonRpcResponse {
    let templates = server.resources.list_templates();
    JsonRpcResponse::success(id, serde_json::json!({"resourceTemplates": templates}))
}

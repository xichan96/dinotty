//! Unit tests for MCP tool scope enforcement (pane + workspace path).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::server::{handle_request, JsonRpcRequest, McpServer};
use crate::session::test_support::stub_session;
use crate::session::SessionManager;
use crate::token::TokenInfo;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

fn make_server() -> McpServer {
    let manager = Arc::new(SessionManager::new());
    manager.sessions.insert("pane-1".into(), stub_session());
    manager.sessions.insert("pane-2".into(), stub_session());
    McpServer::new(
        manager,
        Arc::new(tokio::sync::RwLock::new(crate::settings::Settings::default())),
        Arc::new(crate::platform::shell_probe::ShellProbeService::new()),
    )
}

fn scoped_token(cap: &str, resources: Vec<String>) -> TokenInfo {
    let mut scopes: HashMap<String, Vec<String>> = HashMap::new();
    if !resources.is_empty() {
        scopes.insert(cap.into(), resources);
    }
    TokenInfo {
        token_id: "test".into(),
        is_global: false,
        capabilities: [cap].iter().map(|s| s.to_string()).collect::<HashSet<String>>(),
        scopes,
    }
}

async fn call_tool(
    server: &McpServer,
    name: &str,
    args: serde_json::Value,
    token: &TokenInfo,
) -> Result<String, String> {
    server.tools.call_tool(name, args, token).await
}

#[tokio::test]
async fn terminal_read_respects_pane_scope() {
    let server = make_server();
    let token = scoped_token("terminal:read", vec!["pane-1".into()]);

    let ok =
        call_tool(&server, "terminal_read", serde_json::json!({"pane_id": "pane-1"}), &token).await;
    assert!(ok.is_ok(), "in-scope read should succeed: {ok:?}");

    let denied =
        call_tool(&server, "terminal_read", serde_json::json!({"pane_id": "pane-2"}), &token).await;
    assert_eq!(denied.unwrap_err(), "Token terminal:read scope does not include pane pane-2");
}

#[tokio::test]
async fn terminal_send_and_execute_respect_pane_scope() {
    let server = make_server();
    let token = scoped_token("terminal:write", vec!["pane-1".into()]);

    let denied = call_tool(
        &server,
        "terminal_send",
        serde_json::json!({"command": "true", "pane_id": "pane-2"}),
        &token,
    )
    .await;
    assert_eq!(denied.unwrap_err(), "Token terminal:write scope does not include pane pane-2");

    // terminal_execute with explicit pane_id also goes through the scope check
    // (fails before any command is written to the PTY).
    let denied = call_tool(
        &server,
        "terminal_execute",
        serde_json::json!({"command": "true", "pane_id": "pane-2", "timeout": 500}),
        &token,
    )
    .await;
    assert_eq!(denied.unwrap_err(), "Token terminal:write scope does not include pane pane-2");
}

#[tokio::test]
async fn terminal_list_filters_out_of_scope_panes() {
    let server = make_server();

    let scoped = scoped_token("terminal:read", vec!["pane-1".into()]);
    let out = call_tool(&server, "terminal_list", serde_json::json!({}), &scoped).await.unwrap();
    let entries: Vec<serde_json::Value> = serde_json::from_str(&out).unwrap();
    let ids: Vec<&str> = entries.iter().filter_map(|e| e["pane_id"].as_str()).collect();
    assert_eq!(ids, vec!["pane-1"]);

    // No scope restriction: all panes listed.
    let unscoped = scoped_token("terminal:read", vec![]);
    let out = call_tool(&server, "terminal_list", serde_json::json!({}), &unscoped).await.unwrap();
    let entries: Vec<serde_json::Value> = serde_json::from_str(&out).unwrap();
    assert_eq!(entries.len(), 2);
}

struct HomeSandbox {
    root: std::path::PathBuf,
}

impl HomeSandbox {
    fn new(tag: &str) -> Self {
        let root = dirs::home_dir()
            .unwrap()
            .join(format!(".dinotty-mcp-scope-test-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(root.join("inside")).unwrap();
        std::fs::create_dir_all(root.join("outside")).unwrap();
        std::fs::write(root.join("inside/f.txt"), "hello").unwrap();
        std::fs::write(root.join("outside/f.txt"), "world").unwrap();
        Self { root }
    }
}

impl Drop for HomeSandbox {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[tokio::test]
async fn file_tools_respect_path_scope() {
    // Hold the env lock: parallel tests mutate HOME (ssh/key_path tests),
    // which would make dirs::home_dir() unstable inside sandbox_path.
    let _env = crate::test_support::EnvGuard::new(&["HOME"]);
    let sandbox = HomeSandbox::new("files");
    let server = make_server();
    let token = scoped_token(
        "workspace:read",
        vec![sandbox.root.join("inside").to_string_lossy().into_owned()],
    );

    let inside = sandbox.root.join("inside/f.txt");
    let ok = call_tool(
        &server,
        "file_read",
        serde_json::json!({"path": inside.to_string_lossy()}),
        &token,
    )
    .await;
    assert_eq!(ok.unwrap(), "hello");

    let outside = sandbox.root.join("outside/f.txt");
    let denied = call_tool(
        &server,
        "file_read",
        serde_json::json!({"path": outside.to_string_lossy()}),
        &token,
    )
    .await;
    assert!(
        denied.unwrap_err().contains("scope does not include"),
        "out-of-scope read should be denied"
    );

    // file_write with workspace:write scope
    let token = scoped_token(
        "workspace:write",
        vec![sandbox.root.join("inside").to_string_lossy().into_owned()],
    );
    let target = sandbox.root.join("inside/w.txt");
    let ok = call_tool(
        &server,
        "file_write",
        serde_json::json!({"path": target.to_string_lossy(), "content": "x"}),
        &token,
    )
    .await;
    assert!(ok.is_ok(), "in-scope write of a new file failed: {ok:?}");

    let target = sandbox.root.join("outside/w.txt");
    let denied = call_tool(
        &server,
        "file_write",
        serde_json::json!({"path": target.to_string_lossy(), "content": "x"}),
        &token,
    )
    .await;
    assert!(
        denied.unwrap_err().contains("scope does not include"),
        "out-of-scope write should be denied"
    );
}

#[tokio::test]
async fn handle_request_passes_token_info_to_tools() {
    let server = make_server();
    let token = scoped_token("terminal:read", vec!["pane-1".into()]);

    let request = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(serde_json::json!(1)),
        method: "tools/call".into(),
        params: Some(serde_json::json!({
            "name": "terminal_read",
            "arguments": {"pane_id": "pane-2"}
        })),
    };

    let response = handle_request(&server, request, &token).await.expect("response");
    let error = response.error.expect("out-of-scope read must fail");
    assert!(
        error.message.contains("scope does not include pane pane-2"),
        "unexpected error message: {}",
        error.message
    );
}

#[tokio::test]
async fn list_tools_includes_tab_and_pane_tools() {
    let server = make_server();
    let names: Vec<String> =
        server.tools.list_tools().into_iter().map(|t| t.name).collect();
    assert!(names.contains(&"tab_create".to_string()), "tab_create missing from tools/list");
    assert!(names.contains(&"pane_split".to_string()), "pane_split missing from tools/list");
}

#[tokio::test]
async fn tab_create_denied_without_capability() {
    let server = make_server();
    let token = scoped_token("terminal:read", vec![]);

    let denied = call_tool(&server, "tab_create", serde_json::json!({}), &token).await;
    assert_eq!(denied.unwrap_err(), "Token lacks terminal:create capability");
}

#[tokio::test]
async fn tab_create_validation_rejects_bad_argv_and_cwd() {
    // All denials fire in validation, before any shell probe or PTY spawn.
    let server = make_server();
    let token = scoped_token("terminal:create", vec![]);

    let denied = call_tool(&server, "tab_create", serde_json::json!({"argv": []}), &token).await;
    assert_eq!(
        denied.unwrap_err(),
        "Invalid request: argv must be a non-empty array"
    );

    let denied = call_tool(&server, "tab_create", serde_json::json!({"argv": [""]}), &token).await;
    assert_eq!(denied.unwrap_err(), "Invalid request: argv[0] must be a non-empty string");

    let denied = call_tool(
        &server,
        "tab_create",
        serde_json::json!({"cwd": "/definitely/not/a/dir"}),
        &token,
    )
    .await;
    assert_eq!(denied.unwrap_err(), "Invalid request: cwd must exist and be a directory");

    let denied = call_tool(
        &server,
        "tab_create",
        serde_json::json!({"argv": "not-an-array"}),
        &token,
    )
    .await;
    assert_eq!(denied.unwrap_err(), "argv must be an array of strings");
}

#[tokio::test]
async fn pane_split_denied_out_of_scope_pane() {
    let manager = Arc::new(SessionManager::new());
    manager.sessions.insert("pane-1".into(), stub_session());
    manager.sessions.insert("pane-2".into(), stub_session());
    manager.insert_tab(
        "tab-1".into(),
        serde_json::json!({
            "layout": {"type": "leaf", "paneId": "pane-1", "title": "t", "ratio": 1},
            "active_pane_id": "pane-1",
        }),
    );
    let server = McpServer::new(
        manager,
        Arc::new(tokio::sync::RwLock::new(crate::settings::Settings::default())),
        Arc::new(crate::platform::shell_probe::ShellProbeService::new()),
    );
    let token = scoped_token("terminal:create", vec!["pane-1".into()]);

    // Explicit out-of-scope source pane: denial fires before any session spawn.
    let denied = call_tool(
        &server,
        "pane_split",
        serde_json::json!({"tab_id": "tab-1", "pane_id": "pane-2"}),
        &token,
    )
    .await;
    assert_eq!(
        denied.unwrap_err(),
        "Token terminal:create scope does not include pane pane-2"
    );

    // Missing tab: resolved before the scope check (pane id is needed first).
    let denied =
        call_tool(&server, "pane_split", serde_json::json!({"tab_id": "tab-x"}), &token).await;
    assert_eq!(denied.unwrap_err(), "tab not found: tab-x");
}

#[tokio::test]
async fn handle_request_gates_terminal_create() {
    let server = make_server();
    let token = scoped_token("terminal:read", vec![]);

    let request = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(serde_json::json!(1)),
        method: "tools/call".into(),
        params: Some(serde_json::json!({
            "name": "tab_create",
            "arguments": {}
        })),
    };

    let response = handle_request(&server, request, &token).await.expect("response");
    let error = response.error.expect("capability gate must reject tab_create");
    assert!(
        error.message.contains("Token lacks terminal:create capability"),
        "unexpected error message: {}",
        error.message
    );
}

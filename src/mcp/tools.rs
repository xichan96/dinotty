#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::too_many_lines,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::needless_pass_by_value,
    clippy::format_push_string,
    clippy::manual_let_else,
    clippy::unused_self,
    clippy::unnecessary_wraps
)]
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::Instant;

use crate::platform::process::CommandNoWindowExt;
use crate::session::SessionManager;
use crate::settings::SettingsState;

pub struct McpTools {
    manager: Arc<SessionManager>,
    #[allow(dead_code)]
    settings: SettingsState,
}

#[derive(Serialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Value>,
}

impl McpTools {
    pub fn new(manager: Arc<SessionManager>, settings: SettingsState) -> Self {
        Self { manager, settings }
    }

    #[must_use]
    pub fn list_tools(&self) -> Vec<ToolDef> {
        vec![
            ToolDef {
                name: "terminal_execute".into(),
                description: "Execute a shell command and wait for completion. Returns structured output with exit code.".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "Shell command to execute"},
                        "cwd": {"type": "string", "description": "Working directory (optional)"},
                        "timeout": {"type": "number", "description": "Timeout in ms, default 300000 (5min), max 3600000 (1h)"}
                    },
                    "required": ["command"]
                }),
                annotations: Some(serde_json::json!({
                    "readOnlyHint": false,
                    "destructiveHint": true,
                    "idempotentHint": false,
                    "openWorldHint": true
                })),
            },
            ToolDef {
                name: "terminal_read".into(),
                description: "Read the current screen content of a terminal pane".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "pane_id": {"type": "string", "description": "Pane ID, or 'active' for current pane"}
                    }
                }),
                annotations: Some(serde_json::json!({"readOnlyHint": true})),
            },
            ToolDef {
                name: "terminal_send".into(),
                description: "Send input to a terminal without waiting for completion".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                        "pane_id": {"type": "string"}
                    },
                    "required": ["command"]
                }),
                annotations: Some(serde_json::json!({"readOnlyHint": false, "destructiveHint": false})),
            },
            ToolDef {
                name: "terminal_list".into(),
                description: "List all active terminal sessions".into(),
                input_schema: serde_json::json!({"type": "object", "properties": {}}),
                annotations: Some(serde_json::json!({"readOnlyHint": true})),
            },
            ToolDef {
                name: "file_read".into(),
                description: "Read file content from the workspace".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "pane_id": {"type": "string", "description": "Scope to this pane's workspace"}
                    },
                    "required": ["path"]
                }),
                annotations: Some(serde_json::json!({"readOnlyHint": true})),
            },
            ToolDef {
                name: "file_write".into(),
                description: "Write content to a file in the workspace".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                        "pane_id": {"type": "string"}
                    },
                    "required": ["path", "content"]
                }),
                annotations: Some(serde_json::json!({"readOnlyHint": false, "destructiveHint": true})),
            },
            ToolDef {
                name: "file_list".into(),
                description: "List files in a directory".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "default": "."},
                        "pane_id": {"type": "string"}
                    }
                }),
                annotations: Some(serde_json::json!({"readOnlyHint": true})),
            },
            ToolDef {
                name: "git_status".into(),
                description: "Get git status for the workspace".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {"pane_id": {"type": "string"}}
                }),
                annotations: Some(serde_json::json!({"readOnlyHint": true})),
            },
            ToolDef {
                name: "git_diff".into(),
                description: "Get git diff for a file".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "pane_id": {"type": "string"}
                    },
                    "required": ["path"]
                }),
                annotations: Some(serde_json::json!({"readOnlyHint": true})),
            },
        ]
    }

    pub async fn call_tool(&self, name: &str, args: Value) -> Result<String, String> {
        match name {
            "terminal_execute" => self.tool_terminal_execute(args).await,
            "terminal_read" => self.tool_terminal_read(args),
            "terminal_send" => self.tool_terminal_send(args),
            "terminal_list" => self.tool_terminal_list(),
            "file_read" => self.tool_file_read(args),
            "file_write" => self.tool_file_write(args),
            "file_list" => self.tool_file_list(args),
            "git_status" => self.tool_git_status(args),
            "git_diff" => self.tool_git_diff(args),
            _ => Err(format!("Unknown tool: {name}")),
        }
    }

    async fn tool_terminal_execute(&self, args: Value) -> Result<String, String> {
        let command = args.get("command").and_then(|v| v.as_str()).ok_or("Missing command")?;
        let timeout = args
            .get("timeout")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(300_000)
            .min(3_600_000);

        // Get or create a pane
        let pane_id = self
            .manager
            .active_pane_id
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .or_else(|| self.manager.sessions.iter().next().map(|e| e.key().clone()))
            .ok_or("No active terminal session")?;

        let session = self.manager.sessions.get(&pane_id).ok_or("Pane not found")?;

        // Send command
        {
            session
                .screen
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .begin_command_tracking();
            let cmd = format!("{command}\n");
            session.write_input_sync(cmd.as_bytes()).map_err(|e| format!("Write failed: {e}"))?;
        }

        // Wait for completion
        let start = Instant::now();
        let timeout_dur = std::time::Duration::from_millis(timeout);

        loop {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;

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
                return Ok(serde_json::json!({
                    "exit_code": result.exit_code,
                    "stdout": stdout,
                    "duration_ms": result.duration_ms,
                    "method": result.method
                })
                .to_string());
            }

            // Prompt detection fallback
            {
                let mut screen =
                    session.screen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                if screen.should_check_prompt() {
                    if let Some(result) = screen.detect_prompt() {
                        let stdout = screen.take_command_output();
                        return Ok(serde_json::json!({
                            "exit_code": result.exit_code,
                            "stdout": stdout,
                            "duration_ms": result.duration_ms,
                            "method": result.method
                        })
                        .to_string());
                    }
                }
            }

            if start.elapsed() >= timeout_dur {
                let (stdout, result) = session
                    .screen
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .finish_command_tracking(-1);
                return Ok(serde_json::json!({
                    "exit_code": -1,
                    "stdout": stdout,
                    "duration_ms": result.duration_ms,
                    "method": "timeout"
                })
                .to_string());
            }
        }
    }

    fn tool_terminal_read(&self, args: Value) -> Result<String, String> {
        let pane_id_arg = args.get("pane_id").and_then(|v| v.as_str()).unwrap_or("active");
        let pane_id = resolve_pane(pane_id_arg, &self.manager)?;

        let session = self.manager.sessions.get(&pane_id).ok_or("Pane not found")?;
        let screen = session.screen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let content = screen.snapshot_plain();
        Ok(content)
    }

    fn tool_terminal_send(&self, args: Value) -> Result<String, String> {
        let command = args.get("command").and_then(|v| v.as_str()).ok_or("Missing command")?;
        let pane_id_arg = args.get("pane_id").and_then(|v| v.as_str()).unwrap_or("active");
        let pane_id = resolve_pane(pane_id_arg, &self.manager)?;

        let session = self.manager.sessions.get(&pane_id).ok_or("Pane not found")?;
        let cmd = format!("{command}\n");
        session.write_input_sync(cmd.as_bytes()).map_err(|e| format!("Write failed: {e}"))?;
        Ok(r#"{"ok": true}"#.into())
    }

    fn tool_terminal_list(&self) -> Result<String, String> {
        let sessions: Vec<Value> = self
            .manager
            .sessions
            .iter()
            .map(|e| {
                let pane_id = e.key();
                let session = e.value();
                let (cols, rows) =
                    *session.size.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                let cwd =
                    session.cwd_for_workspace().and_then(|path| path.to_str().map(String::from));
                serde_json::json!({
                    "pane_id": pane_id,
                    "shell": session.shell_type,
                    "cols": cols,
                    "rows": rows,
                    "cwd": cwd,
                })
            })
            .collect();
        Ok(serde_json::to_string(&sessions).unwrap_or_default())
    }

    fn tool_file_read(&self, args: Value) -> Result<String, String> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
        let resolved = sandbox_path(path)?;
        std::fs::read_to_string(&resolved).map_err(|e| format!("Read failed: {e}"))
    }

    fn tool_file_write(&self, args: Value) -> Result<String, String> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
        let content = args.get("content").and_then(|v| v.as_str()).ok_or("Missing content")?;
        let resolved = sandbox_path(path)?;
        std::fs::write(&resolved, content).map_err(|e| format!("Write failed: {e}"))?;
        Ok(r#"{"ok": true}"#.into())
    }

    fn tool_file_list(&self, args: Value) -> Result<String, String> {
        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let resolved = sandbox_path(path)?;
        let entries: Vec<Value> = std::fs::read_dir(&resolved)
            .map_err(|e| format!("Read dir failed: {e}"))?
            .filter_map(std::result::Result::ok)
            .map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let is_dir = e.path().is_dir();
                serde_json::json!({"name": name, "is_dir": is_dir})
            })
            .collect();
        Ok(serde_json::to_string(&entries).unwrap_or_default())
    }

    fn tool_git_status(&self, _args: Value) -> Result<String, String> {
        let mut command = std::process::Command::new("git");
        let output = command
            .no_window()
            .args(["status", "--porcelain"])
            .output()
            .map_err(|e| format!("git failed: {e}"))?;
        String::from_utf8(output.stdout).map_err(|e| format!("utf8 error: {e}"))
    }

    fn tool_git_diff(&self, args: Value) -> Result<String, String> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
        let mut command = std::process::Command::new("git");
        let output = command
            .no_window()
            .args(["diff", path])
            .output()
            .map_err(|e| format!("git failed: {e}"))?;
        String::from_utf8(output.stdout).map_err(|e| format!("utf8 error: {e}"))
    }
}

fn resolve_pane(requested: &str, manager: &Arc<SessionManager>) -> Result<String, String> {
    if requested == "active" || requested.is_empty() {
        manager
            .active_pane_id
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .filter(|id| manager.sessions.contains_key(id))
            .or_else(|| manager.sessions.iter().next().map(|e| e.key().clone()))
            .ok_or_else(|| "No active session".into())
    } else if manager.sessions.contains_key(requested) {
        Ok(requested.into())
    } else {
        Err(format!("Pane not found: {requested}"))
    }
}

/// Validate and resolve a file path, ensuring it's under the user's home directory.
/// Prevents access to sensitive system files like /etc/shadow or ~/.`ssh/authorized_keys`.
fn sandbox_path(path: &str) -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let candidate = std::path::Path::new(path);

    // Resolve to canonical path (follows symlinks, resolves ..)
    let canonical = candidate.canonicalize().map_err(|e| format!("Path not found: {e}"))?;

    let home_canonical = home.canonicalize().map_err(|e| format!("Cannot resolve home: {e}"))?;

    if !canonical.starts_with(&home_canonical) {
        return Err(format!("Access denied: path must be under {}", home.display()));
    }

    Ok(canonical)
}

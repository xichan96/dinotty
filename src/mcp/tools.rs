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
use crate::platform::shell_probe::ShellProbeService;
use crate::session::SessionManager;
use crate::settings::SettingsState;
use crate::tabs::service::{CreateTabError, SplitPaneError};
use crate::token::TokenInfo;

pub struct McpTools {
    manager: Arc<SessionManager>,
    settings: SettingsState,
    shell_probe: Arc<ShellProbeService>,
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
    pub fn new(
        manager: Arc<SessionManager>,
        settings: SettingsState,
        shell_probe: Arc<ShellProbeService>,
    ) -> Self {
        Self { manager, settings, shell_probe }
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
                        "pane_id": {"type": "string", "description": "Pane ID, or 'active' for current pane (optional)"},
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
                name: "tab_create".into(),
                description: "Create a new terminal tab (optionally running a one-shot command). Mirrors POST /api/tabs. Returns tab_id, pane_id, layout, cwd.".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "cwd": {"type": "string", "description": "Working directory (optional, defaults to the default workspace root)"},
                        "argv": {"type": "array", "items": {"type": "string"}, "description": "Command to run instead of the interactive shell, e.g. [\"claude\"] (optional)"},
                        "title": {"type": "string", "description": "Tab title (optional, default \"Terminal\")"}
                    }
                }),
                annotations: Some(serde_json::json!({"readOnlyHint": false, "destructiveHint": false})),
            },
            ToolDef {
                name: "pane_split".into(),
                description: "Split a pane inside an existing tab, creating a sibling pane. Mirrors POST /api/tabs/:tab_id/pane. Supports SSH source panes. Returns new_pane_id and the updated layout.".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "tab_id": {"type": "string", "description": "Tab to split in"},
                        "pane_id": {"type": "string", "description": "Source pane (optional, defaults to the tab's active pane)"},
                        "direction": {"type": "string", "description": "horizontal | vertical | left | right | top | bottom (optional, default horizontal)"},
                        "cwd": {"type": "string", "description": "CWD override for local panes (optional, defaults to the source pane's CWD)"},
                        "force_local": {"type": "boolean", "description": "Create a local PTY even when the source pane is SSH (optional, default false)"}
                    },
                    "required": ["tab_id"]
                }),
                annotations: Some(serde_json::json!({"readOnlyHint": false, "destructiveHint": false})),
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

    pub async fn call_tool(
        &self,
        name: &str,
        args: Value,
        token_info: &TokenInfo,
    ) -> Result<String, String> {
        match name {
            "terminal_execute" => self.tool_terminal_execute(args, token_info).await,
            "terminal_read" => self.tool_terminal_read(args, token_info),
            "terminal_send" => self.tool_terminal_send(args, token_info),
            "terminal_list" => self.tool_terminal_list(token_info),
            "tab_create" => self.tool_tab_create(args, token_info).await,
            "pane_split" => self.tool_pane_split(args, token_info).await,
            "file_read" => self.tool_file_read(args, token_info),
            "file_write" => self.tool_file_write(args, token_info),
            "file_list" => self.tool_file_list(args, token_info),
            "git_status" => self.tool_git_status(args),
            "git_diff" => self.tool_git_diff(args, token_info),
            _ => Err(format!("Unknown tool: {name}")),
        }
    }

    async fn tool_terminal_execute(
        &self,
        args: Value,
        token_info: &TokenInfo,
    ) -> Result<String, String> {
        let command = args.get("command").and_then(|v| v.as_str()).ok_or("Missing command")?;
        let timeout = args
            .get("timeout")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(300_000)
            .min(3_600_000);

        // Get or create a pane
        let pane_id = match args.get("pane_id").and_then(|v| v.as_str()) {
            Some(arg) => resolve_pane(arg, &self.manager)?,
            None => self
                .manager
                .active_pane_id
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
                .or_else(|| self.manager.sessions.iter().next().map(|e| e.key().clone()))
                .ok_or("No active terminal session")?,
        };

        if !token_info.check_scope("terminal:write", &pane_id) {
            return Err(format!("Token terminal:write scope does not include pane {pane_id}"));
        }

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

    fn tool_terminal_read(&self, args: Value, token_info: &TokenInfo) -> Result<String, String> {
        let pane_id_arg = args.get("pane_id").and_then(|v| v.as_str()).unwrap_or("active");
        let pane_id = resolve_pane(pane_id_arg, &self.manager)?;

        if !token_info.check_scope("terminal:read", &pane_id) {
            return Err(format!("Token terminal:read scope does not include pane {pane_id}"));
        }

        let session = self.manager.sessions.get(&pane_id).ok_or("Pane not found")?;
        let screen = session.screen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let content = screen.snapshot_plain();
        Ok(content)
    }

    fn tool_terminal_send(&self, args: Value, token_info: &TokenInfo) -> Result<String, String> {
        let command = args.get("command").and_then(|v| v.as_str()).ok_or("Missing command")?;
        let pane_id_arg = args.get("pane_id").and_then(|v| v.as_str()).unwrap_or("active");
        let pane_id = resolve_pane(pane_id_arg, &self.manager)?;

        if !token_info.check_scope("terminal:write", &pane_id) {
            return Err(format!("Token terminal:write scope does not include pane {pane_id}"));
        }

        let session = self.manager.sessions.get(&pane_id).ok_or("Pane not found")?;
        let cmd = format!("{command}\n");
        session.write_input_sync(cmd.as_bytes()).map_err(|e| format!("Write failed: {e}"))?;
        Ok(r#"{"ok": true}"#.into())
    }

    fn tool_terminal_list(&self, token_info: &TokenInfo) -> Result<String, String> {
        let sessions: Vec<Value> = self
            .manager
            .sessions
            .iter()
            .filter(|e| token_info.check_scope("terminal:read", e.key()))
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

    async fn tool_tab_create(&self, args: Value, token_info: &TokenInfo) -> Result<String, String> {
        if !token_info.has_capability("terminal:create") {
            return Err("Token lacks terminal:create capability".into());
        }

        let cwd = args.get("cwd").and_then(|v| v.as_str()).map(String::from);
        let title = args.get("title").and_then(|v| v.as_str()).map(String::from);
        let argv_opt = match args.get("argv") {
            None | Some(Value::Null) => None,
            Some(Value::Array(items)) => {
                let mut parsed = Vec::with_capacity(items.len());
                for item in items {
                    let s = item
                        .as_str()
                        .ok_or_else(|| "argv must be an array of strings".to_string())?;
                    parsed.push(s.to_string());
                }
                Some(parsed)
            }
            Some(_) => return Err("argv must be an array of strings".into()),
        };

        let req = crate::tabs::CreateTabRequest { cwd, argv: argv_opt, title };
        match crate::tabs::service::create_tab(&self.manager, &self.settings, &self.shell_probe, req)
            .await
        {
            Ok(outcome) => Ok(serde_json::json!({
                "tab_id": outcome.tab_id,
                "pane_id": outcome.pane_id,
                "layout": outcome.layout,
                "cwd": outcome.cwd,
            })
            .to_string()),
            Err(err) => Err(match err {
                CreateTabError::Validation(e) => format!("Invalid request: {e}"),
                CreateTabError::ShellResolve(e) => format!("Shell resolve failed: {e}"),
                CreateTabError::PtyCreate(e) => format!("PTY create failed: {e}"),
                CreateTabError::SessionDiedEarly { argv_command: true } => {
                    "command exited before tab creation completed".into()
                }
                CreateTabError::SessionDiedEarly { argv_command: false } => {
                    "session closed before tab creation completed".into()
                }
            }),
        }
    }

    async fn tool_pane_split(&self, args: Value, token_info: &TokenInfo) -> Result<String, String> {
        if !token_info.has_capability("terminal:create") {
            return Err("Token lacks terminal:create capability".into());
        }

        let tab_id = args
            .get("tab_id")
            .and_then(|v| v.as_str())
            .ok_or("Missing tab_id")?
            .to_string();

        // Resolve the source pane: explicit pane_id, else the tab's active pane
        // (fallback: first leaf).
        let source_pane_id = if let Some(id) = args.get("pane_id").and_then(|v| v.as_str()) {
            id.to_string()
        } else {
            let tab_val = self
                .manager
                .tab_layouts
                .get(&tab_id)
                .ok_or_else(|| format!("tab not found: {tab_id}"))?;
            let pane_id = tab_val
                .get("active_pane_id")
                .and_then(|v| v.as_str())
                .map(String::from)
                .or_else(|| {
                    tab_val.get("layout").and_then(crate::session::first_leaf_id)
                })
                .ok_or("tab has no panes")?;
            drop(tab_val);
            pane_id
        };

        if !token_info.check_scope("terminal:create", &source_pane_id) {
            return Err(format!(
                "Token terminal:create scope does not include pane {source_pane_id}"
            ));
        }

        let direction = args
            .get("direction")
            .and_then(|v| v.as_str())
            .unwrap_or("horizontal")
            .to_string();
        let force_local =
            args.get("force_local").and_then(serde_json::Value::as_bool).unwrap_or(false);
        let cwd = args.get("cwd").and_then(|v| v.as_str()).map(String::from);

        let req = crate::tabs::SplitPaneRequest {
            pane_id: source_pane_id,
            direction,
            force_local,
            cwd,
        };
        match crate::tabs::service::split_pane(
            &self.manager,
            &self.settings,
            &self.shell_probe,
            &tab_id,
            req,
        )
        .await
        {
            Ok(outcome) => Ok(serde_json::json!({
                "tab_id": tab_id,
                "new_pane_id": outcome.new_pane_id,
                "layout": outcome.layout,
            })
            .to_string()),
            Err(err) => Err(match err {
                SplitPaneError::TabNotFound => format!("tab not found: {tab_id}"),
                SplitPaneError::TabHasNoLayout => "tab has no layout".into(),
                SplitPaneError::PaneNotFoundInTab => "pane not found in tab".into(),
                SplitPaneError::ShellResolve(e) => format!("Shell resolve failed: {e}"),
                SplitPaneError::SessionCreate(e) => format!("session create failed: {e}"),
                SplitPaneError::LayoutUpdateFailed => "failed to update layout".into(),
            }),
        }
    }

    fn tool_file_read(&self, args: Value, token_info: &TokenInfo) -> Result<String, String> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
        let resolved = sandbox_path(path)?;
        if !token_info.check_path_scope("workspace:read", &resolved) {
            return Err(format!(
                "Token workspace:read scope does not include {}",
                resolved.display()
            ));
        }
        std::fs::read_to_string(&resolved).map_err(|e| format!("Read failed: {e}"))
    }

    fn tool_file_write(&self, args: Value, token_info: &TokenInfo) -> Result<String, String> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
        let content = args.get("content").and_then(|v| v.as_str()).ok_or("Missing content")?;
        let resolved = sandbox_path(path)?;
        if !token_info.check_path_scope("workspace:write", &resolved) {
            return Err(format!(
                "Token workspace:write scope does not include {}",
                resolved.display()
            ));
        }
        std::fs::write(&resolved, content).map_err(|e| format!("Write failed: {e}"))?;
        Ok(r#"{"ok": true}"#.into())
    }

    fn tool_file_list(&self, args: Value, token_info: &TokenInfo) -> Result<String, String> {
        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let resolved = sandbox_path(path)?;
        if !token_info.check_path_scope("workspace:read", &resolved) {
            return Err(format!(
                "Token workspace:read scope does not include {}",
                resolved.display()
            ));
        }
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

    fn tool_git_diff(&self, args: Value, token_info: &TokenInfo) -> Result<String, String> {
        let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing path")?;
        if let Ok(resolved) = sandbox_path(path) {
            if !token_info.check_path_scope("workspace:read", &resolved) {
                return Err(format!(
                    "Token workspace:read scope does not include {}",
                    resolved.display()
                ));
            }
        }
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
    let canonical = match candidate.canonicalize() {
        Ok(c) => c,
        // Not-yet-existing leaf (e.g. file_write creating a new file):
        // resolve the parent and append the file name.
        Err(_) => candidate
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .and_then(|p| candidate.file_name().map(|n| p.join(n)))
            .ok_or_else(|| format!("Path not found: {path}"))?,
    };

    let home_canonical = home.canonicalize().map_err(|e| format!("Cannot resolve home: {e}"))?;

    if !canonical.starts_with(&home_canonical) {
        return Err(format!("Access denied: path must be under {}", home.display()));
    }

    Ok(canonical)
}

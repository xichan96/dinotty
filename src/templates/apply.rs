//! `POST /api/templates/apply` - two-phase template application with rollback.
//!
//! Flow:
//! 1. Load the template (tries workspace scope first, then global)
//! 2. Walk the layout tree; for each terminal leaf, create the PTY session
//!    up front without touching `tab_layouts`. Track created sessions for
//!    rollback if any leaf fails.
//! 3. If all leaves prepared successfully, commit: insert the new tab into
//!    `tab_layouts`, broadcast `TabCreated` + `LayoutUpdated`.
//! 4. After commit, write `startup_command` to each terminal pane in
//!    parallel (failures don't roll back the tab - the pane still works).
//!
//! See `.claude/doc/layout-templates-design.md` §3.3 for the design.

#![allow(clippy::too_many_arguments, clippy::too_many_lines, clippy::match_same_arms)]

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::platform::shell;
use crate::plugin::PluginManagerState;
use crate::pty;
use crate::session::{SessionManager, SyncMsg};

use super::store::{StoreError, TemplateStore};
use super::types::{ApplyTemplateBody, Template, TemplateScope};

fn err_response(status: StatusCode, msg: &str) -> axum::response::Response {
    (status, Json(json!({ "error": msg }))).into_response()
}

/// Walk the layout tree and prepare every leaf in place:
///
/// - terminal: validate cwd (fallback to home), call `pty::create_session`,
///   collect the new paneId + `startup_command` for later.
/// - plugin: check if the plugin is installed; if not, mark the leaf with
///   `load_error: "not_installed"` and a placeholder title so the frontend
///   can show an install prompt.
/// - files: validate path; if missing, downgrade to workspace root or `~`.
/// - web: nothing to do.
///
/// On any PTY creation failure, returns `Err` and the caller must roll back
/// the already-created PTY sessions listed in `created_pty_ids`.
fn prepare_layout(
    layout: &mut Value,
    manager: &Arc<SessionManager>,
    plugins: &PluginManagerState,
    new_tab_id: &str,
    installed_plugin_ids: &HashSet<String>,
    created_pty_ids: &mut Vec<String>,
    startup_commands: &mut Vec<(String, String)>,
    warnings: &mut Vec<String>,
) -> Result<(), (StatusCode, String)> {
    let Some(node_type) = layout.get("type").and_then(|v| v.as_str()).map(str::to_string) else {
        return Ok(());
    };

    if node_type == "leaf" {
        let kind = layout.get("kind").and_then(|v| v.as_str()).unwrap_or("terminal").to_string();
        let new_pane_id = Uuid::new_v4().to_string();

        match kind.as_str() {
            "terminal" => {
                // Resolve cwd: template-provided > home.
                let cwd = layout.get("cwd").and_then(|v| v.as_str());
                let cwd_path = match cwd {
                    Some(p) if !p.is_empty() && PathBuf::from(p).is_dir() => Some(PathBuf::from(p)),
                    Some(p) if !p.is_empty() => {
                        warnings.push(format!("cwd '{p}' not found, using home"));
                        Some(shell::home_dir())
                    }
                    _ => None,
                };

                // Check if this was originally an SSH pane (we can't restore
                // the connection). Downgrade to a plain terminal with a warning.
                let is_ssh =
                    layout.get("shell_type").and_then(|v| v.as_str()).is_some_and(|s| s == "ssh");
                if is_ssh {
                    warnings.push(
                        "SSH pane downgraded to local terminal (reconnect manually)".to_string(),
                    );
                    if let Some(obj) = layout.as_object_mut() {
                        obj.remove("shell_type");
                    }
                }

                match pty::create_session(
                    manager,
                    &new_pane_id,
                    Some(new_tab_id),
                    None,
                    cwd_path,
                    None,
                ) {
                    Ok((_session, _shell_type)) => {
                        created_pty_ids.push(new_pane_id.clone());
                        if let Some(obj) = layout.as_object_mut() {
                            obj.insert("paneId".to_string(), Value::String(new_pane_id.clone()));
                        }
                        if let Some(cmd) = layout
                            .get("startup_command")
                            .and_then(|v| v.as_str())
                            .map(str::to_string)
                            .filter(|s| !s.is_empty())
                        {
                            startup_commands.push((new_pane_id.clone(), cmd));
                        }
                        Ok(())
                    }
                    Err(e) => Err((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to create PTY: {e}"),
                    )),
                }
            }
            "plugin" => {
                let plugin_id =
                    layout.get("pluginId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if !plugin_id.is_empty() && !installed_plugin_ids.contains(&plugin_id) {
                    warnings
                        .push(format!("plugin '{plugin_id}' not installed, showing placeholder"));
                    if let Some(obj) = layout.as_object_mut() {
                        obj.insert(
                            "load_error".to_string(),
                            Value::String("not_installed".to_string()),
                        );
                        obj.insert(
                            "title".to_string(),
                            Value::String(format!("Plugin {plugin_id} (not installed)")),
                        );
                    }
                }
                if let Some(obj) = layout.as_object_mut() {
                    obj.insert("paneId".to_string(), Value::String(new_pane_id));
                }
                let _ = plugins; // silence unused warning when no plugin check is needed
                Ok(())
            }
            "files" => {
                let path = layout.get("path").and_then(|v| v.as_str()).unwrap_or("");
                if !path.is_empty() && !PathBuf::from(path).exists() {
                    warnings.push(format!("files path '{path}' not found"));
                    if let Some(obj) = layout.as_object_mut() {
                        obj.insert(
                            "path".to_string(),
                            Value::String(shell::home_dir().to_string_lossy().into_owned()),
                        );
                    }
                }
                if let Some(obj) = layout.as_object_mut() {
                    obj.insert("paneId".to_string(), Value::String(new_pane_id));
                }
                Ok(())
            }
            "web" => {
                if let Some(obj) = layout.as_object_mut() {
                    obj.insert("paneId".to_string(), Value::String(new_pane_id));
                }
                Ok(())
            }
            _ => {
                if let Some(obj) = layout.as_object_mut() {
                    obj.insert("paneId".to_string(), Value::String(new_pane_id));
                }
                Ok(())
            }
        }
    } else if node_type == "split" {
        if let Some(children) = layout.get_mut("children").and_then(|c| c.as_array_mut()) {
            for child in children {
                prepare_layout(
                    child,
                    manager,
                    plugins,
                    new_tab_id,
                    installed_plugin_ids,
                    created_pty_ids,
                    startup_commands,
                    warnings,
                )?;
            }
        }
        Ok(())
    } else {
        Ok(())
    }
}

/// Load a template by id, trying workspace scope first (when `workspace_id`
/// is provided), then global.
fn load_template_any_scope(req: &ApplyTemplateBody) -> Result<Template, (StatusCode, String)> {
    let store = TemplateStore::new();

    if let Some(ws_id) = req.workspace_id.as_deref().filter(|s| !s.is_empty()) {
        if let Ok(tpl) = store.load(TemplateScope::Workspace, Some(ws_id), &req.template_id) {
            return Ok(tpl);
        }
    }
    store.load(TemplateScope::Global, None, &req.template_id).map_err(|e| match e {
        StoreError::NotFound => (StatusCode::NOT_FOUND, "template not found".into()),
        other => (StatusCode::INTERNAL_SERVER_ERROR, format!("load template: {other}")),
    })
}

/// `POST /api/templates/apply`
pub async fn apply_template(
    State((plugins, manager)): State<(PluginManagerState, Arc<SessionManager>)>,
    Json(req): Json<ApplyTemplateBody>,
) -> impl IntoResponse {
    let template = match load_template_any_scope(&req) {
        Ok(t) => t,
        Err((status, msg)) => return err_response(status, &msg),
    };

    let installed_plugin_ids: HashSet<String> =
        plugins.list().into_iter().map(|p| p.manifest.id).collect();

    let mut layout = template.layout.clone();
    let new_tab_id = Uuid::new_v4().to_string();
    let mut created_pty_ids: Vec<String> = Vec::new();
    let mut startup_commands: Vec<(String, String)> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    // Phase 1: prepare all leaves. On failure, roll back any PTY sessions
    // we already created.
    if let Err((status, msg)) = prepare_layout(
        &mut layout,
        &manager,
        &plugins,
        &new_tab_id,
        &installed_plugin_ids,
        &mut created_pty_ids,
        &mut startup_commands,
        &mut warnings,
    ) {
        for pane_id in &created_pty_ids {
            manager.kill_and_remove(pane_id);
        }
        return err_response(status, &msg);
    }

    // Phase 2: commit. Pick the first pane as active (or a deterministic
    // fallback when the tree is degenerate).
    let active_pane_id =
        collect_first_pane_id(&layout).unwrap_or_else(|| Uuid::new_v4().to_string());

    manager.insert_tab(
        new_tab_id.clone(),
        json!({
            "layout": layout.clone(),
            "active_pane_id": active_pane_id,
        }),
    );
    *manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some(active_pane_id.clone());

    manager.broadcast_sync(&SyncMsg::TabCreated {
        tab_id: new_tab_id.clone(),
        pane_id: active_pane_id.clone(),
        layout: Some(layout.clone()),
        cwd: None,
        connection_id: None,
    });
    manager.broadcast_sync(&SyncMsg::LayoutUpdated {
        pane_id: new_tab_id.clone(),
        layout: layout.clone(),
        active_pane_id: active_pane_id.clone(),
    });

    // Phase 3: write startup_commands in parallel (best-effort).
    if !startup_commands.is_empty() {
        let manager_clone = Arc::clone(&manager);
        tokio::task::spawn_blocking(move || {
            for (pane_id, cmd) in startup_commands {
                let Some(session) =
                    manager_clone.sessions.get(&pane_id).map(|r| Arc::clone(r.value()))
                else {
                    continue;
                };
                let payload = format!("{cmd}\n");
                if let Err(e) = session.write_input_sync(payload.as_bytes()) {
                    tracing::warn!("startup_command write failed for {pane_id}: {e}");
                }
            }
        });
    }

    Json(json!({
        "tab_id": new_tab_id,
        "layout": layout,
        "warnings": warnings,
    }))
    .into_response()
}

/// Return the paneId of the first leaf (pre-order traversal) in the tree.
fn collect_first_pane_id(layout: &Value) -> Option<String> {
    if layout.get("type").and_then(|v| v.as_str()) == Some("leaf") {
        return layout.get("paneId").and_then(|v| v.as_str()).map(str::to_string);
    }
    if let Some(children) = layout.get("children").and_then(|c| c.as_array()) {
        for child in children {
            if let Some(id) = collect_first_pane_id(child) {
                return Some(id);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin::PluginManager;
    use serde_json::json;

    #[test]
    fn collect_first_pane_id_returns_leftmost_leaf() {
        let layout = json!({
            "type": "split",
            "direction": "horizontal",
            "children": [
                {"type": "leaf", "paneId": "a"},
                {"type": "split", "direction": "vertical", "children": [
                    {"type": "leaf", "paneId": "b"},
                    {"type": "leaf", "paneId": "c"},
                ]},
            ],
            "ratios": [0.5, 0.5]
        });
        assert_eq!(collect_first_pane_id(&layout).as_deref(), Some("a"));
    }

    #[test]
    fn collect_first_pane_id_single_leaf() {
        let layout = json!({"type": "leaf", "paneId": "x"});
        assert_eq!(collect_first_pane_id(&layout).as_deref(), Some("x"));
    }

    #[test]
    fn collect_first_pane_id_empty_tree() {
        let layout = json!({"type": "split", "direction": "horizontal", "children": []});
        assert!(collect_first_pane_id(&layout).is_none());
    }

    fn fresh_plugin_manager() -> PluginManagerState {
        Arc::new(PluginManager::new("http://test".into(), "test".into()))
    }

    #[test]
    fn prepare_plugin_leaf_marks_missing_plugin() {
        let manager = Arc::new(SessionManager::new());
        let plugins = fresh_plugin_manager();
        let installed = HashSet::<String>::new();
        let mut layout = json!({
            "type": "leaf",
            "kind": "plugin",
            "paneId": "orig",
            "title": "Git",
            "pluginId": "missing-plugin"
        });
        let mut created = Vec::new();
        let mut startup = Vec::new();
        let mut warnings = Vec::new();

        prepare_layout(
            &mut layout,
            &manager,
            &plugins,
            "tab-1",
            &installed,
            &mut created,
            &mut startup,
            &mut warnings,
        )
        .unwrap();

        assert_eq!(created.len(), 0, "no PTY should be created for plugin leaf");
        assert_eq!(layout.get("load_error").and_then(|v| v.as_str()), Some("not_installed"));
        assert!(warnings.iter().any(|w| w.contains("missing-plugin")));
    }

    #[test]
    fn prepare_files_leaf_downgrades_missing_path() {
        let manager = Arc::new(SessionManager::new());
        let plugins = fresh_plugin_manager();
        let installed = HashSet::<String>::new();
        let missing_path = "/this/path/does/not/exist/anywhere";
        let mut layout = json!({
            "type": "leaf",
            "kind": "files",
            "paneId": "orig",
            "title": "Files",
            "path": missing_path
        });
        let mut created = Vec::new();
        let mut startup = Vec::new();
        let mut warnings = Vec::new();

        prepare_layout(
            &mut layout,
            &manager,
            &plugins,
            "tab-1",
            &installed,
            &mut created,
            &mut startup,
            &mut warnings,
        )
        .unwrap();

        let new_path = layout.get("path").and_then(|v| v.as_str()).unwrap_or("");
        assert!(new_path != missing_path, "missing path should be downgraded");
        assert!(warnings.iter().any(|w| w.contains("not found")));
    }

    #[test]
    fn prepare_web_leaf_just_assigns_new_pane_id() {
        let manager = Arc::new(SessionManager::new());
        let plugins = fresh_plugin_manager();
        let installed = HashSet::<String>::new();
        let mut layout = json!({
            "type": "leaf",
            "kind": "web",
            "paneId": "orig",
            "title": "Preview",
            "url": "http://localhost:5173"
        });
        let mut created = Vec::new();
        let mut startup = Vec::new();
        let mut warnings = Vec::new();

        prepare_layout(
            &mut layout,
            &manager,
            &plugins,
            "tab-1",
            &installed,
            &mut created,
            &mut startup,
            &mut warnings,
        )
        .unwrap();

        assert_eq!(created.len(), 0, "web leaf should not create PTY");
        assert!(warnings.is_empty());
        assert_ne!(layout.get("paneId").and_then(|v| v.as_str()), Some("orig"));
        // url preserved
        assert_eq!(layout.get("url").and_then(|v| v.as_str()), Some("http://localhost:5173"));
    }

    #[test]
    fn prepare_plugin_leaf_with_installed_plugin_no_warning() {
        let manager = Arc::new(SessionManager::new());
        let plugins = fresh_plugin_manager();
        let mut installed = HashSet::new();
        installed.insert("git-panel".to_string());

        let mut layout = json!({
            "type": "leaf",
            "kind": "plugin",
            "paneId": "orig",
            "title": "Git",
            "pluginId": "git-panel"
        });
        let mut created = Vec::new();
        let mut startup = Vec::new();
        let mut warnings = Vec::new();

        prepare_layout(
            &mut layout,
            &manager,
            &plugins,
            "tab-1",
            &installed,
            &mut created,
            &mut startup,
            &mut warnings,
        )
        .unwrap();

        assert_eq!(layout.get("load_error"), None, "no load_error for installed plugin");
        assert!(warnings.is_empty());
    }

    #[test]
    fn prepare_layout_recurses_split_children() {
        let manager = Arc::new(SessionManager::new());
        let plugins = fresh_plugin_manager();
        let installed = HashSet::<String>::new();
        let mut layout = json!({
            "type": "split",
            "direction": "horizontal",
            "children": [
                {"type": "leaf", "kind": "plugin", "paneId": "a", "title": "A", "pluginId": "x"},
                {"type": "leaf", "kind": "web", "paneId": "b", "title": "B", "url": "http://1"}
            ],
            "ratios": [0.5, 0.5]
        });
        let mut created = Vec::new();
        let mut startup = Vec::new();
        let mut warnings = Vec::new();

        prepare_layout(
            &mut layout,
            &manager,
            &plugins,
            "tab-1",
            &installed,
            &mut created,
            &mut startup,
            &mut warnings,
        )
        .unwrap();

        let children = layout.get("children").unwrap().as_array().unwrap();
        assert_ne!(children[0].get("paneId").and_then(|v| v.as_str()), Some("a"));
        assert_ne!(children[1].get("paneId").and_then(|v| v.as_str()), Some("b"));
    }

    #[tokio::test]
    async fn prepare_terminal_leaf_with_ssh_shell_type_downgrades_and_creates_pty() {
        let manager = Arc::new(SessionManager::new());
        let plugins = fresh_plugin_manager();
        let installed = HashSet::<String>::new();
        let mut layout = json!({
            "type": "leaf",
            "kind": "terminal",
            "paneId": "orig",
            "title": "SSH",
            "shell_type": "ssh"
        });
        let mut created = Vec::new();
        let mut startup = Vec::new();
        let mut warnings = Vec::new();

        prepare_layout(
            &mut layout,
            &manager,
            &plugins,
            "tab-1",
            &installed,
            &mut created,
            &mut startup,
            &mut warnings,
        )
        .unwrap();

        // PTY created (with default local shell, not SSH).
        assert_eq!(created.len(), 1, "downgraded SSH pane still creates a local PTY");
        // shell_type removed so frontend doesn't try to render SSH chrome.
        assert_eq!(layout.get("shell_type"), None);
        // Warning surfaced to the user.
        assert!(warnings.iter().any(|w| w.contains("SSH pane downgraded")));

        // Cleanup spawned PTY so the test process can exit.
        for pane_id in &created {
            manager.kill_and_remove(pane_id);
        }
    }

    #[tokio::test]
    async fn prepare_terminal_leaf_with_startup_command_collects_for_later_write() {
        let manager = Arc::new(SessionManager::new());
        let plugins = fresh_plugin_manager();
        let installed = HashSet::<String>::new();
        let mut layout = json!({
            "type": "leaf",
            "kind": "terminal",
            "paneId": "orig",
            "title": "Dev",
            "cwd": "/tmp",
            "startup_command": "echo hello"
        });
        let mut created = Vec::new();
        let mut startup = Vec::new();
        let mut warnings = Vec::new();

        prepare_layout(
            &mut layout,
            &manager,
            &plugins,
            "tab-1",
            &installed,
            &mut created,
            &mut startup,
            &mut warnings,
        )
        .unwrap();

        assert_eq!(created.len(), 1);
        assert_eq!(startup.len(), 1);
        assert_eq!(startup[0].1, "echo hello");

        // Cleanup spawned PTY so the test process can exit.
        for pane_id in &created {
            manager.kill_and_remove(pane_id);
        }
    }
}

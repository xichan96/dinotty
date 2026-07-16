use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Deserializer};
use std::path::PathBuf;
use std::sync::Arc;

use crate::pty;
use crate::session::{self, SessionManager, SshSessionParams, SyncMsg};
use crate::settings::SettingsState;
use crate::ssh;

// ─── Request/Response types ────────────────────────────────────────

#[derive(Deserialize)]
pub struct SplitPaneRequest {
    pub pane_id: String,
    pub direction: String, // "horizontal" or "vertical"
    /// When true, always create a local PTY even if the source pane is SSH.
    #[serde(default)]
    pub force_local: bool,
    /// Optional CWD override for the new pane (used with `force_local`).
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateLayoutRequest {
    pub layout: serde_json::Value,
    pub active_pane_id: String,
}

#[derive(Deserialize)]
pub struct CreateTabRequest {
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_argv")]
    pub argv: Option<Vec<String>>,
    #[serde(default)]
    pub title: Option<String>,
}

fn deserialize_optional_argv<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Vec::<String>::deserialize(deserializer).map(Some)
}

fn validate_create_tab_request(req: &CreateTabRequest) -> Result<Option<PathBuf>, String> {
    if let Some(argv) = req.argv.as_ref() {
        if argv.is_empty() {
            return Err("argv must be a non-empty array".to_string());
        }
        if argv[0].is_empty() {
            return Err("argv[0] must be a non-empty string".to_string());
        }
        if argv.iter().any(|arg| arg.contains('\0')) {
            return Err("argv entries must not contain NUL bytes".to_string());
        }
    }

    req.cwd.as_ref().map(PathBuf::from).map_or(Ok(None), |cwd| {
        if cwd.is_dir() {
            Ok(Some(cwd))
        } else {
            Err("cwd must exist and be a directory".to_string())
        }
    })
}

// ─── GET /api/tabs ─────────────────────────────────────────────────

#[allow(clippy::unused_async)]
pub async fn list_tabs(State(manager): State<Arc<SessionManager>>) -> impl IntoResponse {
    let (tabs, active_pane_id) = manager.tab_list();
    Json(serde_json::json!({
        "tabs": tabs,
        "active_pane_id": active_pane_id,
    }))
}

// ─── POST /api/tabs ────────────────────────────────────────────────

#[allow(clippy::unused_async)]
pub async fn create_tab(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Json(req): Json<CreateTabRequest>,
) -> impl IntoResponse {
    let requested_cwd = match validate_create_tab_request(&req) {
        Ok(cwd) => cwd,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e })))
                .into_response();
        }
    };
    let tab_id = uuid::Uuid::new_v4().to_string();
    let pane_id = uuid::Uuid::new_v4().to_string();

    // Resolve CWD: explicit request > configured default workspace root > $HOME.
    let cwd = match requested_cwd {
        Some(cwd) => Some(cwd),
        None => settings.read().await.resolved_default_workspace_root(),
    };
    let is_argv_command = req.argv.is_some();

    // Create PTY session
    let (session, shell_type) =
        match pty::create_session(&manager, &pane_id, Some(&tab_id), None, cwd, req.argv) {
            Ok(x) => x,
            Err(e) => {
                tracing::error!("Failed to create PTY: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": e })),
                )
                    .into_response();
            }
        };

    // Create initial layout with single leaf
    let title = req.title.as_deref().unwrap_or("Terminal");
    let layout = serde_json::json!({
        "type": "leaf",
        "paneId": pane_id,
        "title": title,
        "shell_type": shell_type,
        "ratio": 1,
        "zoomed": false,
    });

    let publish_tab = || {
        manager.insert_tab(
            tab_id.clone(),
            serde_json::json!({
                "layout": layout,
                "active_pane_id": pane_id,
            }),
        );

        *manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some(pane_id.clone());

        manager.broadcast_sync(&SyncMsg::TabCreated {
            tab_id: tab_id.clone(),
            pane_id: pane_id.clone(),
            layout: Some(layout.clone()),
            cwd: req.cwd.clone(),
            connection_id: None,
        });
    };

    if is_argv_command {
        // Fast commands can exit as soon as their PTY starts. Synchronize with
        // exit cleanup so it either wins before we publish, or observes the
        // registered tab and removes it after publication.
        let exited = session.exited.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if *exited {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({ "error": "command exited before tab creation completed" }),
                ),
            )
                .into_response();
        }
        publish_tab();
        drop(exited);
    } else {
        publish_tab();
    }

    Json(serde_json::json!({
        "tab_id": tab_id,
        "pane_id": pane_id,
        "layout": layout,
        "cwd": req.cwd,
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::{validate_create_tab_request, CreateTabRequest};

    fn request(argv: Vec<&str>) -> CreateTabRequest {
        CreateTabRequest {
            cwd: None,
            argv: Some(argv.into_iter().map(str::to_string).collect()),
            title: None,
        }
    }

    #[test]
    fn create_tab_argv_requires_non_empty_program() {
        assert!(validate_create_tab_request(&request(vec![])).is_err());
        assert!(validate_create_tab_request(&request(vec![""])).is_err());
        assert!(validate_create_tab_request(&request(vec!["claude", ""])).is_ok());
        assert!(validate_create_tab_request(&request(vec!["claude", "--resume"])).is_ok());
    }

    #[test]
    fn create_tab_argv_rejects_nul_bytes() {
        assert!(validate_create_tab_request(&request(vec!["claude\0", "--resume"])).is_err());
        assert!(validate_create_tab_request(&request(vec!["claude", "--resume\0"])).is_err());
    }
}

// ─── DELETE /api/tabs/{tab_id} ─────────────────────────────────────

#[allow(clippy::unused_async)]
pub async fn close_tab(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
) -> impl IntoResponse {
    // Get tab layout to find all leaf pane IDs
    let leaf_ids: Vec<String> = manager
        .tab_layouts
        .get(&tab_id)
        .and_then(|v| v.get("layout").cloned())
        .map(|layout| session::collect_leaf_pane_ids(&layout))
        .unwrap_or_default();

    // Kill and remove all PTY sessions
    for leaf_id in &leaf_ids {
        manager.kill_and_remove(leaf_id);
    }

    // Remove tab
    manager.remove_tab(&tab_id);

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_id });

    Json(serde_json::json!({ "ok": true })).into_response()
}

// ─── POST /api/tabs/{tab_id}/pane ──────────────────────────────────

#[allow(clippy::unused_async, clippy::too_many_lines)]
pub async fn split_pane(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
    Json(req): Json<SplitPaneRequest>,
) -> impl IntoResponse {
    // Verify tab exists
    let tab_val = match manager.tab_layouts.get(&tab_id) {
        Some(v) => v.value().clone(),
        None => {
            return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "tab not found" })))
                .into_response();
        }
    };

    let layout = match tab_val.get("layout") {
        Some(l) => l.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "tab has no layout" })),
            )
                .into_response();
        }
    };

    // Verify target pane exists in layout
    let leaf_ids = session::collect_leaf_pane_ids(&layout);
    if !leaf_ids.contains(&req.pane_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "pane not found in tab" })),
        )
            .into_response();
    }

    let new_pane_id = uuid::Uuid::new_v4().to_string();

    // Check if source pane is an SSH session
    let ssh_params = manager.sessions.get(&req.pane_id).and_then(|s| s.ssh_params.clone());

    // Create session for new pane (SSH or local PTY)
    let source_cwd = manager
        .sessions
        .get(&req.pane_id)
        .and_then(|s| s.cwd_state.lock().ok().map(|state| state.cwd.clone()));

    let (_session, _shell_type) = if req.force_local {
        // Force local PTY — use explicit cwd if provided, otherwise inherit from source
        let local_cwd = req.cwd.map(std::path::PathBuf::from).or(source_cwd);
        match pty::create_session(&manager, &new_pane_id, Some(&tab_id), None, local_cwd, None) {
            Ok(x) => x,
            Err(e) => {
                tracing::error!("Failed to create PTY for force-local split: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": e })),
                )
                    .into_response();
            }
        }
    } else if let Some(params) = ssh_params {
        // Source is an SSH session — create a new SSH connection to the same host
        match ssh::create_ssh_session(&manager, &new_pane_id, params, None).await {
            Ok(x) => x,
            Err(e) => {
                tracing::error!("Failed to create SSH session for split: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": e })),
                )
                    .into_response();
            }
        }
    } else {
        // Local PTY — inherit CWD from source pane
        match pty::create_session(&manager, &new_pane_id, Some(&tab_id), None, source_cwd, None) {
            Ok(x) => x,
            Err(e) => {
                tracing::error!("Failed to create PTY for split: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": e })),
                )
                    .into_response();
            }
        }
    };

    // Update layout tree
    let is_ssh = manager.sessions.get(&new_pane_id).is_some_and(|s| s.is_ssh());
    let new_layout =
        if let Some(session) = is_ssh.then(|| manager.sessions.get(&new_pane_id)).flatten() {
            let title = format!(
                "{}@{}",
                session.ssh_params.as_ref().map_or("ssh", |p| p.username.as_str()),
                session.ssh_params.as_ref().map_or("", |p| p.host.as_str()),
            );
            session::insert_pane_into_layout_with_info(
                &layout,
                &req.pane_id,
                &req.direction,
                &new_pane_id,
                &title,
                "ssh",
            )
        } else {
            session::insert_pane_into_layout(&layout, &req.pane_id, &req.direction, &new_pane_id)
        };
    let Some(new_layout) = new_layout else {
        // Clean up PTY if layout update fails
        manager.kill_and_remove(&new_pane_id);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "failed to update layout" })),
        )
            .into_response();
    };

    // Store updated layout
    let active_pane_id = new_pane_id.clone();
    manager.insert_tab(
        tab_id.clone(),
        serde_json::json!({
            "layout": new_layout.clone(),
            "active_pane_id": active_pane_id.clone(),
        }),
    );

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::LayoutUpdated {
        pane_id: tab_id,
        layout: new_layout.clone(),
        active_pane_id,
    });

    Json(serde_json::json!({
        "new_pane_id": new_pane_id,
        "layout": new_layout,
    }))
    .into_response()
}

// ─── DELETE /api/tabs/{tab_id}/pane/{pane_id} ──────────────────────

#[allow(clippy::unused_async)]
pub async fn close_pane(
    State(manager): State<Arc<SessionManager>>,
    Path((tab_id, pane_id)): Path<(String, String)>,
) -> impl IntoResponse {
    // Verify tab exists
    let tab_val = match manager.tab_layouts.get(&tab_id) {
        Some(v) => v.value().clone(),
        None => {
            return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "tab not found" })))
                .into_response();
        }
    };

    let layout = match tab_val.get("layout") {
        Some(l) => l.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "tab has no layout" })),
            )
                .into_response();
        }
    };

    // Verify pane exists in layout
    let leaf_ids = session::collect_leaf_pane_ids(&layout);
    if !leaf_ids.contains(&pane_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "pane not found in tab" })),
        )
            .into_response();
    }

    // Kill and remove PTY session
    manager.kill_and_remove(&pane_id);

    // Update layout
    if leaf_ids.len() <= 1 {
        // Last pane - remove entire tab
        manager.remove_tab(&tab_id);

        // Broadcast tab closed
        manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_id });

        Json(serde_json::json!({ "ok": true, "tab_closed": true }))
    } else {
        // Remove pane from layout
        let new_layout = session::remove_pane_from_layout(&layout, &pane_id)
            .unwrap_or(serde_json::Value::Null);

        let new_leaf_ids = session::collect_leaf_pane_ids(&new_layout);
        let active = tab_val
            .get("active_pane_id")
            .and_then(|v| v.as_str());
        let active_pane_id = active
            .filter(|id| new_leaf_ids.iter().any(|lid| lid == *id))
            .or_else(|| new_leaf_ids.first().map(std::string::String::as_str))
            .unwrap_or("")
            .to_string();

        manager.insert_tab(
            tab_id.clone(),
            serde_json::json!({
                "layout": new_layout.clone(),
                "active_pane_id": active_pane_id.clone(),
            }),
        );

        // Broadcast layout updated
        manager.broadcast_sync(&SyncMsg::LayoutUpdated {
            pane_id: tab_id,
            layout: new_layout.clone(),
            active_pane_id: active_pane_id.clone(),
        });

        Json(serde_json::json!({ "ok": true, "tab_closed": false, "layout": new_layout, "active_pane_id": active_pane_id }))
    }
    .into_response()
}

// ─── PUT /api/tabs/{tab_id}/pane/{pane_id}/activate ────────────────

#[allow(clippy::unused_async)]
pub async fn activate_pane(
    State(manager): State<Arc<SessionManager>>,
    Path((tab_id, pane_id)): Path<(String, String)>,
) -> impl IntoResponse {
    // Verify tab exists
    let tab_val = match manager.tab_layouts.get(&tab_id) {
        Some(v) => v.value().clone(),
        None => {
            return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "tab not found" })))
                .into_response();
        }
    };

    // Verify pane exists in layout
    let layout = tab_val.get("layout").cloned().unwrap_or(serde_json::Value::Null);
    let leaf_ids = session::collect_leaf_pane_ids(&layout);
    if !leaf_ids.contains(&pane_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "pane not found in tab" })),
        )
            .into_response();
    }

    // Update active pane
    manager.insert_tab(
        tab_id.clone(),
        serde_json::json!({
            "layout": layout,
            "active_pane_id": pane_id,
        }),
    );

    // Update global active pane
    *manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some(pane_id.clone());

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::TabActivated { pane_id });

    Json(serde_json::json!({ "ok": true })).into_response()
}

// ─── PUT /api/tabs/{tab_id}/layout ─────────────────────────────────

#[allow(clippy::unused_async)]
pub async fn update_layout(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
    Json(req): Json<UpdateLayoutRequest>,
) -> impl IntoResponse {
    // Verify tab exists
    if !manager.tab_layouts.contains_key(&tab_id) {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "tab not found" })))
            .into_response();
    }

    // Store updated layout
    manager.insert_tab(
        tab_id.clone(),
        serde_json::json!({
            "layout": req.layout.clone(),
            "active_pane_id": req.active_pane_id.clone(),
        }),
    );

    // Sync global active pane: frontend only syncs layout for the active tab,
    // so the leaf active_pane_id here reflects the user's current focus.
    *manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some(req.active_pane_id.clone());

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::LayoutUpdated {
        pane_id: tab_id,
        layout: req.layout,
        active_pane_id: req.active_pane_id,
    });

    Json(serde_json::json!({ "ok": true })).into_response()
}

// ─── POST /api/tabs/ssh/quick ────────────────────────────────────

pub async fn create_ssh_quick_tab(
    State(manager): State<Arc<SessionManager>>,
    Json(req): Json<ssh::SshConnectRequest>,
) -> impl IntoResponse {
    let tab_id = uuid::Uuid::new_v4().to_string();
    let pane_id = uuid::Uuid::new_v4().to_string();

    let params = req.to_params();

    // 创建 SSH 会话
    let (_session, _shell_type) = match ssh::create_ssh_session(&manager, &pane_id, params, None)
        .await
    {
        Ok(x) => x,
        Err(e) => {
            tracing::error!("Failed to create SSH session: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))
                .into_response();
        }
    };

    // 创建初始布局
    let layout = serde_json::json!({
        "type": "leaf",
        "paneId": pane_id,
        "title": format!("{}@{}", req.username, req.host),
        "shell_type": "ssh",
        "ratio": 1,
        "zoomed": false,
    });

    // 存储 tab
    manager.insert_tab(
        tab_id.clone(),
        serde_json::json!({
            "layout": layout,
            "active_pane_id": pane_id,
        }),
    );

    // 设为活动 tab
    *manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some(pane_id.clone());

    // 广播
    manager.broadcast_sync(&SyncMsg::TabCreated {
        tab_id: tab_id.clone(),
        pane_id: pane_id.clone(),
        layout: Some(layout.clone()),
        cwd: None,
        connection_id: req.profile_id.clone(),
    });

    Json(serde_json::json!({
        "tab_id": tab_id,
        "pane_id": pane_id,
        "layout": layout,
        "connection_id": req.profile_id,
    }))
    .into_response()
}

// ─── POST /api/tabs/ssh ──────────────────────────────────────────

pub async fn create_ssh_tab(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Json(req): Json<ssh::SshProfileConnectRequest>,
) -> impl IntoResponse {
    let tab_id = uuid::Uuid::new_v4().to_string();
    let pane_id = uuid::Uuid::new_v4().to_string();

    // 从 settings 查找 profile
    let params = {
        let settings = settings.read().await;
        let profile = settings.ssh_profiles.iter().find(|p| p.id == req.profile_id);
        match profile {
            Some(profile) => SshSessionParams {
                host: profile.host.clone(),
                port: profile.port,
                username: profile.username.clone(),
                auth_method: profile.auth_method.clone(),
                default_command: profile.default_command.clone(),
                profile_id: Some(profile.id.clone()),
                initial_cwd: req.initial_cwd.clone(),
            },
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "profile not found" })),
                )
                    .into_response();
            }
        }
    };

    let tab_title = format!("{}@{}", params.username, params.host);

    // 创建 SSH 会话
    let (_session, _shell_type) = match ssh::create_ssh_session(&manager, &pane_id, params, None)
        .await
    {
        Ok(x) => x,
        Err(e) => {
            tracing::error!("Failed to create SSH session: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))
                .into_response();
        }
    };

    // 创建初始布局
    let layout = serde_json::json!({
        "type": "leaf",
        "paneId": pane_id,
        "title": tab_title,
        "shell_type": "ssh",
        "ratio": 1,
        "zoomed": false,
    });

    // 存储 tab
    manager.insert_tab(
        tab_id.clone(),
        serde_json::json!({
            "layout": layout,
            "active_pane_id": pane_id,
        }),
    );

    // 设为活动 tab
    *manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some(pane_id.clone());

    // 广播
    manager.broadcast_sync(&SyncMsg::TabCreated {
        tab_id: tab_id.clone(),
        pane_id: pane_id.clone(),
        layout: Some(layout.clone()),
        cwd: None,
        connection_id: Some(req.profile_id.clone()),
    });

    Json(serde_json::json!({
        "tab_id": tab_id,
        "pane_id": pane_id,
        "layout": layout,
        "connection_id": req.profile_id,
    }))
    .into_response()
}

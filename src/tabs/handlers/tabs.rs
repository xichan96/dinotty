use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};

use crate::platform::{shell::ShellPreference, shell_probe::ShellProbeService};
use crate::pty;
use crate::session::{self, SessionManager, SyncMsg};
use crate::settings::SettingsState;

use super::super::types::{validate_create_tab_request, CreateTabRequest};
use super::shell_error_response;

#[allow(clippy::unused_async)]
pub async fn list_tabs(State(manager): State<Arc<SessionManager>>) -> impl IntoResponse {
    let (tabs, active_pane_id) = manager.tab_list();
    Json(serde_json::json!({
        "tabs": tabs,
        "active_pane_id": active_pane_id,
    }))
}

#[derive(serde::Deserialize)]
pub struct RenameTabRequest {
    title: String,
}

#[allow(clippy::unused_async)]
pub async fn rename_tab(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
    Json(req): Json<RenameTabRequest>,
) -> impl IntoResponse {
    let title = req.title.trim();
    if title.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "title must not be empty" })),
        )
            .into_response();
    }
    if manager.rename_tab(&tab_id, title) {
        manager.broadcast_sync(&SyncMsg::TabRenamed { tab_id, title: title.to_string() });
        Json(serde_json::json!({ "ok": true })).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "tab not found" })))
            .into_response()
    }
}

#[allow(clippy::unused_async)]
pub async fn create_tab(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    State(shell_probe): State<Arc<ShellProbeService>>,
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

    // Copy settings under the lock, then probe outside it.
    let (cwd, shell_preference) = {
        let s = settings.read().await;
        let cwd = match requested_cwd {
            Some(cwd) => Some(cwd),
            None => s.resolved_default_workspace_root(),
        };
        let preference =
            ShellPreference::new(s.shell.clone(), s.shell_path.clone(), s.wsl_distro.clone());
        (cwd, preference)
    };
    let is_argv_command = req.argv.is_some();
    let shell_spec = if is_argv_command {
        None
    } else {
        match shell_probe.resolve(&shell_preference).await {
            Ok(spec) => Some(spec),
            Err(error) => return shell_error_response(&error),
        }
    };

    // Create PTY session
    let (session, shell_type) = match pty::create_session(
        &manager,
        &pane_id,
        Some(&tab_id),
        None,
        cwd.map(pty::LaunchCwd::Host),
        req.argv,
        shell_spec,
    ) {
        Ok(x) => x,
        Err(e) => {
            tracing::error!("Failed to create PTY: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))
                .into_response();
        }
    };
    let cwd_str = session.cwd_for_workspace().map(|cwd| cwd.to_string_lossy().into_owned());

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
        if !manager.insert_tab_for_session(
            &pane_id,
            &session,
            tab_id.clone(),
            serde_json::json!({
                "layout": layout.clone(),
                "active_pane_id": pane_id.clone(),
            }),
            pane_id.clone(),
        ) {
            return false;
        }

        manager.broadcast_sync(&SyncMsg::TabCreated {
            tab_id: tab_id.clone(),
            pane_id: pane_id.clone(),
            layout: Some(layout.clone()),
            cwd: cwd_str.clone(),
            connection_id: None,
            workspace_id: None,
        });
        if manager.is_current_session(&pane_id, &session) {
            true
        } else {
            // If close won after guarded publication but before TabCreated was
            // sent, order a final corrective close after that late creation.
            manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_id.clone() });
            false
        }
    };

    if !publish_tab() {
        let message = if is_argv_command {
            "command exited before tab creation completed"
        } else {
            "session closed before tab creation completed"
        };
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": message })))
            .into_response();
    }

    Json(serde_json::json!({
        "tab_id": tab_id,
        "pane_id": pane_id,
        "layout": layout,
        "cwd": cwd_str,
    }))
    .into_response()
}

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

    // Each session close prunes its own leaf and emits the unified close protocol.
    for leaf_id in &leaf_ids {
        manager.kill_and_remove(leaf_id);
    }

    // Non-terminal-only tabs have no session close to remove the layout.
    if manager.remove_tab(&tab_id) {
        manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_id });
    }

    Json(serde_json::json!({ "ok": true })).into_response()
}

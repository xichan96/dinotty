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

use super::super::types::{
    ExtractPaneRequest, MovePaneRequest, SplitPaneRequest, UpdateLayoutRequest,
};
use super::shell_error_response;

#[allow(clippy::unused_async, clippy::too_many_lines)]
pub async fn split_pane(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    State(shell_probe): State<Arc<ShellProbeService>>,
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
    let source_cwd = manager.sessions.get(&req.pane_id).and_then(|session| session.host_cwd());

    let shell_preference = {
        let s = settings.read().await;
        ShellPreference::new(s.shell.clone(), s.shell_path.clone(), s.wsl_distro.clone())
    };
    let shell_spec = if req.force_local || ssh_params.is_none() {
        match shell_probe.resolve(&shell_preference).await {
            Ok(spec) => Some(spec),
            Err(error) => return shell_error_response(&error),
        }
    } else {
        None
    };

    let (session, _shell_type) = if req.force_local {
        // Force local PTY - use explicit cwd if provided, otherwise inherit from source
        let local_cwd = req.cwd.map(std::path::PathBuf::from).or(source_cwd);
        match pty::create_session(
            &manager,
            &new_pane_id,
            Some(&tab_id),
            None,
            local_cwd.map(pty::LaunchCwd::Host),
            None,
            shell_spec.clone(),
        ) {
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
        // Source is an SSH session - create a new SSH connection to the same host
        match crate::ssh::create_ssh_session(&manager, &new_pane_id, params, None).await {
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
        // Local PTY - inherit CWD from source pane
        match pty::create_session(
            &manager,
            &new_pane_id,
            Some(&tab_id),
            None,
            source_cwd.map(pty::LaunchCwd::Host),
            None,
            shell_spec,
        ) {
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
    manager.recheck_publish_or_correct(&new_pane_id, &session);

    Json(serde_json::json!({
        "new_pane_id": new_pane_id,
        "layout": new_layout,
    }))
    .into_response()
}

#[allow(clippy::unused_async, clippy::too_many_lines)]
pub async fn move_pane(
    State(manager): State<Arc<SessionManager>>,
    Path(dst_tab_id): Path<String>,
    Json(req): Json<MovePaneRequest>,
) -> impl IntoResponse {
    // Reject same-tab moves.
    if req.source_tab_id == dst_tab_id {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "source and destination tab must differ" })),
        )
            .into_response();
    }

    // Load source tab layout.
    let src_val = match manager.tab_layouts.get(&req.source_tab_id) {
        Some(v) => v.value().clone(),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "source tab not found" })),
            )
                .into_response();
        }
    };
    let src_layout = match src_val.get("layout") {
        Some(l) => l.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "source tab has no layout" })),
            )
                .into_response();
        }
    };

    // Load destination tab layout.
    let dst_val = match manager.tab_layouts.get(&dst_tab_id) {
        Some(v) => v.value().clone(),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "destination tab not found" })),
            )
                .into_response();
        }
    };
    let dst_layout = match dst_val.get("layout") {
        Some(l) => l.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "destination tab has no layout" })),
            )
                .into_response();
        }
    };

    // Verify target pane exists in destination layout.
    let dst_leaf_ids = session::collect_leaf_pane_ids(&dst_layout);
    if !dst_leaf_ids.contains(&req.target_pane_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "target pane not found in destination tab" })),
        )
            .into_response();
    }

    match req.source_pane_id {
        // Mode A: move whole source tab as subtree.
        None => {
            let subtree = src_layout.clone();
            let Some(new_dst_layout) = session::insert_subtree_into_layout(
                &dst_layout,
                &req.target_pane_id,
                &req.direction,
                subtree,
            ) else {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "failed to insert subtree" })),
                )
                    .into_response();
            };

            let active_pane_id = session::first_leaf_id(&new_dst_layout)
                .unwrap_or_else(|| req.target_pane_id.clone());

            // Remove source tab (PTY sessions are preserved).
            manager.remove_tab(&req.source_tab_id);

            manager.insert_tab(
                dst_tab_id.clone(),
                serde_json::json!({
                    "layout": new_dst_layout.clone(),
                    "active_pane_id": active_pane_id.clone(),
                }),
            );

            // Broadcast: dst layout first, then src tab closed.
            manager.broadcast_sync(&SyncMsg::LayoutUpdated {
                pane_id: dst_tab_id.clone(),
                layout: new_dst_layout.clone(),
                active_pane_id: active_pane_id.clone(),
            });
            manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: req.source_tab_id.clone() });

            Json(serde_json::json!({
                "layout": new_dst_layout,
                "active_pane_id": active_pane_id,
                "mode": "a",
            }))
            .into_response()
        }
        // Mode B: move single pane across tabs.
        Some(source_pane_id) => {
            // Source must have at least 2 leaves.
            let src_leaf_ids = session::collect_leaf_pane_ids(&src_layout);
            if src_leaf_ids.len() < 2 {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": "source tab must have at least 2 panes to move one out"
                    })),
                )
                    .into_response();
            }
            if !src_leaf_ids.contains(&source_pane_id) {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "source pane not found in source tab" })),
                )
                    .into_response();
            }

            // Extract the leaf to be moved.
            let Some(moved_leaf) = session::extract_leaf_from_layout(&src_layout, &source_pane_id)
            else {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "failed to extract source leaf" })),
                )
                    .into_response();
            };

            // Remove from source layout.
            let Some(new_src_layout) =
                session::remove_pane_from_layout(&src_layout, &source_pane_id)
            else {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "failed to update source layout" })),
                )
                    .into_response();
            };

            // Insert into destination layout.
            let Some(new_dst_layout) = session::insert_subtree_into_layout(
                &dst_layout,
                &req.target_pane_id,
                &req.direction,
                moved_leaf,
            ) else {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "failed to update destination layout" })),
                )
                    .into_response();
            };

            let active_pane_id = source_pane_id.clone();

            manager.insert_tab(
                req.source_tab_id.clone(),
                serde_json::json!({
                    "layout": new_src_layout.clone(),
                    "active_pane_id": session::first_leaf_id(&new_src_layout)
                        .unwrap_or_else(|| req.target_pane_id.clone()),
                }),
            );
            manager.insert_tab(
                dst_tab_id.clone(),
                serde_json::json!({
                    "layout": new_dst_layout.clone(),
                    "active_pane_id": active_pane_id.clone(),
                }),
            );

            manager.broadcast_sync(&SyncMsg::LayoutUpdated {
                pane_id: req.source_tab_id.clone(),
                layout: new_src_layout.clone(),
                active_pane_id: session::first_leaf_id(&new_src_layout)
                    .unwrap_or_else(|| req.target_pane_id.clone()),
            });
            manager.broadcast_sync(&SyncMsg::LayoutUpdated {
                pane_id: dst_tab_id.clone(),
                layout: new_dst_layout.clone(),
                active_pane_id: active_pane_id.clone(),
            });

            Json(serde_json::json!({
                "source_layout": new_src_layout,
                "layout": new_dst_layout,
                "active_pane_id": active_pane_id,
                "mode": "b",
            }))
            .into_response()
        }
    }
}

#[allow(clippy::unused_async)]
pub async fn extract_pane(
    State(manager): State<Arc<SessionManager>>,
    Json(req): Json<ExtractPaneRequest>,
) -> impl IntoResponse {
    // Load source tab layout.
    let src_val = match manager.tab_layouts.get(&req.source_tab_id) {
        Some(v) => v.value().clone(),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "source tab not found" })),
            )
                .into_response();
        }
    };
    let src_layout = match src_val.get("layout") {
        Some(l) => l.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "source tab has no layout" })),
            )
                .into_response();
        }
    };

    // Source must have at least 2 leaves.
    let src_leaf_ids = session::collect_leaf_pane_ids(&src_layout);
    if src_leaf_ids.len() < 2 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "source tab must have at least 2 panes to extract one"
            })),
        )
            .into_response();
    }
    if !src_leaf_ids.contains(&req.pane_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "pane not found in source tab" })),
        )
            .into_response();
    }

    // Extract the leaf.
    let Some(moved_leaf) = session::extract_leaf_from_layout(&src_layout, &req.pane_id) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "failed to extract leaf" })),
        )
            .into_response();
    };

    // Remove from source layout.
    let Some(new_src_layout) = session::remove_pane_from_layout(&src_layout, &req.pane_id) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "failed to update source layout" })),
        )
            .into_response();
    };

    // Create new tab with the extracted leaf as root layout.
    let new_tab_id = uuid::Uuid::new_v4().to_string();
    let new_layout = moved_leaf;
    let active_pane_id = req.pane_id.clone();

    manager.insert_tab(
        req.source_tab_id.clone(),
        serde_json::json!({
            "layout": new_src_layout.clone(),
            "active_pane_id": session::first_leaf_id(&new_src_layout)
                .unwrap_or_else(|| req.pane_id.clone()),
        }),
    );
    manager.insert_tab(
        new_tab_id.clone(),
        serde_json::json!({
            "layout": new_layout.clone(),
            "active_pane_id": active_pane_id.clone(),
        }),
    );

    manager.broadcast_sync(&SyncMsg::LayoutUpdated {
        pane_id: req.source_tab_id.clone(),
        layout: new_src_layout.clone(),
        active_pane_id: session::first_leaf_id(&new_src_layout)
            .unwrap_or_else(|| req.pane_id.clone()),
    });
    manager.broadcast_sync(&SyncMsg::TabCreated {
        tab_id: new_tab_id.clone(),
        pane_id: active_pane_id.clone(),
        layout: Some(new_layout.clone()),
        cwd: None,
        connection_id: None,
        workspace_id: None,
    });

    Json(serde_json::json!({
        "new_tab_id": new_tab_id,
        "pane_id": active_pane_id,
        "source_layout": new_src_layout,
    }))
    .into_response()
}

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

    // Unified pane close also handles non-terminal leaves that own no session.
    manager.close_pane(&pane_id);
    Json(serde_json::json!({ "ok": true, "tab_closed": leaf_ids.len() <= 1 })).into_response()
}

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
    manager.update_layout(
        tab_id.clone(),
        serde_json::json!({
            "layout": layout,
            "active_pane_id": pane_id.clone(),
        }),
        Some(pane_id.clone()),
    );

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::TabActivated { pane_id });

    Json(serde_json::json!({ "ok": true })).into_response()
}

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
    manager.update_layout(
        tab_id.clone(),
        serde_json::json!({
            "layout": req.layout.clone(),
            "active_pane_id": req.active_pane_id.clone(),
        }),
        Some(req.active_pane_id.clone()),
    );

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::LayoutUpdated {
        pane_id: tab_id,
        layout: req.layout,
        active_pane_id: req.active_pane_id,
    });

    Json(serde_json::json!({ "ok": true })).into_response()
}

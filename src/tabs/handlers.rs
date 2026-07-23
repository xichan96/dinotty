use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};

use crate::pty;
use crate::session::{self, SessionManager, SyncMsg};
use crate::settings::SettingsState;

use super::types::{
    validate_create_tab_request, CreateFilesPaneRequest, CreatePluginPaneRequest,
    CreatePluginTabRequest, CreateTabRequest, CreateWebPaneRequest, ExtractPaneRequest,
    MovePaneRequest, SplitPaneRequest, UpdateLayoutRequest,
};

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
            cwd: req.cwd.clone(),
            connection_id: None,
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
        "cwd": req.cwd,
    }))
    .into_response()
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
        // Force local PTY - use explicit cwd if provided, otherwise inherit from source
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

// ─── POST /api/tabs/{tab_id}/pane/plugin|files|web ────────────────

/// Shared helper: insert a non-terminal leaf (plugin/files/web) into the
/// layout by splitting the target pane. Does NOT create a PTY session.
fn insert_non_terminal_pane(
    manager: &SessionManager,
    tab_id: &str,
    target_pane_id: &str,
    direction: &str,
    new_leaf: serde_json::Value,
    new_pane_id: &str,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // NOTE: must drop the DashMap Ref before `manager.insert_tab` writes back
    // to the same shard, otherwise the read lock blocks the write lock and the
    // handler deadlocks. Use `match` so the Ref is dropped at the end of the
    // expression, not held for the rest of the function.
    let tab_val = match manager.tab_layouts.get(tab_id) {
        Some(v) => v.value().clone(),
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "tab not found" })),
            ))
        }
    };

    let Some(layout) = tab_val.get("layout") else {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "tab has no layout" })),
        ));
    };
    let layout = layout.clone();

    let leaf_ids = session::collect_leaf_pane_ids(&layout);
    if !leaf_ids.contains(&target_pane_id.to_string()) {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "pane not found in tab" })),
        ));
    }

    let Some(new_layout) =
        session::insert_subtree_into_layout(&layout, target_pane_id, direction, new_leaf)
    else {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "failed to update layout" })),
        ));
    };

    let active_pane_id = new_pane_id.to_string();
    manager.insert_tab(
        tab_id.to_string(),
        serde_json::json!({
            "layout": new_layout.clone(),
            "active_pane_id": active_pane_id.clone(),
        }),
    );

    manager.broadcast_sync(&SyncMsg::LayoutUpdated {
        pane_id: tab_id.to_string(),
        layout: new_layout.clone(),
        active_pane_id,
    });

    Ok(Json(serde_json::json!({
        "new_pane_id": new_pane_id,
        "layout": new_layout,
    })))
}

#[allow(clippy::unused_async)]
pub async fn create_plugin_pane(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
    Json(req): Json<CreatePluginPaneRequest>,
) -> impl IntoResponse {
    let new_pane_id = uuid::Uuid::new_v4().to_string();
    let new_leaf = serde_json::json!({
        "type": "leaf",
        "kind": "plugin",
        "paneId": new_pane_id,
        "title": req.plugin_id.clone(),
        "ratio": 1,
        "zoomed": false,
        "pluginId": req.plugin_id.clone(),
    });

    match insert_non_terminal_pane(
        &manager,
        &tab_id,
        &req.target_pane_id,
        &req.direction,
        new_leaf,
        &new_pane_id,
    ) {
        Ok(resp) => resp.into_response(),
        Err(err) => err.into_response(),
    }
}

// ─── POST /api/tabs/plugin ───────────────────────────────────────

/// Create a new tab whose root layout is a single plugin leaf (no PTY).
/// Used so plugin tabs gain a backend `tab_layouts` entry, enabling Mode A
/// drag-and-drop merge with other tabs.
#[allow(clippy::unused_async)]
pub async fn create_plugin_tab(
    State(manager): State<Arc<SessionManager>>,
    Json(req): Json<CreatePluginTabRequest>,
) -> impl IntoResponse {
    let tab_id = req.tab_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    // Frontend convention: plugin tab uses the same ID for the tab and its
    // single leaf pane, so existing paneId-based lookups keep working.
    let pane_id = tab_id.clone();
    let title = req.title.unwrap_or_else(|| req.plugin_id.clone());

    let layout = serde_json::json!({
        "type": "leaf",
        "kind": "plugin",
        "paneId": pane_id,
        "title": title,
        "ratio": 1,
        "zoomed": false,
        "pluginId": req.plugin_id,
    });

    manager.update_layout(
        tab_id.clone(),
        serde_json::json!({
            "layout": layout.clone(),
            "active_pane_id": pane_id.clone(),
        }),
        Some(pane_id.clone()),
    );

    manager.broadcast_sync(&SyncMsg::TabCreated {
        tab_id: tab_id.clone(),
        pane_id: pane_id.clone(),
        layout: Some(layout.clone()),
        cwd: None,
        connection_id: None,
    });

    Json(serde_json::json!({
        "tab_id": tab_id,
        "pane_id": pane_id,
        "layout": layout,
    }))
    .into_response()
}

#[allow(clippy::unused_async)]
pub async fn create_files_pane(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
    Json(req): Json<CreateFilesPaneRequest>,
) -> impl IntoResponse {
    let new_pane_id = uuid::Uuid::new_v4().to_string();
    let new_leaf = serde_json::json!({
        "type": "leaf",
        "kind": "files",
        "paneId": new_pane_id,
        "title": req.path.clone(),
        "ratio": 1,
        "zoomed": false,
        "path": req.path.clone(),
    });

    match insert_non_terminal_pane(
        &manager,
        &tab_id,
        &req.target_pane_id,
        &req.direction,
        new_leaf,
        &new_pane_id,
    ) {
        Ok(resp) => resp.into_response(),
        Err(err) => err.into_response(),
    }
}

#[allow(clippy::unused_async)]
pub async fn create_web_pane(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
    Json(req): Json<CreateWebPaneRequest>,
) -> impl IntoResponse {
    let new_pane_id = uuid::Uuid::new_v4().to_string();
    let new_leaf = serde_json::json!({
        "type": "leaf",
        "kind": "web",
        "paneId": new_pane_id,
        "title": req.url.clone(),
        "ratio": 1,
        "zoomed": false,
        "url": req.url.clone(),
    });

    match insert_non_terminal_pane(
        &manager,
        &tab_id,
        &req.target_pane_id,
        &req.direction,
        new_leaf,
        &new_pane_id,
    ) {
        Ok(resp) => resp.into_response(),
        Err(err) => err.into_response(),
    }
}

// ─── POST /api/tabs/{dst_tab_id}/pane/move ────────────────────────

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

// ─── POST /api/tabs/extract ───────────────────────────────────────

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
    });

    Json(serde_json::json!({
        "new_tab_id": new_tab_id,
        "pane_id": active_pane_id,
        "source_layout": new_src_layout,
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

    // Unified pane close also handles non-terminal leaves that own no session.
    manager.close_pane(&pane_id);
    Json(serde_json::json!({ "ok": true, "tab_closed": leaf_ids.len() <= 1 })).into_response()
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

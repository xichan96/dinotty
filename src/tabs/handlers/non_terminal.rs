use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};

use crate::session::{self, SessionManager, SyncMsg};

use super::super::types::{
    CreateFilesPaneRequest, CreatePluginPaneRequest, CreatePluginTabRequest, CreateWebPaneRequest,
};

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
        workspace_id: None,
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
        "sourcePaneId": req.target_pane_id.clone(),
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
        "sourcePaneId": req.target_pane_id.clone(),
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

//! Axum handlers for `/api/templates/*` routes.
//!
//! Phase 1 implements list / get / create / update / delete. The apply
//! endpoint (`POST /api/templates/apply`) is stubbed here and implemented
//! in Phase 2 (two-phase PTY creation + layout commit).

#![allow(clippy::ref_option)]

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::session::SessionManager;

use super::store::{StoreError, TemplateStore};
use super::types::{
    CreateTemplateBody, ListTemplatesQuery, PaneOverride, Template, TemplateScope,
    UpdateTemplateBody,
};

// ─── helpers ───────────────────────────────────────────────────────

fn err_response(status: StatusCode, msg: &str) -> axum::response::Response {
    (status, Json(json!({ "error": msg }))).into_response()
}

fn map_store_error(e: StoreError) -> axum::response::Response {
    match e {
        StoreError::NotFound => err_response(StatusCode::NOT_FOUND, "template not found"),
        StoreError::BadRequest(m) => err_response(StatusCode::BAD_REQUEST, &m),
        StoreError::Io(m) => {
            tracing::error!("template store io error: {m}");
            err_response(StatusCode::INTERNAL_SERVER_ERROR, "storage error")
        }
        StoreError::Serialize(m) => {
            tracing::error!("template serialize error: {m}");
            err_response(StatusCode::INTERNAL_SERVER_ERROR, "serialization error")
        }
    }
}

/// Validate that `scope/workspace_id` are consistent: `Workspace` scope requires
/// a non-empty `workspace_id`.
fn validate_scope(
    scope: TemplateScope,
    workspace_id: &Option<String>,
) -> Result<(), (StatusCode, String)> {
    if matches!(scope, TemplateScope::Workspace)
        && workspace_id.as_deref().is_none_or(|s| s.trim().is_empty())
    {
        return Err((StatusCode::BAD_REQUEST, "workspace scope requires workspace_id".into()));
    }
    Ok(())
}

/// Extract a layout tree from the source tab and apply per-pane overrides.
///
/// For each leaf:
/// - Apply `pane_overrides` (matched by the source tab's paneId)
/// - Strip `zoomed` (runtime-only state)
/// - Regenerate `paneId` (UUID) so the template's IDs are decoupled from
///   any live tab
/// - For terminal leaves: set `cwd` / `startup_command` from override
/// - For plugin leaves: set `plugin_options` from override
/// - For files leaves: override `path` if provided
/// - For web leaves: override `url` if provided
fn extract_layout_for_template(
    source_layout: &Value,
    overrides: &std::collections::HashMap<String, PaneOverride>,
) -> Value {
    let mut layout = source_layout.clone();
    walk_leaf(&mut layout, overrides);
    layout
}

fn walk_leaf(node: &mut Value, overrides: &std::collections::HashMap<String, PaneOverride>) {
    let Some(node_type) = node.get("type").and_then(|v| v.as_str()).map(str::to_string) else {
        return;
    };
    if node_type == "leaf" {
        // Save the original paneId before regenerating, so we can look up overrides.
        let original_pane_id = node.get("paneId").and_then(|v| v.as_str()).map(str::to_string);
        let new_pane_id = Uuid::new_v4().to_string();

        if let Some(obj) = node.as_object_mut() {
            // Strip runtime-only fields.
            obj.remove("zoomed");
            obj.insert("paneId".to_string(), Value::String(new_pane_id));

            let kind = obj.get("kind").and_then(|v| v.as_str()).unwrap_or("terminal").to_string();

            // Apply overrides if present.
            if let Some(orig_id) = &original_pane_id {
                if let Some(ovr) = overrides.get(orig_id) {
                    apply_override(obj, &kind, ovr);
                }
            }
        }
    } else if node_type == "split" {
        if let Some(children) = node.get_mut("children").and_then(|c| c.as_array_mut()) {
            for child in children {
                walk_leaf(child, overrides);
            }
        }
    }
}

fn apply_override(obj: &mut serde_json::Map<String, Value>, kind: &str, ovr: &PaneOverride) {
    if let Some(title) = &ovr.title {
        obj.insert("title".to_string(), Value::String(title.clone()));
    }
    match kind {
        "terminal" => {
            if let Some(cwd) = &ovr.cwd {
                obj.insert("cwd".to_string(), Value::String(cwd.clone()));
            }
            if let Some(cmd) = &ovr.startup_command {
                obj.insert("startup_command".to_string(), Value::String(cmd.clone()));
            }
        }
        "plugin" => {
            if let Some(opts) = &ovr.plugin_options {
                obj.insert("plugin_options".to_string(), opts.clone());
            }
        }
        "files" => {
            if let Some(path) = &ovr.path {
                obj.insert("path".to_string(), Value::String(path.clone()));
            }
        }
        "web" => {
            if let Some(url) = &ovr.url {
                obj.insert("url".to_string(), Value::String(url.clone()));
            }
        }
        _ => {}
    }
}

// ─── handlers ───────────────────────────────────────────────────────

/// `GET /api/templates?scope=...&workspace_id=...`
#[allow(clippy::unused_async)]
pub async fn list_templates(Query(q): Query<ListTemplatesQuery>) -> impl IntoResponse {
    if let Err((status, msg)) = validate_scope(q.scope, &q.workspace_id) {
        return err_response(status, &msg);
    }
    let store = TemplateStore::new();
    match store.list(q.scope, q.workspace_id.as_deref()) {
        Ok(list) => Json(json!({ "templates": list })).into_response(),
        Err(e) => map_store_error(e),
    }
}

/// `GET /api/templates/{id}?scope=...&workspace_id=...`
#[allow(clippy::unused_async)]
pub async fn get_template(
    Path(id): Path<String>,
    Query(q): Query<ListTemplatesQuery>,
) -> impl IntoResponse {
    if let Err((status, msg)) = validate_scope(q.scope, &q.workspace_id) {
        return err_response(status, &msg);
    }
    let store = TemplateStore::new();
    match store.load(q.scope, q.workspace_id.as_deref(), &id) {
        Ok(tpl) => Json(tpl).into_response(),
        Err(e) => map_store_error(e),
    }
}

/// `POST /api/templates`
#[allow(clippy::unused_async)]
pub async fn create_template(
    State(manager): State<Arc<SessionManager>>,
    Json(req): Json<CreateTemplateBody>,
) -> impl IntoResponse {
    if req.name.trim().is_empty() {
        return err_response(StatusCode::BAD_REQUEST, "name is required");
    }
    if let Err((status, msg)) = validate_scope(req.scope, &req.workspace_id) {
        return err_response(status, &msg);
    }

    // Pull the source tab's layout from SessionManager.tab_layouts.
    let source_layout = match manager.tab_layouts.get(&req.source_tab_id) {
        Some(tab_val) => match tab_val.get("layout").cloned() {
            Some(layout) => layout,
            None => return err_response(StatusCode::INTERNAL_SERVER_ERROR, "tab layout missing"),
        },
        None => return err_response(StatusCode::NOT_FOUND, "source tab not found"),
    };

    let layout = extract_layout_for_template(&source_layout, &req.pane_overrides);
    let now = crate::util::chrono_now();
    let template = Template {
        id: Uuid::new_v4().to_string(),
        name: req.name.trim().to_string(),
        scope: req.scope,
        workspace_id: req.workspace_id.filter(|s| !s.is_empty()),
        created_at: now.clone(),
        updated_at: now,
        layout,
    };

    let store = TemplateStore::new();
    match store.save(&template) {
        Ok(()) => Json(json!({ "template_id": template.id })).into_response(),
        Err(e) => map_store_error(e),
    }
}

/// `PUT /api/templates/{id}?scope=...&workspace_id=...`
#[allow(clippy::unused_async)]
pub async fn update_template(
    State(manager): State<Arc<SessionManager>>,
    Path(id): Path<String>,
    Query(q): Query<ListTemplatesQuery>,
    Json(req): Json<UpdateTemplateBody>,
) -> impl IntoResponse {
    if let Err((status, msg)) = validate_scope(q.scope, &q.workspace_id) {
        return err_response(status, &msg);
    }
    let store = TemplateStore::new();

    // Load existing to fall back on fields not present in the update body.
    let existing = match store.load(q.scope, q.workspace_id.as_deref(), &id) {
        Ok(tpl) => tpl,
        Err(e) => return map_store_error(e),
    };

    let name = req.name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    if let Some(ref n) = name {
        if n.is_empty() {
            return err_response(StatusCode::BAD_REQUEST, "name cannot be empty");
        }
    }

    let (layout, updated_at) = match req.source_tab_id {
        Some(source_tab_id) => match manager.tab_layouts.get(&source_tab_id) {
            Some(tab_val) => match tab_val.get("layout").cloned() {
                Some(layout) => {
                    let overrides = req.pane_overrides.unwrap_or_default();
                    let new_layout = extract_layout_for_template(&layout, &overrides);
                    (new_layout, crate::util::chrono_now())
                }
                None => {
                    return err_response(StatusCode::INTERNAL_SERVER_ERROR, "tab layout missing")
                }
            },
            None => return err_response(StatusCode::NOT_FOUND, "source tab not found"),
        },
        None => (existing.layout.clone(), crate::util::chrono_now()),
    };

    let updated = Template {
        id: existing.id,
        name: name.unwrap_or(existing.name),
        scope: existing.scope,
        workspace_id: existing.workspace_id,
        created_at: existing.created_at,
        updated_at,
        layout,
    };

    match store.save(&updated) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => map_store_error(e),
    }
}

/// `DELETE /api/templates/{id}?scope=...&workspace_id=...`
#[allow(clippy::unused_async)]
pub async fn delete_template(
    Path(id): Path<String>,
    Query(q): Query<ListTemplatesQuery>,
) -> impl IntoResponse {
    if let Err((status, msg)) = validate_scope(q.scope, &q.workspace_id) {
        return err_response(status, &msg);
    }
    let store = TemplateStore::new();
    match store.delete(q.scope, q.workspace_id.as_deref(), &id) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => map_store_error(e),
    }
}

// `POST /api/templates/apply` is implemented in `apply.rs`.

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_layout() -> Value {
        json!({
            "type": "split",
            "direction": "horizontal",
            "children": [
                {
                    "type": "leaf",
                    "kind": "terminal",
                    "paneId": "orig-1",
                    "title": "Terminal",
                    "ratio": 0.5,
                    "zoomed": true
                },
                {
                    "type": "leaf",
                    "kind": "plugin",
                    "paneId": "orig-2",
                    "title": "Git",
                    "ratio": 0.5,
                    "zoomed": false,
                    "pluginId": "git-panel"
                }
            ],
            "ratios": [0.5, 0.5]
        })
    }

    fn make_overrides() -> std::collections::HashMap<String, PaneOverride> {
        let mut m = std::collections::HashMap::new();
        m.insert(
            "orig-1".to_string(),
            PaneOverride {
                cwd: Some("/tmp/work".into()),
                startup_command: Some("npm run dev".into()),
                title: Some("Dev".into()),
                ..Default::default()
            },
        );
        m.insert(
            "orig-2".to_string(),
            PaneOverride { plugin_options: Some(json!({ "repo": "/repo" })), ..Default::default() },
        );
        m
    }

    #[test]
    fn extract_strips_zoomed_and_regen_pane_id() {
        let layout = sample_layout();
        let overrides = make_overrides();
        let out = extract_layout_for_template(&layout, &overrides);

        let leaves = out.get("children").unwrap().as_array().unwrap();
        let term = &leaves[0];
        assert_eq!(term.get("zoomed"), None, "zoomed should be stripped");
        assert_ne!(term.get("paneId").unwrap().as_str().unwrap(), "orig-1");
    }

    #[test]
    fn extract_applies_terminal_overrides() {
        let layout = sample_layout();
        let overrides = make_overrides();
        let out = extract_layout_for_template(&layout, &overrides);

        let term = &out["children"][0];
        assert_eq!(term["cwd"].as_str().unwrap(), "/tmp/work");
        assert_eq!(term["startup_command"].as_str().unwrap(), "npm run dev");
        assert_eq!(term["title"].as_str().unwrap(), "Dev");
    }

    #[test]
    fn extract_applies_plugin_overrides() {
        let layout = sample_layout();
        let overrides = make_overrides();
        let out = extract_layout_for_template(&layout, &overrides);

        let plug = &out["children"][1];
        assert_eq!(plug["plugin_options"]["repo"].as_str().unwrap(), "/repo");
        assert_eq!(plug["pluginId"].as_str().unwrap(), "git-panel");
    }

    #[test]
    fn extract_without_overrides_still_regenerates_pane_ids() {
        let layout = sample_layout();
        let overrides = std::collections::HashMap::new();
        let out = extract_layout_for_template(&layout, &overrides);

        let leaves = out.get("children").unwrap().as_array().unwrap();
        assert_ne!(leaves[0].get("paneId").unwrap().as_str().unwrap(), "orig-1");
        assert_ne!(leaves[1].get("paneId").unwrap().as_str().unwrap(), "orig-2");
    }

    #[test]
    fn validate_scope_rejects_workspace_without_id() {
        let res = validate_scope(TemplateScope::Workspace, &None);
        assert!(res.is_err());
        let res = validate_scope(TemplateScope::Workspace, &Some("".into()));
        assert!(res.is_err());
    }

    #[test]
    fn validate_scope_accepts_global_without_id() {
        let res = validate_scope(TemplateScope::Global, &None);
        assert!(res.is_ok());
    }
}

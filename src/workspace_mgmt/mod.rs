#![allow(clippy::unused_async)]

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::error;

use crate::session::{SessionManager, SyncMsg};
use crate::settings::{self, SettingsState};

/// One Dark Pro muted palette - low saturation colors.
pub(crate) const WORKSPACE_PALETTE: [&str; 7] =
    ["#E06C75", "#D19A66", "#E5C07B", "#98C379", "#56B6C2", "#61AFEF", "#C678DD"];

#[cfg(test)]
mod tests;

/// Workspace data model.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub order: u32,
    /// References an `SshProfile.id` when this is a remote workspace.
    /// `None` means local workspace (the original behavior).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abbr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// Shared state for workspace management.
pub type WorkspacesState = Arc<RwLock<Vec<Workspace>>>;

pub(crate) fn fnv1a32(s: &str) -> u32 {
    let mut hash = 0x811c_9dc5;
    for b in s.bytes() {
        hash ^= u32::from(b);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

pub(crate) fn palette_color_for(id: &str) -> String {
    WORKSPACE_PALETTE[(fnv1a32(id) % 7) as usize].to_string()
}

pub(crate) fn is_meaningless_char(c: char) -> bool {
    c.is_control()
        || c.is_whitespace()
        || matches!(c, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}')
}

pub(crate) fn normalize_abbr(raw: &str) -> Option<String> {
    let normalized: String = raw.chars().filter(|&c| !is_meaningless_char(c)).take(3).collect();
    (!normalized.is_empty()).then_some(normalized)
}

pub(crate) fn is_valid_hex6(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

pub(crate) fn normalize_color(raw: &str) -> Option<String> {
    is_valid_hex6(raw).then(|| raw.to_uppercase())
}

pub(crate) fn migrate_colors(ws: &mut Vec<Workspace>) -> bool {
    let mut changed = false;
    for workspace in ws {
        if workspace.color.as_deref().is_none_or(|color| !is_valid_hex6(color)) {
            workspace.color = Some(palette_color_for(&workspace.id));
            changed = true;
        }
    }
    changed
}

fn simplify_local_workspace_paths(workspaces: &mut [Workspace]) {
    for workspace in workspaces {
        if workspace.connection_id.is_none() {
            workspace.path =
                dunce::simplified(FsPath::new(&workspace.path)).to_string_lossy().into_owned();
        }
    }
}

fn workspaces_path() -> PathBuf {
    settings::config_dir().join("workspaces.json")
}

/// Load workspaces from disk. Returns empty vec on any error.
pub fn load_workspaces() -> Vec<Workspace> {
    let path = workspaces_path();
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str::<Vec<Workspace>>(&data) {
                Ok(mut ws) => {
                    simplify_local_workspace_paths(&mut ws);
                    if migrate_colors(&mut ws) {
                        if let Err(e) = save_workspaces(&ws) {
                            error!("save workspaces: {}", e);
                        }
                    }
                    return ws;
                }
                Err(e) => error!("parse workspaces.json: {}", e),
            },
            Err(e) => error!("read workspaces.json: {}", e),
        }
    }
    Vec::new()
}

fn save_workspaces(ws: &[Workspace]) -> Result<(), String> {
    let dir = settings::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(ws).map_err(|e| e.to_string())?;
    std::fs::write(workspaces_path(), json).map_err(|e| e.to_string())
}

/// Create the workspaces state, loading from disk.
#[must_use]
pub fn create_workspaces_state() -> WorkspacesState {
    Arc::new(RwLock::new(load_workspaces()))
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

pub const SENSITIVE_DIRS: &[&str] =
    &["/", "/etc", "/sys", "/proc", "/dev", "/bin", "/sbin", "/usr"];

#[must_use]
pub fn is_sensitive(canonical: &FsPath) -> bool {
    SENSITIVE_DIRS.iter().any(|sensitive| {
        *sensitive != "/"
            && (canonical == FsPath::new(sensitive) || canonical.starts_with(sensitive))
    })
}

#[must_use]
pub fn is_sensitive_workspace_target(canonical: &FsPath) -> bool {
    canonical == FsPath::new("/") || is_sensitive(canonical)
}

/// Validate and canonicalize a workspace path.
///
/// # Errors
/// Returns an error message if the path is invalid.
pub fn validate_workspace_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path cannot be empty".into());
    }
    if !std::path::Path::new(trimmed).is_absolute() {
        return Err("path must be absolute".into());
    }
    // Check sensitivity on the RAW input before canonicalize: canonicalize may
    // rewrite a sensitive path (e.g. macOS /etc -> /private/etc) so the raw
    // form is the only reliable place to catch a directly-named system dir.
    let raw_trimmed = trimmed.trim_end_matches('/');
    let raw = FsPath::new(if raw_trimmed.is_empty() { "/" } else { raw_trimmed });
    if is_sensitive_workspace_target(raw) {
        return Err(format!("cannot use sensitive system directory: {}", raw.display()));
    }
    let canonical = dunce::canonicalize(trimmed).map_err(|e| format!("invalid path: {e}"))?;
    if !canonical.is_dir() {
        return Err("path is not a directory".into());
    }
    // Re-check after canonicalize (a symlink could resolve into a sensitive dir).
    if is_sensitive_workspace_target(&canonical) {
        return Err(format!("cannot use sensitive system directory: {}", canonical.display()));
    }
    Ok(canonical)
}

/// Derive a display name from a path (last component).
#[must_use]
pub fn derive_name(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    std::path::Path::new(trimmed)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "root".to_string())
}

/// Resolve the workspace id a tab belongs to, mirroring frontend
/// `useWorkspaces.ts:matchWorkspace`:
///   - SSH tabs (`connection_id` set) match by `Workspace.connection_id`.
///   - Local tabs match by longest path-prefix of `cwd` against `Workspace.path`.
///
/// Returns `None` when no workspace matches, meaning the tab belongs to the
/// default workspace (`selected_workspace_id == None` in MC state). The
/// frontend-only `tab.workspaceId` field (explicit assignment via Command
/// Palette) is not visible to the backend; we accept this edge-case
/// divergence to keep the backend stateless on that dimension.
#[must_use]
pub fn tab_workspace_id(
    workspaces: &[Workspace],
    cwd: Option<&str>,
    connection_id: Option<&str>,
) -> Option<String> {
    if let Some(cid) = connection_id {
        return workspaces
            .iter()
            .find(|w| w.connection_id.as_deref() == Some(cid))
            .map(|w| w.id.clone());
    }
    let cwd = cwd.filter(|s| !s.is_empty())?;
    let mut best: Option<&Workspace> = None;
    let mut best_len = 0;
    for ws in workspaces {
        if ws.connection_id.is_some() {
            continue;
        }
        let path = ws.path.as_str();
        let path = path.trim_end_matches('/');
        if path.is_empty() {
            continue;
        }
        if (cwd == path || (cwd.starts_with(path) && cwd.as_bytes().get(path.len()) == Some(&b'/')))
            && path.len() > best_len
        {
            best = Some(ws);
            best_len = path.len();
        }
    }
    best.map(|w| w.id.clone())
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateWorkspaceReq {
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
    /// References an `SshProfile.id` for remote workspaces.
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub abbr: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateWorkspaceReq {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub abbr: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Deserialize)]
pub struct ReorderWorkspacesReq {
    pub ids: Vec<String>,
}

// ---------------------------------------------------------------------------
// REST handlers
// ---------------------------------------------------------------------------

pub async fn list_workspaces(State(state): State<WorkspacesState>) -> impl IntoResponse {
    let ws = state.read().await;
    Json(serde_json::json!({ "workspaces": &*ws }))
}

pub async fn create_workspace(
    State((state, manager)): State<(WorkspacesState, Arc<SessionManager>)>,
    Json(req): Json<CreateWorkspaceReq>,
) -> impl IntoResponse {
    let (path_str, name) = if req.connection_id.is_some() {
        // Remote workspace: accept path as-is (remote path), skip local validation
        let path = req.path.trim().to_string();
        if path.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "path cannot be empty" })),
            )
                .into_response();
        }
        let name = req.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| derive_name(&path));
        (path, name)
    } else {
        // Local workspace: validate as before
        let canonical = match validate_workspace_path(&req.path) {
            Ok(p) => p,
            Err(e) => {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e })))
                    .into_response();
            }
        };
        let path_str = canonical.to_string_lossy().to_string();
        let name =
            req.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| derive_name(&path_str));
        (path_str, name)
    };

    let mut ws = state.write().await;

    // Duplicate check: same path AND same connection_id
    if ws.iter().any(|w| w.path == path_str && w.connection_id == req.connection_id) {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "workspace with this path already exists" })),
        )
            .into_response();
    }

    #[allow(clippy::cast_possible_truncation)]
    let order = ws.len() as u32;
    let id = uuid::Uuid::new_v4().to_string();
    let abbr = req.abbr.as_deref().and_then(normalize_abbr);
    let color =
        req.color.as_deref().and_then(normalize_color).unwrap_or_else(|| palette_color_for(&id));
    let workspace = Workspace {
        id,
        name,
        path: path_str,
        order,
        connection_id: req.connection_id,
        abbr,
        color: Some(color),
    };

    ws.push(workspace.clone());
    if let Err(e) = save_workspaces(&ws) {
        error!("save workspaces: {}", e);
    }

    manager.broadcast_sync(&SyncMsg::WorkspaceCreated { workspace: workspace.clone() });

    (StatusCode::CREATED, Json(serde_json::json!(workspace))).into_response()
}

pub async fn update_workspace(
    State((state, manager)): State<(WorkspacesState, Arc<SessionManager>)>,
    Path(id): Path<String>,
    Json(req): Json<UpdateWorkspaceReq>,
) -> impl IntoResponse {
    let mut ws = state.write().await;
    let idx = ws.iter().position(|w| w.id == id);
    let Some(idx) = idx else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "workspace not found" })),
        )
            .into_response();
    };

    // Update connection_id if provided
    if req.connection_id.is_some() {
        ws[idx].connection_id.clone_from(&req.connection_id);
    }

    if let Some(new_path) = &req.path {
        let effective_connection = req.connection_id.as_ref().or(ws[idx].connection_id.as_ref());
        if effective_connection.is_some() {
            // Remote workspace: accept path as-is
            let path = new_path.trim().to_string();
            if path.is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "path cannot be empty" })),
                )
                    .into_response();
            }
            // Duplicate check (excluding self)
            let conn_id = ws[idx].connection_id.clone();
            if ws
                .iter()
                .enumerate()
                .any(|(i, w)| i != idx && w.path == path && w.connection_id == conn_id)
            {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({ "error": "workspace with this path already exists" })),
                )
                    .into_response();
            }
            ws[idx].path = path;
        } else {
            // Local workspace: validate as before
            let canonical = match validate_workspace_path(new_path) {
                Ok(p) => p,
                Err(e) => {
                    return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e })))
                        .into_response();
                }
            };
            let path_str = canonical.to_string_lossy().to_string();
            // Duplicate check (excluding self)
            if ws.iter().enumerate().any(|(i, w)| i != idx && w.path == path_str) {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({ "error": "workspace with this path already exists" })),
                )
                    .into_response();
            }
            ws[idx].path = path_str;
        }
        // Auto-update name from new path if name wasn't explicitly provided
        if req.name.is_none() {
            ws[idx].name = derive_name(&ws[idx].path);
        }
    }

    if let Some(name) = &req.name {
        if !name.trim().is_empty() {
            ws[idx].name = name.trim().to_string();
        }
    }

    if let Some(raw) = &req.abbr {
        ws[idx].abbr = normalize_abbr(raw);
    }
    if let Some(raw) = &req.color {
        ws[idx].color =
            Some(normalize_color(raw).unwrap_or_else(|| palette_color_for(&ws[idx].id)));
    }

    let workspace = ws[idx].clone();
    if let Err(e) = save_workspaces(&ws) {
        error!("save workspaces: {}", e);
    }

    manager.broadcast_sync(&SyncMsg::WorkspaceUpdated { workspace: workspace.clone() });

    Json(serde_json::json!(workspace)).into_response()
}

pub async fn delete_workspace(
    State((state, settings, manager)): State<(WorkspacesState, SettingsState, Arc<SessionManager>)>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut ws = state.write().await;
    let idx = ws.iter().position(|w| w.id == id);
    let Some(idx) = idx else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "workspace not found" })),
        )
            .into_response();
    };

    ws.remove(idx);
    // Reassign order
    #[allow(clippy::cast_possible_truncation)]
    for (i, w) in ws.iter_mut().enumerate() {
        w.order = i as u32;
    }
    drop(ws);

    if let Err(e) = save_workspaces(&state.read().await) {
        error!("save workspaces: {}", e);
    }

    // Clear active_workspace_id if it was the deleted one
    let mut s = settings.write().await;
    if s.active_workspace_id.as_deref() == Some(&id) {
        s.active_workspace_id = None;
        if let Err(e) = settings::save_settings_sync(&s) {
            error!("save settings: {}", e);
        }
    }
    drop(s);

    manager.broadcast_sync(&SyncMsg::WorkspaceDeleted { id: id.clone() });

    Json(serde_json::json!({ "ok": true })).into_response()
}

pub async fn activate_workspace(
    State((settings, manager)): State<(SettingsState, Arc<SessionManager>)>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut s = settings.write().await;
    s.active_workspace_id = Some(id.clone());
    if let Err(e) = settings::save_settings_sync(&s) {
        error!("save settings: {}", e);
    }
    drop(s);

    manager.broadcast_sync(&SyncMsg::WorkspaceActivated { id: Some(id) });

    Json(serde_json::json!({ "ok": true }))
}

pub async fn deactivate_workspace(
    State((settings, manager)): State<(SettingsState, Arc<SessionManager>)>,
) -> impl IntoResponse {
    let mut s = settings.write().await;
    s.active_workspace_id = None;
    if let Err(e) = settings::save_settings_sync(&s) {
        error!("save settings: {}", e);
    }
    drop(s);

    manager.broadcast_sync(&SyncMsg::WorkspaceActivated { id: None });

    Json(serde_json::json!({ "ok": true }))
}

pub async fn reorder_workspaces(
    State((state, manager)): State<(WorkspacesState, Arc<SessionManager>)>,
    Json(req): Json<ReorderWorkspacesReq>,
) -> impl IntoResponse {
    let mut ws = state.write().await;

    // Validate all ids exist
    for id in &req.ids {
        if !ws.iter().any(|w| &w.id == id) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": format!("workspace not found: {id}") })),
            )
                .into_response();
        }
    }

    // Reassign order by the provided id sequence
    #[allow(clippy::cast_possible_truncation)]
    for (i, id) in req.ids.iter().enumerate() {
        if let Some(w) = ws.iter_mut().find(|w| &w.id == id) {
            w.order = i as u32;
        }
    }
    // Sort by order for consistent storage
    ws.sort_by_key(|w| w.order);

    if let Err(e) = save_workspaces(&ws) {
        error!("save workspaces: {}", e);
    }

    manager.broadcast_sync(&SyncMsg::WorkspaceReordered { ids: req.ids });

    Json(serde_json::json!({ "ok": true })).into_response()
}

/// List subdirectories at a given path for workspace path selection.
#[allow(clippy::implicit_hasher)]
pub async fn list_dirs(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let path_str = params.get("path").cloned().unwrap_or_else(|| "~".to_string());
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let path = if path_str == "~" || path_str.is_empty() {
        home.clone()
    } else if let Some(rest) = path_str.strip_prefix("~/") {
        home.join(rest)
    } else if path_str == "~" {
        home.clone()
    } else {
        PathBuf::from(&path_str)
    };

    if !path.is_dir() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "not a directory" })))
            .into_response();
    }

    let result = tokio::task::spawn_blocking(move || {
        let mut entries: Vec<String> = match std::fs::read_dir(&path) {
            Ok(rd) => rd
                .filter_map(std::result::Result::ok)
                .filter(|e| e.path().is_dir())
                .filter(|e| {
                    let name = e.file_name();
                    !name.to_string_lossy().starts_with('.')
                })
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect(),
            Err(e) => return Err(e.to_string()),
        };
        entries.sort();
        Ok((path.to_string_lossy().into_owned(), entries))
    })
    .await;

    match result {
        Ok(Ok((path_str, entries))) => Json(serde_json::json!({
            "path": path_str,
            "dirs": entries
        }))
        .into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))
            .into_response(),
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))
                .into_response()
        }
    }
}

#[cfg(test)]
mod sensitive_tests {
    use super::{is_sensitive, is_sensitive_workspace_target};
    use std::path::Path as FsPath;

    #[test]
    fn root_browsable_but_not_workspace_target() {
        let root = FsPath::new("/");
        assert!(!is_sensitive(root));
        assert!(is_sensitive_workspace_target(root));
    }

    #[test]
    fn system_dirs_and_descendants_sensitive() {
        for path in ["/etc", "/etc/ssh", "/usr/bin", "/proc/1"] {
            let path = FsPath::new(path);
            assert!(is_sensitive(path));
            assert!(is_sensitive_workspace_target(path));
        }
    }

    #[test]
    fn sibling_prefixes_not_sensitive() {
        for path in ["/etcfoo", "/home/user", "/Volumes/Dev", "/usrlocal"] {
            let path = FsPath::new(path);
            assert!(!is_sensitive(path));
            assert!(!is_sensitive_workspace_target(path));
        }
    }
}

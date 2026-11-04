//! Standalone file viewer: resolve a pane-confined file target and ask the
//! main UI to present it.
//!
//! The HTTP handler and the `file_viewer_open` MCP tool share the same
//! resolve/present pair so the two entry points cannot drift. Presentation is
//! a sync broadcast to role `Main`: detached terminal windows are connected
//! sync clients but cannot display a viewer, so they are not counted.

use std::path::PathBuf;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;

use crate::session::{SessionManager, SyncClientRole, SyncMsg};
use crate::token::TokenInfo;

use super::util::{
    is_user_path, normalize_join, path_must_be_under, rel_from_root, resolve_user_path,
    MAX_DOWNLOAD,
};

/// A file target that passed the workspace jail.
#[derive(Clone, Debug)]
pub struct ViewerTarget {
    pub pane_id: String,
    /// Workspace-relative path sent to the UI.
    pub rel_path: String,
    /// Resolved absolute path, used for agent-token scope checks.
    pub canonical_path: PathBuf,
    /// Display title (the file name).
    pub title: String,
}

/// Outcome of a delivered viewer request.
#[derive(Clone, Debug)]
pub struct ViewerDelivery {
    pub request_id: String,
    pub delivered_clients: usize,
}

/// Failures mapped to the documented `code` / HTTP status table.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ViewerError {
    UnknownPane,
    CwdUnavailable,
    InvalidPath,
    PathNotFound,
    OutsideWorkspace,
    NotAFile,
    FileTooLarge,
    ScopeDenied,
    SshUnsupported,
    NoUiClient,
}

impl ViewerError {
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Self::UnknownPane => "UNKNOWN_PANE",
            Self::CwdUnavailable => "CWD_UNAVAILABLE",
            Self::InvalidPath => "INVALID_PATH",
            Self::PathNotFound => "PATH_NOT_FOUND",
            Self::OutsideWorkspace => "OUTSIDE_WORKSPACE",
            Self::NotAFile => "NOT_A_FILE",
            Self::FileTooLarge => "FILE_TOO_LARGE",
            Self::ScopeDenied => "SCOPE_DENIED",
            Self::SshUnsupported => "SSH_UNSUPPORTED",
            Self::NoUiClient => "NO_UI_CLIENT",
        }
    }

    #[must_use]
    pub fn message(self) -> &'static str {
        match self {
            Self::UnknownPane => "unknown pane",
            Self::CwdUnavailable => "cwd unavailable for pane",
            Self::InvalidPath => "invalid path",
            Self::PathNotFound => "path not found",
            Self::OutsideWorkspace => "outside workspace",
            Self::NotAFile => "not a file",
            Self::FileTooLarge => "file too large",
            Self::ScopeDenied => "token scope does not include path",
            Self::SshUnsupported => "not supported for SSH sessions",
            Self::NoUiClient => "no connected main UI client",
        }
    }

    #[must_use]
    pub fn status(self) -> StatusCode {
        match self {
            Self::UnknownPane | Self::PathNotFound => StatusCode::NOT_FOUND,
            Self::CwdUnavailable | Self::NoUiClient => StatusCode::CONFLICT,
            Self::OutsideWorkspace | Self::ScopeDenied => StatusCode::FORBIDDEN,
            Self::FileTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::InvalidPath | Self::NotAFile | Self::SshUnsupported => StatusCode::BAD_REQUEST,
        }
    }
}

impl std::fmt::Display for ViewerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code(), self.message())
    }
}

impl std::error::Error for ViewerError {}

fn viewer_error_response(error: ViewerError) -> Response {
    (
        error.status(),
        Json(serde_json::json!({
            "error": { "code": error.code(), "message": error.message() }
        })),
    )
        .into_response()
}

fn workspace_root(manager: &SessionManager, pane_id: &str) -> Result<PathBuf, ViewerError> {
    let session = manager
        .sessions
        .get(pane_id)
        .map(|entry| std::sync::Arc::clone(entry.value()))
        .ok_or(ViewerError::UnknownPane)?;
    if session.is_ssh() {
        return Err(ViewerError::SshUnsupported);
    }
    let cwd = session.cwd_for_workspace().ok_or(ViewerError::CwdUnavailable)?;
    Ok(cwd.canonicalize().unwrap_or(cwd))
}

/// Resolve `raw_path` against the pane's workspace root and validate that it
/// names a regular file inside that root, at or under `MAX_DOWNLOAD`.
///
/// # Errors
/// Returns [`ViewerError`] for unknown/SSH panes, a missing cwd, invalid or
/// non-file paths, workspace escapes, and files over the size limit.
pub fn resolve_viewer_target(
    manager: &SessionManager,
    pane_id: &str,
    raw_path: &str,
) -> Result<ViewerTarget, ViewerError> {
    let raw_path = raw_path.trim();
    if raw_path.is_empty() {
        return Err(ViewerError::InvalidPath);
    }

    let root = workspace_root(manager, pane_id)?;
    // User paths (`/abs`, `~`, `~/x`) are expanded first; anything else is
    // workspace-relative and rejects `..` before touching the filesystem.
    let joined = if is_user_path(raw_path) {
        resolve_user_path(dirs::home_dir(), raw_path)
    } else {
        normalize_join(&root, raw_path).map_err(|_| ViewerError::InvalidPath)?
    };

    let canonical = joined.canonicalize().map_err(|_| ViewerError::PathNotFound)?;
    path_must_be_under(&root, &canonical).map_err(|_| ViewerError::OutsideWorkspace)?;

    let metadata = canonical.metadata().map_err(|_| ViewerError::PathNotFound)?;
    if !metadata.is_file() {
        return Err(ViewerError::NotAFile);
    }
    if metadata.len() > MAX_DOWNLOAD {
        return Err(ViewerError::FileTooLarge);
    }

    let rel_path = rel_from_root(&root, &canonical).ok_or(ViewerError::InvalidPath)?;
    let title = canonical
        .file_name()
        .map_or_else(|| rel_path.clone(), |name| name.to_string_lossy().into_owned());

    Ok(ViewerTarget { pane_id: pane_id.to_string(), rel_path, canonical_path: canonical, title })
}

/// Enforce agent-token permissions for a resolved target. The global token and
/// session cookies are already unrestricted; an agent token additionally has
/// to sit under the user's home, matching `file_read`'s sandbox.
///
/// # Errors
/// Returns [`ViewerError::ScopeDenied`] when the token lacks `workspace:read`,
/// its path scope excludes the target, or the target is outside the user home.
pub fn check_viewer_access(
    token_info: &TokenInfo,
    target: &ViewerTarget,
) -> Result<(), ViewerError> {
    if token_info.is_global {
        return Ok(());
    }
    if !token_info.has_capability("workspace:read") {
        return Err(ViewerError::ScopeDenied);
    }
    if !token_info.check_path_scope("workspace:read", &target.canonical_path) {
        return Err(ViewerError::ScopeDenied);
    }
    let home = dirs::home_dir().ok_or(ViewerError::ScopeDenied)?;
    let home = home.canonicalize().unwrap_or(home);
    if !target.canonical_path.starts_with(&home) {
        return Err(ViewerError::ScopeDenied);
    }
    Ok(())
}

/// Broadcast the open request to main-window sync clients and refuse when
/// nobody is there to show it.
///
/// # Errors
/// Returns [`ViewerError::NoUiClient`] when no role-`Main` client is connected.
pub fn present_file_viewer(
    manager: &SessionManager,
    target: &ViewerTarget,
) -> Result<ViewerDelivery, ViewerError> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let delivered_clients = manager.broadcast_sync_counted_role(
        &SyncMsg::OpenFileViewer {
            request_id: request_id.clone(),
            pane_id: target.pane_id.clone(),
            path: target.rel_path.clone(),
            title: Some(target.title.clone()),
        },
        SyncClientRole::Main,
    );
    if delivered_clients == 0 {
        return Err(ViewerError::NoUiClient);
    }
    Ok(ViewerDelivery { request_id, delivered_clients })
}

#[derive(Deserialize)]
pub struct OpenViewerBody {
    pub path: String,
}

/// `POST /api/sessions/:pane_id/viewer` - resolve, authorize, broadcast.
pub async fn open_viewer_handler(
    State(manager): State<std::sync::Arc<SessionManager>>,
    Path(pane_id): Path<String>,
    Extension(token_info): Extension<TokenInfo>,
    Json(body): Json<OpenViewerBody>,
) -> Response {
    let target = match resolve_viewer_target(&manager, &pane_id, &body.path) {
        Ok(target) => target,
        Err(error) => return viewer_error_response(error),
    };
    if let Err(error) = check_viewer_access(&token_info, &target) {
        return viewer_error_response(error);
    }
    match present_file_viewer(&manager, &target) {
        Ok(delivery) => Json(serde_json::json!({
            "ok": true,
            "request_id": delivery.request_id,
            "pane_id": target.pane_id,
            "path": target.rel_path,
            "title": target.title,
            "delivered_clients": delivery.delivered_clients,
        }))
        .into_response(),
        Err(error) => viewer_error_response(error),
    }
}

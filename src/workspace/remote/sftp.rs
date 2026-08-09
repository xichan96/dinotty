use axum::http::StatusCode;
use axum::response::Response;
use russh_sftp::client::SftpSession;
use std::sync::Arc;

use crate::session::Session;
use crate::ssh::sftp::{clear_sftp_cache, get_or_create_sftp, ssh_exec};
use crate::workspace::json_err;

/// Get SFTP session, clearing cache on error and retrying once.
pub(super) async fn sftp(session: &Session) -> Result<Arc<SftpSession>, Response> {
    match get_or_create_sftp(session).await {
        Ok(s) => Ok(s),
        Err(_e) => {
            clear_sftp_cache(session);
            // Retry once in case the cached session was stale
            get_or_create_sftp(session)
                .await
                .map_err(|e2| json_err(StatusCode::BAD_GATEWAY, &format!("SFTP error: {e2}")))
        }
    }
}

pub(super) fn sftp_err(e: impl std::fmt::Display) -> Response {
    json_err(StatusCode::BAD_GATEWAY, &format!("SFTP: {e}"))
}

/// Check if an SFTP error message indicates a permission denied error.
pub(super) fn is_permission_error(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    lower.contains("permission denied")
        || lower.contains("access denied")
        || lower.contains("eperm")
        || lower.contains("eacces")
}

/// Detect the current PTY user by running `whoami` via SSH exec.
/// Caches the result in `session.remote_user`.
async fn detect_remote_user(session: &Session) -> Option<String> {
    // Check cache first
    {
        let cached = session.remote_user.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(ref user) = *cached {
            return Some(user.clone());
        }
    }
    // Detect via whoami
    let cwd = session
        .cwd_for_workspace()
        .map_or_else(|| "/".to_string(), |path| path.to_string_lossy().into_owned());
    let (code, stdout, _) = ssh_exec(session, "whoami", &cwd).await.ok()?;
    if code != 0 {
        return None;
    }
    let user = stdout.trim().to_string();
    if user.is_empty() {
        return None;
    }
    *session.remote_user.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some(user.clone());
    Some(user)
}

/// Check if the PTY user is likely elevated (root) compared to the SSH auth user.
/// Returns `true` if sudo fallback should be attempted.
pub(super) async fn should_use_sudo(session: &Session) -> bool {
    let Some(pty_user) = detect_remote_user(session).await else { return false };
    // If PTY user is root, the SFTP session (running as original SSH user)
    // likely can't access the same directories
    pty_user == "root"
}

/// Recursively remove a directory via SFTP.
pub(super) async fn remove_dir_recursive(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let entries = sftp.read_dir(path).await.map_err(|e| format!("read_dir: {e}"))?;
    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child = format!("{}/{}", path.trim_end_matches('/'), name);
        let meta = entry.metadata();
        if meta.file_type().is_dir() {
            Box::pin(remove_dir_recursive(sftp, &child)).await?;
        } else {
            sftp.remove_file(&child).await.map_err(|e| format!("remove_file: {e}"))?;
        }
    }
    sftp.remove_dir(path).await.map_err(|e| format!("remove_dir: {e}"))
}

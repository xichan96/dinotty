#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use super::helpers::{extract_zip, find_plugin_root, native_approval_response, plugin_err};
use super::manager::PluginManagerState;
use super::types::{InstallGitRequest, PluginManifest};

/// # Panics
/// Panics if `SystemTime::now()` fails (which should not happen).
pub async fn install_from_git(
    State(pm): State<PluginManagerState>,
    Json(body): Json<InstallGitRequest>,
) -> Response {
    if !body.repo.contains('/') || body.repo.starts_with('/') || body.repo.ends_with('/') {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid repo format, expected owner/repo");
    }

    let zip_url =
        format!("https://github.com/{}/archive/refs/heads/{}.zip", body.repo, body.branch);

    let client = &crate::proxy::HTTP_CLIENT_FOLLOW_REDIRECTS;
    let resp = match client.get(&zip_url).send().await {
        Ok(r) => r,
        Err(e) => return plugin_err(StatusCode::BAD_GATEWAY, &format!("download failed: {e}")),
    };

    if !resp.status().is_success() {
        return plugin_err(StatusCode::BAD_GATEWAY, &format!("GitHub returned {}", resp.status()));
    }

    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return plugin_err(StatusCode::BAD_GATEWAY, &format!("download failed: {e}")),
    };

    let tmp = match tempfile::tempdir() {
        Ok(t) => t,
        Err(e) => return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if let Err(e) = extract_zip(&bytes, tmp.path()) {
        return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    let plugin_root = match find_plugin_root(tmp.path(), body.subdir.as_deref()) {
        Ok(r) => r,
        Err(e) => return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let manifest_path = plugin_root.join("plugin.json");
    let Ok(content) = std::fs::read_to_string(&manifest_path) else {
        return plugin_err(StatusCode::BAD_REQUEST, "plugin.json not found");
    };
    let manifest: PluginManifest = match serde_json::from_str(&content) {
        Ok(m) => m,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid plugin.json: {e}")),
    };
    match pm.upsert_from_dir(&plugin_root, manifest, body.approve_native).await {
        Ok(manifest) => Json(manifest).into_response(),
        Err(e) => {
            if let Some(response) = native_approval_response(&e) {
                return response;
            }
            let status = if e.starts_with("failed to stop plugin processes") {
                StatusCode::CONFLICT
            } else if e.contains("permission") || e.contains("binary") || e.contains("manifest") {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            plugin_err(status, &e)
        }
    }
}

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::platform::fs as platform_fs;

use super::helpers::{copy_dir_all, extract_zip, find_plugin_root, plugin_err};
use super::manager::PluginManagerState;
use super::types::{InstallGitRequest, PluginInfo, PluginManifest, PluginStateValue};

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
    if let Err(e) = pm.validate_for_host(&manifest) {
        return plugin_err(StatusCode::BAD_REQUEST, &e);
    }

    let dest = pm.plugin_dir.join(&manifest.id);
    let is_update =
        pm.registry.contains_key(&manifest.id) || platform_fs::path_exists_or_symlink(&dest);

    if is_update {
        pm.kill_plugin_processes(&manifest.id).await;
        let old_info = pm.registry.get(&manifest.id).map(|e| e.clone());
        let backup = match tempfile::tempdir() {
            Ok(b) => b,
            Err(e) => return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        };
        if platform_fs::path_exists_or_symlink(&dest) {
            if let Err(e) = copy_dir_all(&dest, backup.path()) {
                return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e);
            }
            if let Err(e) = platform_fs::remove_plugin_path(&dest) {
                return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e);
            }
        }
        if let Err(e) = copy_dir_all(&plugin_root, &dest) {
            let _ = platform_fs::remove_plugin_path(&dest);
            let _ = copy_dir_all(backup.path(), &dest);
            return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &format!("update failed: {e}"));
        }
        if let Err(e) = pm.prepare_binary(&dest, &manifest) {
            let _ = platform_fs::remove_plugin_path(&dest);
            let _ = copy_dir_all(backup.path(), &dest);
            return plugin_err(StatusCode::BAD_REQUEST, &e);
        }
        pm.registry.insert(
            manifest.id.clone(),
            PluginInfo {
                manifest: manifest.clone(),
                install_date: old_info.and_then(|o| o.install_date),
                state: PluginStateValue::Active,
                error: None,
                is_dev_link: false,
            },
        );
        Json(manifest).into_response()
    } else {
        if let Err(e) = std::fs::create_dir_all(&pm.plugin_dir) {
            return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
        if let Err(e) = copy_dir_all(&plugin_root, &dest) {
            return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e);
        }
        if let Err(e) = pm.prepare_binary(&dest, &manifest) {
            let _ = platform_fs::remove_plugin_path(&dest);
            return plugin_err(StatusCode::BAD_REQUEST, &e);
        }
        pm.registry.insert(
            manifest.id.clone(),
            PluginInfo {
                manifest: manifest.clone(),
                install_date: Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs(),
                ),
                state: PluginStateValue::Active,
                error: None,
                is_dev_link: false,
            },
        );
        Json(manifest).into_response()
    }
}

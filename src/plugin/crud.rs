#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::Multipart;

use crate::platform::fs as platform_fs;

use super::helpers::{native_approval_response, plugin_err, require_native_approval};
use super::manager::PluginManagerState;
use super::types::{
    DeleteQuery, DevLinkRequest, InstallDirRequest, NativeApprovalQuery, PluginInfo,
    PluginManifest, PluginStateValue,
};

#[allow(clippy::unused_async)]
pub async fn list_plugins(State(pm): State<PluginManagerState>) -> Json<Vec<PluginInfo>> {
    Json(pm.list())
}

/// # Errors
/// Returns `StatusCode::NOT_FOUND` if the plugin is not found.
#[allow(clippy::unused_async)]
pub async fn plugin_detail(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
) -> Result<Json<PluginInfo>, StatusCode> {
    pm.registry.get(&id).map(|info| Json(info.clone())).ok_or(StatusCode::NOT_FOUND)
}

/// # Panics
/// Panics if the response builder fails.
pub async fn plugin_asset(
    Path((id, subpath)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
) -> Response {
    if subpath.contains("..") {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid path");
    }

    let plugin_path = pm.plugin_dir.join(&id);
    let file_path = plugin_path.join(&subpath);

    let Ok(canonical) = std::fs::canonicalize(&file_path) else {
        return plugin_err(StatusCode::NOT_FOUND, "file not found");
    };
    let Ok(canonical_plugin) = std::fs::canonicalize(&plugin_path) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    };
    if !canonical.starts_with(&canonical_plugin) {
        return plugin_err(StatusCode::FORBIDDEN, "access denied");
    }

    let Ok(content) = tokio::fs::read(&file_path).await else {
        return plugin_err(StatusCode::NOT_FOUND, "file not found");
    };
    let mime = mime_guess::from_path(&file_path).first_or_octet_stream();

    Response::builder()
        .header("Content-Type", mime.as_ref())
        .header("Cache-Control", "no-cache")
        .body(Body::from(content))
        .unwrap()
}

pub async fn install_plugin(
    State(pm): State<PluginManagerState>,
    Query(query): Query<NativeApprovalQuery>,
    mut multipart: Multipart,
) -> Response {
    let field = match multipart.next_field().await {
        Ok(Some(f)) => f,
        Ok(None) => return plugin_err(StatusCode::BAD_REQUEST, "no file"),
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e.to_string()),
    };
    let data = match field.bytes().await {
        Ok(d) => d,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e.to_string()),
    };

    match pm.install_with_approval(&data, query.approve_native).await {
        Ok(manifest) => Json(manifest).into_response(),
        Err(e) => native_approval_response(&e)
            .unwrap_or_else(|| plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e)),
    }
}

pub async fn update_plugin(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
    Query(query): Query<NativeApprovalQuery>,
    mut multipart: Multipart,
) -> Response {
    let field = match multipart.next_field().await {
        Ok(Some(f)) => f,
        Ok(None) => return plugin_err(StatusCode::BAD_REQUEST, "no file"),
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e.to_string()),
    };
    let data = match field.bytes().await {
        Ok(d) => d,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e.to_string()),
    };

    match pm.update_with_approval(&id, &data, query.approve_native).await {
        Ok(manifest) => Json(manifest).into_response(),
        Err(e) => native_approval_response(&e)
            .unwrap_or_else(|| plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e)),
    }
}

pub async fn delete_plugin(
    Path(id): Path<String>,
    Query(query): Query<DeleteQuery>,
    State(pm): State<PluginManagerState>,
) -> Response {
    match pm.delete(&id, query.keep_data).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

#[allow(clippy::unused_async)]
pub async fn dev_link_plugin(
    State(pm): State<PluginManagerState>,
    Json(body): Json<DevLinkRequest>,
) -> Response {
    let src = match std::fs::canonicalize(&body.path) {
        Ok(p) => p,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid path: {e}")),
    };

    let manifest_path = src.join("plugin.json");
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
    if let Err(e) = require_native_approval(&manifest, body.approve_native) {
        return native_approval_response(&e)
            .unwrap_or_else(|| plugin_err(StatusCode::BAD_REQUEST, &e));
    }
    if let Err(e) = pm.prepare_binary(&src, &manifest) {
        return plugin_err(StatusCode::BAD_REQUEST, &e);
    }

    let link = pm.plugin_dir.join(&manifest.id);
    let operation_lock = pm.operation_lock(&manifest.id);
    let _operation = operation_lock.write_owned().await;
    if platform_fs::path_exists_or_symlink(&link) {
        if std::fs::symlink_metadata(&link).is_ok_and(|metadata| metadata.file_type().is_dir()) {
            return plugin_err(StatusCode::CONFLICT, "a real plugin directory already exists");
        }
        if let Err(e) = pm.kill_plugin_processes(&manifest.id).await {
            return plugin_err(StatusCode::CONFLICT, &e);
        }
        if let Err(e) = platform_fs::remove_symlink_or_file(&link) {
            return plugin_err(StatusCode::CONFLICT, &e);
        }
    }

    if let Err(e) = std::fs::create_dir_all(&pm.plugin_dir) {
        return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    if let Err(e) = platform_fs::create_dir_symlink(&src, &link) {
        return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }

    pm.registry.insert(
        manifest.id.clone(),
        PluginInfo {
            manifest: manifest.clone(),
            install_date: None,
            state: PluginStateValue::Active,
            error: None,
            is_dev_link: true,
        },
    );

    Json(manifest).into_response()
}

pub async fn install_from_dir(
    State(pm): State<PluginManagerState>,
    Json(body): Json<InstallDirRequest>,
) -> Response {
    let src = match std::fs::canonicalize(&body.path) {
        Ok(p) => p,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid path: {e}")),
    };
    if !src.is_dir() {
        return plugin_err(StatusCode::BAD_REQUEST, "path is not a directory");
    }

    match pm.install_from_dir_with_approval(&src, body.dev_link, body.approve_native).await {
        Ok(manifest) => Json(manifest).into_response(),
        Err(e) => {
            if let Some(response) = native_approval_response(&e) {
                return response;
            }
            let status = if e.contains("already installed") {
                StatusCode::CONFLICT
            } else if e.starts_with("failed to copy")
                || e.starts_with("failed to validate copied")
                || e.starts_with("failed to create plugin directory")
                || e.starts_with("failed to create development link")
            {
                StatusCode::INTERNAL_SERVER_ERROR
            } else {
                StatusCode::BAD_REQUEST
            };
            plugin_err(status, &format!("folder install failed: {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::dev_link_plugin;
    use crate::plugin::manager::PluginManager;
    use crate::plugin::types::DevLinkRequest;
    use axum::{extract::State, http::StatusCode, Json};
    use dashmap::DashMap;
    use std::path::Path;
    use std::sync::Arc;

    fn test_manager(root: &Path) -> Arc<PluginManager> {
        Arc::new(PluginManager {
            plugin_dir: root.join("plugins"),
            data_dir: root.join("plugin-data"),
            registry: DashMap::new(),
            processes: DashMap::new(),
            operation_locks: DashMap::new(),
            host_target: crate::plugin::HostTarget::current(),
            host_origin: "http://127.0.0.1:8999".into(),
            host_version: env!("CARGO_PKG_VERSION").into(),
            host_mode: "test".into(),
        })
    }

    fn write_plugin_source(root: &Path, id: &str) -> std::path::PathBuf {
        let src = root.join("src").join(id);
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(
            src.join("plugin.json"),
            format!(r#"{{"id":"{id}","name":"Test Plugin","version":"1.0.0"}}"#),
        )
        .unwrap();
        src
    }

    // 验证 dev-link API 遇到真实目录冲突时不会删除原目录。
    #[tokio::test]
    async fn dev_link_plugin_conflicts_with_existing_real_directory_without_deleting_it() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = test_manager(tmp.path());
        let src = write_plugin_source(tmp.path(), "real-dir-plugin");
        let existing = manager.plugin_dir.join("real-dir-plugin");
        std::fs::create_dir_all(&existing).unwrap();
        std::fs::write(existing.join("sentinel.txt"), "do not delete").unwrap();

        let response = dev_link_plugin(
            State(Arc::clone(&manager)),
            Json(DevLinkRequest {
                path: src.to_string_lossy().into_owned(),
                approve_native: false,
            }),
        )
        .await;

        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert!(existing.join("sentinel.txt").is_file());
        assert!(!existing.is_symlink());
        assert!(!manager.registry.contains_key("real-dir-plugin"));
    }
}

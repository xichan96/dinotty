#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    body::Body,
    extract::{ConnectInfo, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::Multipart;
use dashmap::DashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::{Mutex as TokioMutex, RwLock};

use crate::{
    platform::{fs as platform_fs, process::CommandNoWindowExt},
    session::SessionManager,
};

use super::helpers::{
    copy_dir_all, extract_zip, find_plugin_root, is_safe_segment, plugin_err, set_executable,
    validate_manifest, version_gt,
};
use super::manager::PluginManagerState;
use super::types::{
    DeleteQuery, DevLinkRequest, ExecRequest, ExecResult, InstallDirRequest, InstallGitRequest,
    ManagedProcess, MarketPlugin, PluginInfo, PluginManifest, PluginStateValue, ProcessInfo,
    ProcessStartRequest, ProcessState, RegistryIndex, SpawnQuery,
};

// ─── Marketplace Registry Cache ─────────────────────────────────────────────

const REGISTRY_CACHE_TTL: Duration = Duration::from_mins(5); // 5 minutes

struct RegistryCache {
    data: RwLock<Option<(Instant, String)>>,
}

static REGISTRY_CACHE: std::sync::LazyLock<RegistryCache> =
    std::sync::LazyLock::new(|| RegistryCache { data: RwLock::new(None) });

/// Fetch the registry JSON, using a 5-minute in-memory cache to avoid
/// repeated cold-start HTTP round-trips to GitHub on every page load.
async fn fetch_cached_registry() -> Result<String, Response> {
    // Fast path: return cached value if still fresh
    {
        let guard = REGISTRY_CACHE.data.read().await;
        if let Some((fetched_at, ref body)) = *guard {
            if fetched_at.elapsed() < REGISTRY_CACHE_TTL {
                return Ok(body.clone());
            }
        }
    }

    // Slow path: fetch from GitHub and update cache
    let registry_url =
        std::env::var("DINOTTY_REGISTRY_URL").unwrap_or_else(|_| DEFAULT_REGISTRY_URL.into());

    let client = &crate::proxy::HTTP_CLIENT_FOLLOW_REDIRECTS;
    let resp = client.get(&registry_url).send().await.map_err(|e| {
        plugin_err(StatusCode::BAD_GATEWAY, &format!("failed to fetch registry: {e}"))
    })?;

    let body = resp.text().await.map_err(|e| {
        plugin_err(StatusCode::BAD_GATEWAY, &format!("failed to read registry: {e}"))
    })?;

    // Validate JSON before caching
    let _: RegistryIndex = serde_json::from_str(&body)
        .map_err(|e| plugin_err(StatusCode::BAD_GATEWAY, &format!("invalid registry JSON: {e}")))?;

    // Update cache
    {
        let mut guard = REGISTRY_CACHE.data.write().await;
        *guard = Some((Instant::now(), body.clone()));
    }

    Ok(body)
}

// ─── Basic CRUD ─────────────────────────────────────────────────────────────

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

// ─── Exec / Spawn ───────────────────────────────────────────────────────────

pub async fn plugin_exec(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
    Json(body): Json<ExecRequest>,
) -> Response {
    let Some(info) = pm.registry.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    };
    let bin = match &info.manifest.bin {
        Some(b) if b.mode == "cli" => b,
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    };

    let bin_path = pm.plugin_dir.join(&id).join(&bin.entry);
    let mut cmd = Command::new(&bin_path);
    cmd.no_window();
    cmd.args(&body.args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    if let Some(ref cwd) = body.cwd {
        cmd.current_dir(cwd);
    }
    for key in crate::pty::claude_session_env_keys_to_strip() {
        cmd.env_remove(key);
    }
    if let Some(ref env) = body.env {
        cmd.envs(env);
    }

    let timeout_ms = body.timeout.unwrap_or(30_000);
    let timeout_dur = std::time::Duration::from_millis(timeout_ms);

    match tokio::time::timeout(timeout_dur, cmd.output()).await {
        Ok(Ok(output)) => Json(ExecResult {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
        .into_response(),
        Ok(Err(e)) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        Err(_) => Json(ExecResult {
            code: -1,
            stdout: String::new(),
            stderr: format!("timeout after {timeout_ms}ms"),
        })
        .into_response(),
    }
}

/// # Panics
/// Panics if the child process stdout cannot be captured.
#[allow(clippy::unused_async)]
pub async fn plugin_spawn_ws(
    Path(id): Path<String>,
    Query(params): Query<SpawnQuery>,
    State(pm): State<PluginManagerState>,
    State(settings): State<crate::settings::SettingsState>,
    ws: axum::extract::WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
) -> Response {
    let s = settings.read().await;
    let allowed_origins = s.auth.allowed_origins.clone();
    let trusted_proxies = s.auth.trusted_proxies.clone();
    drop(s);
    let real_ip = crate::auth::real_client_ip(&headers, addr.ip(), &trusted_proxies);
    if !crate::auth::check_ws_origin(&headers, &allowed_origins, real_ip, &trusted_proxies) {
        return plugin_err(StatusCode::FORBIDDEN, "origin not allowed");
    }
    let Some(info) = pm.registry.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    };
    let bin = match &info.manifest.bin {
        Some(b) if b.mode == "cli" => b.clone(),
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    };
    let plugin_dir = pm.plugin_dir.join(&id);

    let args: Vec<String> = match serde_json::from_str(&params.args) {
        Ok(a) => a,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid args: {e}")),
    };

    ws.on_upgrade(move |mut socket| async move {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let bin_path = plugin_dir.join(&bin.entry);
        let mut cmd = Command::new(&bin_path);
        for key in crate::pty::claude_session_env_keys_to_strip() {
            cmd.env_remove(key);
        }
        cmd.no_window().args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = socket
                    .send(axum::extract::ws::Message::Text(
                        serde_json::json!({"type": "stderr", "data": e.to_string()}).to_string(),
                    ))
                    .await;
                let _ = socket
                    .send(axum::extract::ws::Message::Text(
                        serde_json::json!({"type": "done"}).to_string(),
                    ))
                    .await;
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        let tx2 = tx.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stdout_reader.next_line().await {
                if tx2
                    .send(serde_json::json!({"type": "stdout", "data": line + "\n"}).to_string())
                    .is_err()
                {
                    break;
                }
            }
        });

        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                if tx
                    .send(serde_json::json!({"type": "stderr", "data": line + "\n"}).to_string())
                    .is_err()
                {
                    break;
                }
            }
        });

        loop {
            tokio::select! {
                Some(msg) = rx.recv() => {
                    if socket.send(axum::extract::ws::Message::Text(msg)).await.is_err() {
                        let _ = child.kill().await;
                        break;
                    }
                }
                msg = socket.recv() => {
                    if msg.is_none() {
                        let _ = child.kill().await;
                        break;
                    }
                }
                status = child.wait() => {
                    let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
                    let _ = socket
                        .send(axum::extract::ws::Message::Text(
                            serde_json::json!({"type": "done", "code": code}).to_string(),
                        ))
                        .await;
                    break;
                }
            }
        }
    })
}

// ─── Storage ────────────────────────────────────────────────────────────────

pub async fn plugin_storage_list(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
) -> Response {
    if !is_safe_segment(&id) {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid plugin id");
    }
    let dir = pm.data_dir.join(&id);
    let mut keys = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(name) = entry.file_name().to_str() {
                if std::path::Path::new(name)
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
                {
                    keys.push(name.trim_end_matches(".json").to_string());
                }
            }
        }
    }
    Json(serde_json::json!({ "keys": keys })).into_response()
}

pub async fn plugin_storage_get(
    Path((id, key)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
) -> Response {
    if !is_safe_segment(&id) || !is_safe_segment(&key) {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid id or key");
    }
    let path = pm.data_dir.join(&id).join(format!("{key}.json"));
    let Ok(content) = tokio::fs::read_to_string(&path).await else {
        return plugin_err(StatusCode::NOT_FOUND, "key not found");
    };
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(val) => Json(serde_json::json!({ "value": val })).into_response(),
        Err(_) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, "corrupt data"),
    }
}

/// # Panics
/// Panics if JSON serialization of the value fails (which should be infallible for `serde_json::Value`).
pub async fn plugin_storage_set(
    Path((id, key)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    if !is_safe_segment(&id) || !is_safe_segment(&key) {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid id or key");
    }
    let dir = pm.data_dir.join(&id);
    let _ = tokio::fs::create_dir_all(&dir).await;
    let path = dir.join(format!("{key}.json"));
    let val = body.get("value").cloned().unwrap_or(body);
    match tokio::fs::write(&path, serde_json::to_string(&val).expect("serialization is infallible"))
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub async fn plugin_storage_delete(
    Path((id, key)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
) -> Response {
    if !is_safe_segment(&id) || !is_safe_segment(&key) {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid id or key");
    }
    let path = pm.data_dir.join(&id).join(format!("{key}.json"));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ─── Install / Update / Delete (file upload) ────────────────────────────────

pub async fn install_plugin(
    State(pm): State<PluginManagerState>,
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

    match pm.install(&data) {
        Ok(manifest) => Json(manifest).into_response(),
        Err(e) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

pub async fn update_plugin(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
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

    match pm.update(&id, &data) {
        Ok(manifest) => Json(manifest).into_response(),
        Err(e) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e),
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

// ─── Dev-Link ───────────────────────────────────────────────────────────────

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

    if let Err(e) = validate_manifest(&manifest) {
        return plugin_err(StatusCode::BAD_REQUEST, &e);
    }

    let link = pm.plugin_dir.join(&manifest.id);
    if platform_fs::path_exists_or_symlink(&link) {
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

#[allow(clippy::unused_async)]
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

    match pm.install_from_dir(&src, body.dev_link) {
        Ok(manifest) => Json(manifest).into_response(),
        Err(e) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

// ─── Marketplace ────────────────────────────────────────────────────────────

const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/xichan96/dinotty-plugins/main/registry.json";

pub async fn get_market_registry(State(pm): State<PluginManagerState>) -> Response {
    let body = match fetch_cached_registry().await {
        Ok(b) => b,
        Err(resp) => return resp,
    };

    let registry: RegistryIndex = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(e) => {
            return plugin_err(StatusCode::BAD_GATEWAY, &format!("invalid registry JSON: {e}"))
        }
    };

    let market: Vec<MarketPlugin> = registry
        .plugins
        .into_iter()
        .map(|entry| {
            let installed = pm.registry.get(&entry.id);
            let installed_version = installed.as_ref().map(|i| i.manifest.version.clone());
            let has_update =
                installed_version.as_ref().is_some_and(|v| version_gt(&entry.version, v));

            MarketPlugin {
                id: entry.id,
                name: entry.name,
                description: entry.description,
                description_zh: entry.description_zh,
                version: entry.version,
                icon: entry.icon,
                repo: entry.repo,
                branch: entry.branch,
                subdir: entry.subdir,
                author: entry.author,
                homepage: entry.homepage,
                installed_version,
                has_update,
            }
        })
        .collect();

    Json(market).into_response()
}

/// # Panics
/// Panics if the response builder fails.
pub async fn get_market_readme(Path(id): Path<String>) -> Response {
    let body = match fetch_cached_registry().await {
        Ok(b) => b,
        Err(resp) => return resp,
    };

    let registry: RegistryIndex = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(e) => {
            return plugin_err(StatusCode::BAD_GATEWAY, &format!("invalid registry JSON: {e}"))
        }
    };

    let client = &crate::proxy::HTTP_CLIENT_FOLLOW_REDIRECTS;

    let Some(entry) = registry.plugins.iter().find(|p| p.id == id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found in registry");
    };

    let readme_url = match &entry.subdir {
        Some(sub) => format!(
            "https://raw.githubusercontent.com/{}/{}/{}/README.md",
            entry.repo, entry.branch, sub
        ),
        None => {
            format!("https://raw.githubusercontent.com/{}/{}/README.md", entry.repo, entry.branch)
        }
    };

    let readme_resp = match client.get(&readme_url).send().await {
        Ok(r) => r,
        Err(e) => {
            return plugin_err(StatusCode::BAD_GATEWAY, &format!("failed to fetch README: {e}"))
        }
    };

    if readme_resp.status().as_u16() == 404 {
        return plugin_err(StatusCode::NOT_FOUND, "README not found");
    }

    if !readme_resp.status().is_success() {
        return plugin_err(
            StatusCode::BAD_GATEWAY,
            &format!("GitHub returned {}", readme_resp.status()),
        );
    }

    let readme_text = match readme_resp.text().await {
        Ok(t) => t,
        Err(e) => {
            return plugin_err(StatusCode::BAD_GATEWAY, &format!("failed to read README: {e}"))
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Cache-Control", "public, max-age=3600")
        .body(Body::from(readme_text))
        .unwrap()
}

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
    if let Err(e) = validate_manifest(&manifest) {
        return plugin_err(StatusCode::BAD_REQUEST, &e);
    }

    let dest = pm.plugin_dir.join(&manifest.id);
    let is_update =
        pm.registry.contains_key(&manifest.id) || platform_fs::path_exists_or_symlink(&dest);

    if is_update {
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
        if let Some(ref bin) = manifest.bin {
            let _ = set_executable(&dest.join(&bin.entry));
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
        if let Some(ref bin) = manifest.bin {
            let _ = set_executable(&dest.join(&bin.entry));
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

// ─── Process Management ─────────────────────────────────────────────────────

#[allow(clippy::unused_async)]
pub async fn plugin_process_start(
    Path(id): Path<String>,
    State((pm, manager)): State<(PluginManagerState, Arc<SessionManager>)>,
    Json(body): Json<ProcessStartRequest>,
) -> Response {
    let Some(info) = pm.registry.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    };
    let bin = match &info.manifest.bin {
        Some(b) if b.mode == "cli" => b,
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    };

    let bin_path = pm.plugin_dir.join(&id).join(&bin.entry);
    let mut cmd = Command::new(&bin_path);
    for key in crate::pty::claude_session_env_keys_to_strip() {
        cmd.env_remove(key);
    }
    cmd.no_window();
    cmd.args(&body.args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    if let Some(ref cwd) = body.cwd {
        cmd.current_dir(cwd);
    }
    if let Some(ref env) = body.env {
        cmd.envs(env);
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let Some(pid) = child.id() else {
        return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, "failed to get process id");
    };
    let proc_id = pid.to_string();
    let child_arc = Arc::new(TokioMutex::new(Some(child)));

    let managed_proc = ManagedProcess {
        info: ProcessInfo {
            pid,
            command: bin_path.to_string_lossy().into_owned(),
            args: body.args.clone(),
            state: ProcessState::Running,
            exit_code: None,
        },
        child: child_arc.clone(),
    };

    pm.processes
        .entry(id.clone())
        .or_insert_with(DashMap::new)
        .insert(proc_id.clone(), managed_proc);

    let pm_clone = Arc::clone(&pm);
    let manager_clone = Arc::clone(&manager);
    let plugin_id = id.clone();
    tokio::spawn(async move {
        let exit_code = {
            let mut child_guard = child_arc.lock().await;
            if let Some(ref mut c) = *child_guard {
                c.wait().await.ok().and_then(|s| s.code())
            } else {
                None
            }
        };

        if let Some(proc_map) = pm_clone.processes.get(&plugin_id) {
            if let Some(mut entry) = proc_map.get_mut(&proc_id) {
                entry.info.state = ProcessState::Exited;
                entry.info.exit_code = exit_code;
            }
        }

        manager_clone.broadcast_sync(&crate::session::SyncMsg::ProcessExited {
            plugin_id,
            pid,
            exit_code,
        });
    });

    Json(serde_json::json!({
        "pid": pid,
        "command": bin_path.to_string_lossy(),
        "args": body.args,
        "state": "running"
    }))
    .into_response()
}

#[allow(clippy::unused_async)]
pub async fn plugin_process_list(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
) -> Response {
    let Some(proc_map) = pm.processes.get(&id) else {
        return Json(serde_json::json!([])).into_response();
    };
    let list: Vec<ProcessInfo> = proc_map.iter().map(|e| e.value().info.clone()).collect();
    Json(list).into_response()
}

pub async fn plugin_process_stop(
    Path((id, pid_str)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
) -> Response {
    let Some(proc_map) = pm.processes.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "no processes for plugin");
    };
    let Some(entry) = proc_map.get_mut(&pid_str) else {
        return plugin_err(StatusCode::NOT_FOUND, "process not found");
    };
    let mut child = entry.child.lock().await;
    if let Some(ref mut c) = *child {
        let _ = c.kill().await;
    }
    StatusCode::NO_CONTENT.into_response()
}

pub async fn plugin_process_stop_all(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
) -> Response {
    pm.kill_plugin_processes(&id).await;
    StatusCode::NO_CONTENT.into_response()
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
            Json(DevLinkRequest { path: src.to_string_lossy().into_owned() }),
        )
        .await;

        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert!(existing.join("sentinel.txt").is_file());
        assert!(!existing.is_symlink());
        assert!(!manager.registry.contains_key("real-dir-plugin"));
    }
}

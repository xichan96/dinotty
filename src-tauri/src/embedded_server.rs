use axum::extract::{ConnectInfo, State as AxumState};
use axum::Json;
use axum::{
    body::Body,
    extract::Path,
    http::{header, Response, StatusCode},
    middleware,
    response::IntoResponse,
    routing::{any, delete, get, post, put},
    Router,
};
use rust_embed::Embed;
use std::net::SocketAddr;
use std::sync::Arc;

use dinotty_server::api::clipboard;
use dinotty_server::auth;
use dinotty_server::auth::session::SessionStore;
use dinotty_server::events;
use dinotty_server::file_watcher::{self, FileWatcherState};
use dinotty_server::history;
use dinotty_server::history::HistoryState;
use dinotty_server::monitor::MonitorState;
use dinotty_server::notification::{self, NotificationBroadcast};
use dinotty_server::platform::process::CommandNoWindowExt;
use dinotty_server::plugin::{self, PluginManager, PluginManagerState};
use dinotty_server::proxy;
use dinotty_server::session::SessionManager;
use dinotty_server::settings;
use dinotty_server::tabs;
use dinotty_server::templates;
use dinotty_server::workspace;
use dinotty_server::workspace_mgmt;
use dinotty_server::ws;

#[derive(Embed)]
#[folder = "../frontend/dist/"]
struct StaticFiles;

#[derive(Clone, serde::Serialize)]
pub struct GitInfo {
    pub version: String,
    pub repo_url: String,
}

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<SessionManager>,
    pub settings: settings::SettingsState,
    pub file_watcher: Arc<FileWatcherState>,
    pub monitor: MonitorState,
    pub notifier: Arc<NotificationBroadcast>,
    pub history: HistoryState,
    pub auth_token: Arc<tokio::sync::RwLock<String>>,
    pub plugins: PluginManagerState,
    pub port: u16,
    pub git_info: GitInfo,
    pub sessions: Arc<SessionStore>,
    pub workspaces: workspace_mgmt::WorkspacesState,
}

impl axum::extract::FromRef<AppState> for Arc<SessionManager> {
    fn from_ref(state: &AppState) -> Self {
        state.manager.clone()
    }
}

impl axum::extract::FromRef<AppState> for settings::SettingsState {
    fn from_ref(state: &AppState) -> Self {
        state.settings.clone()
    }
}

impl axum::extract::FromRef<AppState> for (Arc<SessionManager>, settings::SettingsState) {
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.settings.clone())
    }
}

impl axum::extract::FromRef<AppState> for (Arc<SessionManager>, Arc<FileWatcherState>) {
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.file_watcher.clone())
    }
}

impl axum::extract::FromRef<AppState> for MonitorState {
    fn from_ref(state: &AppState) -> Self {
        state.monitor.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<NotificationBroadcast> {
    fn from_ref(state: &AppState) -> Self {
        state.notifier.clone()
    }
}

impl axum::extract::FromRef<AppState> for (Arc<NotificationBroadcast>, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.notifier.clone(), state.manager.clone())
    }
}

impl axum::extract::FromRef<AppState> for HistoryState {
    fn from_ref(state: &AppState) -> Self {
        state.history.clone()
    }
}

impl axum::extract::FromRef<AppState> for PluginManagerState {
    fn from_ref(state: &AppState) -> Self {
        state.plugins.clone()
    }
}

impl axum::extract::FromRef<AppState> for (PluginManagerState, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.plugins.clone(), state.manager.clone())
    }
}

impl axum::extract::FromRef<AppState> for Arc<SessionStore> {
    fn from_ref(state: &AppState) -> Self {
        state.sessions.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<tokio::sync::RwLock<String>> {
    fn from_ref(state: &AppState) -> Self {
        state.auth_token.clone()
    }
}

impl axum::extract::FromRef<AppState> for clipboard::ClipboardState {
    fn from_ref(state: &AppState) -> Self {
        clipboard::ClipboardState::new(state.auth_token.clone(), state.sessions.clone(), state.port)
    }
}

impl axum::extract::FromRef<AppState> for workspace_mgmt::WorkspacesState {
    fn from_ref(state: &AppState) -> Self {
        state.workspaces.clone()
    }
}

impl axum::extract::FromRef<AppState> for (workspace_mgmt::WorkspacesState, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.workspaces.clone(), state.manager.clone())
    }
}

impl axum::extract::FromRef<AppState>
    for (workspace_mgmt::WorkspacesState, Arc<SessionManager>, settings::SettingsState)
{
    fn from_ref(state: &AppState) -> Self {
        (state.workspaces.clone(), state.manager.clone(), state.settings.clone())
    }
}

impl axum::extract::FromRef<AppState>
    for (workspace_mgmt::WorkspacesState, settings::SettingsState, Arc<SessionManager>)
{
    fn from_ref(state: &AppState) -> Self {
        (state.workspaces.clone(), state.settings.clone(), state.manager.clone())
    }
}

impl axum::extract::FromRef<AppState> for (settings::SettingsState, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.settings.clone(), state.manager.clone())
    }
}

impl axum::extract::FromRef<AppState>
    for (Arc<SessionManager>, workspace_mgmt::WorkspacesState, settings::SettingsState)
{
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.workspaces.clone(), state.settings.clone())
    }
}

async fn static_handler(Path(path): Path<String>) -> impl IntoResponse {
    let lookup = format!("assets/{}", path);
    match StaticFiles::get(&lookup) {
        Some(content) => {
            let mime = mime_guess::from_path(&lookup).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => {
            Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("not found")).unwrap()
        }
    }
}

async fn index() -> impl IntoResponse {
    let content = StaticFiles::get("index.html").expect("index.html must exist in frontend/dist/");
    let html = String::from_utf8_lossy(&content.data);
    (
        [(header::CACHE_CONTROL, axum::http::HeaderValue::from_static("no-store"))],
        axum::response::Html(html.to_string()),
    )
}

async fn icon_handler(Path(path): Path<String>) -> impl IntoResponse {
    let lookup = format!("icons/{}", path);
    match StaticFiles::get(&lookup) {
        Some(content) => {
            let mime = mime_guess::from_path(&lookup).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .header(header::CACHE_CONTROL, "public, max-age=86400")
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => {
            Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("not found")).unwrap()
        }
    }
}

async fn manifest_handler() -> impl IntoResponse {
    match StaticFiles::get("manifest.json") {
        Some(content) => Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(content.data.into_owned()))
            .unwrap(),
        None => {
            Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("not found")).unwrap()
        }
    }
}

fn generate_random_token() -> String {
    use rand::RngExt;
    let mut rng = rand::rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.random::<u8>()).collect();
    bytes.iter().fold(String::with_capacity(64), |mut s, b| {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
        s
    })
}

fn read_git_info() -> GitInfo {
    let version = env!("CARGO_PKG_VERSION").to_string();

    let mut command = std::process::Command::new("git");
    let repo_url = command
        .no_window()
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            let url = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if url.starts_with("git@") {
                url.replace(":", "/")
                    .replace("git@", "https://")
                    .trim_end_matches(".git")
                    .to_string()
            } else {
                url.trim_end_matches(".git").to_string()
            }
        })
        .unwrap_or_default();

    GitInfo { version, repo_url }
}

async fn server_info(AxumState(state): AxumState<AppState>) -> Json<serde_json::Value> {
    let lan_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());
    Json(serde_json::json!({
        "lan_ip": lan_ip,
        "port": state.port,
        "version": state.git_info.version,
        "repo_url": state.git_info.repo_url,
    }))
}

async fn check_auth(
    AxumState(state): AxumState<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let (
        real_ip,
        lockout_strategy,
        max_failures,
        lockout_secs,
        global_max_failures,
        global_lockout_secs,
    ) = {
        let s = state.settings.read().await;
        (
            auth::real_client_ip(&headers, addr.ip(), &s.auth.trusted_proxies),
            s.auth.lockout_strategy.clone(),
            s.auth.lockout_max_failures,
            s.auth.lockout_secs,
            s.auth.global_lockout_max_failures,
            s.auth.global_lockout_secs,
        )
    };

    if let Some(retry_after) = auth::check_lockout(
        real_ip,
        &lockout_strategy,
        max_failures,
        lockout_secs,
        global_max_failures,
        global_lockout_secs,
    ) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(
                header::RETRY_AFTER,
                axum::http::HeaderValue::from_str(&retry_after.to_string()).unwrap(),
            )],
            Json(serde_json::json!({"error": "too many failed attempts, please try again later"})),
        )
            .into_response();
    }

    let stored = state.auth_token.read().await.clone();
    let token = body.get("token").and_then(|v| v.as_str()).unwrap_or("");
    if !auth::constant_time_eq(token.trim(), &stored) {
        auth::record_auth_failure(real_ip, global_lockout_secs);
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "unauthorized"})))
            .into_response();
    }
    let session_id = state.sessions.create(Some(real_ip), None);
    let cookie_name = auth::session_cookie_name(state.port);
    let cookie =
        format!("{}={}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800", cookie_name, session_id);
    (
        StatusCode::OK,
        [(header::SET_COOKIE, axum::http::HeaderValue::from_str(&cookie).unwrap())],
        Json(serde_json::json!({"ok": true})),
    )
        .into_response()
}

async fn check_auth_session(AxumState(_state): AxumState<AppState>) -> StatusCode {
    // If we reach here, the auth middleware already validated the session.
    StatusCode::OK
}

async fn logout(
    AxumState(state): AxumState<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let cookie_name = auth::session_cookie_name(state.port);
    if let Some(cookie_header) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
        for pair in cookie_header.split(';') {
            let pair = pair.trim();
            if let Some(sid) = pair.strip_prefix(&format!("{cookie_name}=")) {
                let _ = state.sessions.revoke(sid);
                break;
            }
        }
    }
    let clear_cookie = format!("{cookie_name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    (
        [(header::SET_COOKIE, axum::http::HeaderValue::from_str(&clear_cookie).unwrap())],
        StatusCode::OK,
    )
}

async fn list_sessions_handler(AxumState(state): AxumState<AppState>) -> Json<serde_json::Value> {
    let sessions = state.sessions.list();
    Json(serde_json::json!({ "sessions": sessions }))
}

async fn revoke_session_handler(
    AxumState(state): AxumState<AppState>,
    Path(id): Path<String>,
) -> StatusCode {
    let _ = state.sessions.revoke(&id);
    StatusCode::NO_CONTENT
}

async fn revoke_other_sessions(AxumState(state): AxumState<AppState>) -> StatusCode {
    // Desktop mode: single user, revoke all sessions.
    state.sessions.revoke_all();
    StatusCode::NO_CONTENT
}

async fn get_token(AxumState(state): AxumState<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    Json(serde_json::json!({ "token": *token }))
}

async fn token_configured(AxumState(state): AxumState<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    Json(serde_json::json!({
        "configured": !token.is_empty(),
        "server_mode": false,
    }))
}

async fn auto_token(
    AxumState(state): AxumState<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    if !addr.ip().is_loopback() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "auto-token is only available from localhost"})),
        )
            .into_response();
    }
    let token = state.auth_token.read().await;
    if token.is_empty() {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no token"})))
            .into_response();
    }
    Json(serde_json::json!({ "token": *token })).into_response()
}

#[derive(serde::Deserialize)]
struct UpdateTokenRequest {
    token: String,
}

async fn update_token(
    AxumState(state): AxumState<AppState>,
    Json(body): Json<UpdateTokenRequest>,
) -> impl IntoResponse {
    let new_token = body.token.trim().to_string();
    if new_token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "token cannot be empty"})),
        )
            .into_response();
    }
    *state.auth_token.write().await = new_token.clone();
    if let Err(e) = settings::save_token(&new_token) {
        tracing::error!("Failed to persist token: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "failed to save"})),
        )
            .into_response();
    }
    StatusCode::OK.into_response()
}

pub fn bind_listener(port: u16) -> std::io::Result<std::net::TcpListener> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = std::net::TcpListener::bind(addr)?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

struct NotifyPortGuard {
    manager: Arc<SessionManager>,
}

impl Drop for NotifyPortGuard {
    fn drop(&mut self) {
        self.manager.set_notify_port(0);
    }
}

struct PluginProcessGuard(Arc<PluginManager>);

impl Drop for PluginProcessGuard {
    fn drop(&mut self) {
        self.0.request_shutdown_all();
    }
}

pub fn run_server(
    listener: std::net::TcpListener,
    manager: Arc<SessionManager>,
) -> impl std::future::Future<Output = ()> {
    // Guard is created synchronously and moved into the returned future, so notify_port
    // resets to 0 on ANY termination of the future — normal exit, panic, task abort, or a
    // drop before the first poll.
    let port_guard = NotifyPortGuard { manager: Arc::clone(&manager) };
    async move {
        let _port_guard = port_guard;
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(e) => {
                tracing::error!(
                    "Failed to register embedded server listener: {}; notifications disabled",
                    e
                );
                return;
            }
        };
        let local_port = listener.local_addr().expect("bound listener").port();
        auth::set_session_cookie_port(local_port);
        manager.set_notify_port(local_port);
        let monitor_state = MonitorState::new(Arc::clone(&manager.sync_clients));
        monitor_state.clone().start_collector();

        let notifier = Arc::new(NotificationBroadcast::new(Arc::clone(&manager.sync_clients)));
        let settings_state = settings::create_settings_state();
        notifier.set_settings(settings_state.clone());
        // Registering the notifier is independent of starting the reaper: a bind failure or
        // startup-ordering issue here must never suppress the detached-session reaper itself
        // (mirrors src/main.rs server wiring).
        manager.register_notifier(Arc::clone(&notifier));
        {
            let notifier = Arc::clone(&notifier);
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(notification::SWEEP_INTERVAL);
                interval.tick().await;
                loop {
                    interval.tick().await;
                    notifier.sweep(notification::now_ms());
                }
            });
        }
        let history_state = HistoryState::new(Arc::clone(&manager.sync_clients));
        let git_info = read_git_info();
        let plugins = Arc::new(PluginManager::new(
            format!("http://127.0.0.1:{local_port}"),
            "desktop".into(),
        ));
        plugins.scan();
        let _plugin_process_guard = PluginProcessGuard(Arc::clone(&plugins));

        let initial_token = settings::load_token()
            .or_else(|| std::env::var("DINOTTY_TOKEN").ok())
            .unwrap_or_default();
        let initial_token = if initial_token.is_empty() {
            let token = generate_random_token();
            if let Err(e) = settings::save_token(&token) {
                tracing::error!("Failed to persist auto-generated token: {}", e);
            }
            tracing::info!("Desktop mode: auto-generated auth token");
            token
        } else {
            tracing::info!("Auth token loaded (length={})", initial_token.len());
            initial_token
        };
        let auth_token = Arc::new(tokio::sync::RwLock::new(initial_token));

        let session_ttl_days = settings::load_settings().auth.session_ttl_days;
        let sessions = Arc::new(SessionStore::new(session_ttl_days));
        sessions.clone().start_cleanup_task();

        let workspaces_state = workspace_mgmt::create_workspaces_state();

        let state = AppState {
            manager: manager.clone(),
            settings: settings_state,
            file_watcher: Arc::new(FileWatcherState::new()),
            monitor: monitor_state,
            notifier,
            history: history_state,
            auth_token,
            plugins,
            port: local_port,
            git_info,
            sessions,
            workspaces: workspaces_state,
        };

        state.plugins.watch_changes(manager);

        let app = Router::new()
            .route("/ws", get(ws::ws_handler))
            .route("/ws/sync", get(ws::sync_handler))
            .route("/ws/watch", get(file_watcher::watch_handler))
            // Tab/Pane management
            .route("/api/tabs", get(tabs::list_tabs).post(tabs::create_tab))
            // SSH tab routes (must be before :tab_id routes)
            .route("/api/tabs/ssh/quick", post(tabs::create_ssh_quick_tab))
            .route("/api/tabs/ssh", post(tabs::create_ssh_tab))
            .route("/api/tabs/:tab_id", delete(tabs::close_tab))
            .route("/api/tabs/:tab_id/pane", post(tabs::split_pane))
            .route("/api/tabs/:tab_id/pane/plugin", post(tabs::create_plugin_pane))
            .route("/api/tabs/:tab_id/pane/files", post(tabs::create_files_pane))
            .route("/api/tabs/:tab_id/pane/web", post(tabs::create_web_pane))
            .route("/api/tabs/:tab_id/pane/move", post(tabs::move_pane))
            .route("/api/tabs/extract", post(tabs::extract_pane))
            .route("/api/tabs/plugin", post(tabs::create_plugin_tab))
            .route("/api/tabs/:tab_id/pane/:pane_id", delete(tabs::close_pane))
            .route("/api/tabs/:tab_id/pane/:pane_id/activate", put(tabs::activate_pane))
            .route("/api/tabs/:tab_id/layout", put(tabs::update_layout))
            .route("/api/input", post(ws::post_input))
            .route("/api/settings", get(settings::get_settings).put(settings::put_settings))
            .route("/api/clipboard", get(clipboard::get_clipboard))
            .route(
                "/api/settings/background",
                post(settings::upload_background).get(settings::get_background),
            )
            .route("/api/log", get(settings::get_log))
            .route(
                "/api/templates",
                get(templates::list_templates).post(templates::create_template),
            )
            .route("/api/templates/apply", post(templates::apply_template))
            .route(
                "/api/templates/:id",
                get(templates::get_template)
                    .put(templates::update_template)
                    .delete(templates::delete_template),
            )
            .route("/api/workspace/resolve", get(workspace::workspace_resolve))
            .route("/api/workspace/list", get(workspace::workspace_list))
            .route("/api/workspace/meta", get(workspace::workspace_meta))
            .route("/api/workspace/raw", get(workspace::workspace_raw))
            .route("/api/workspace/upload", post(workspace::workspace_upload))
            .merge(
                Router::new()
                    .route(
                        "/api/uploads",
                        post(workspace::workspace_uploads).get(workspace::uploads_status),
                    )
                    .layer(axum::extract::DefaultBodyLimit::max(2 * 1024 * 1024 * 1024)),
            )
            .route("/api/uploads/clear", post(workspace::uploads_clear))
            .route("/api/uploads/adopt", post(workspace::uploads_adopt))
            .route("/api/uploads/default-dir", get(workspace::uploads_default_dir))
            .route("/api/workspace/create", post(workspace::workspace_create_entry))
            .route("/api/workspace/file", put(workspace::workspace_put_file))
            .route("/api/workspace/delete", delete(workspace::workspace_delete))
            .route("/api/workspace/rename", post(workspace::workspace_rename))
            .route("/api/workspace/move", post(workspace::workspace_move))
            .route("/api/workspace/git-status", get(workspace::workspace_git_status))
            .route("/api/workspace/git-diff", get(workspace::workspace_git_diff))
            .route("/api/workspace/git-stage-lines", post(workspace::workspace_git_stage_lines))
            .route("/api/workspace/git-revert-lines", post(workspace::workspace_git_revert_lines))
            .route("/api/workspace/syntax-check", post(workspace::workspace_syntax_check))
            // Workspace management
            .route(
                "/api/workspaces",
                get(workspace_mgmt::list_workspaces).post(workspace_mgmt::create_workspace),
            )
            .route("/api/workspaces/reorder", put(workspace_mgmt::reorder_workspaces))
            .route(
                "/api/workspaces/:id",
                put(workspace_mgmt::update_workspace).delete(workspace_mgmt::delete_workspace),
            )
            .route("/api/workspaces/:id/activate", put(workspace_mgmt::activate_workspace))
            .route("/api/workspaces/active", delete(workspace_mgmt::deactivate_workspace))
            .route("/api/notify", post(notification::post_notify))
            .route("/api/events/emit", post(events::emit_event))
            .route("/api/history", get(history::get_history).delete(history::delete_history))
            .route("/api/info", get(server_info))
            .route("/api/auth", post(check_auth))
            .route("/api/auth/check", get(check_auth_session))
            .route("/api/auth/logout", post(logout))
            .route("/api/auth/sessions", get(list_sessions_handler).delete(revoke_other_sessions))
            .route("/api/auth/sessions/:id", delete(revoke_session_handler))
            .route("/api/token-configured", get(token_configured))
            .route("/api/auto-token", get(auto_token))
            .route("/api/token", get(get_token).put(update_token))
            .route("/api/plugins", get(plugin::list_plugins))
            .route("/api/plugins/market", get(plugin::get_market_registry))
            .route("/api/plugins/market/:id/readme", get(plugin::get_market_readme))
            .route("/api/plugins/dev-link", post(plugin::dev_link_plugin))
            .route("/api/plugins/install-dir", post(plugin::install_from_dir))
            .merge(
                Router::new()
                    .route("/api/plugins/install", post(plugin::install_plugin))
                    .route("/api/plugins/install-git", post(plugin::install_from_git))
                    .route("/api/plugins/:id/update", post(plugin::update_plugin))
                    .layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024)),
            )
            .route("/api/plugins/:id", get(plugin::plugin_detail).delete(plugin::delete_plugin))
            .route("/api/plugins/:id/exec", post(plugin::plugin_exec))
            .route("/api/plugins/:id/spawn", get(plugin::plugin_spawn_ws))
            .route("/api/plugins/:id/process/start", post(plugin::plugin_process_start))
            .route(
                "/api/plugins/:id/process",
                get(plugin::plugin_process_list).delete(plugin::plugin_process_stop_all),
            )
            .route("/api/plugins/:id/process/:pid", delete(plugin::plugin_process_stop))
            .route("/api/plugins/:id/storage", get(plugin::plugin_storage_list))
            .route(
                "/api/plugins/:id/storage/:key",
                get(plugin::plugin_storage_get)
                    .put(plugin::plugin_storage_set)
                    .delete(plugin::plugin_storage_delete),
            )
            .route("/api/plugins/:id/crypto/hash", post(plugin::plugin_crypto_hash))
            .route("/api/plugins/:id/crypto/hmac", post(plugin::plugin_crypto_hmac))
            .route("/api/plugins/:id/*path", get(plugin::plugin_asset))
            .route("/api/proxy", any(proxy::external_proxy_handler))
            .route("/preview/:port", any(proxy::proxy_handler_root))
            .route("/preview/:port/", any(proxy::proxy_handler_root))
            .route("/preview/:port/*path", any(proxy::proxy_handler_wildcard))
            .route("/assets/*path", get(static_handler))
            .route("/icons/*path", get(icon_handler))
            .route("/manifest.json", get(manifest_handler))
            .route(
                "/logo.png",
                get(|| async {
                    match StaticFiles::get("logo.png") {
                        Some(content) => Response::builder()
                            .header(header::CONTENT_TYPE, "image/png")
                            .header(header::CACHE_CONTROL, "public, max-age=86400")
                            .body(Body::from(content.data.into_owned()))
                            .unwrap(),
                        None => Response::builder()
                            .status(StatusCode::NOT_FOUND)
                            .body(Body::from("not found"))
                            .unwrap(),
                    }
                }),
            )
            .route("/", get(index))
            .layer(middleware::from_fn_with_state(
                state.clone(),
                |AxumState(s): AxumState<AppState>,
                 req: axum::extract::Request,
                 next: middleware::Next| async move {
                    let token = s.auth_token.read().await.clone();
                    let client_ip = req
                        .extensions()
                        .get::<axum::extract::ConnectInfo<SocketAddr>>()
                        .map(|ci| ci.ip())
                        .unwrap_or_else(|| "127.0.0.1".parse().unwrap());
                    auth::auth_middleware(
                        req,
                        next,
                        &token,
                        &s.settings,
                        &s.sessions,
                        client_ip,
                        s.port,
                    )
                    .await
                },
            ))
            .layer(middleware::from_fn(
                |req: axum::extract::Request, next: middleware::Next| async move {
                    let is_clipboard = req.uri().path() == "/api/clipboard";
                    let origin = req
                        .headers()
                        .get(header::ORIGIN)
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string());
                    let is_preflight = req.method() == axum::http::Method::OPTIONS;
                    let mut response = if is_preflight {
                        Response::new(Body::empty())
                    } else {
                        next.run(req).await
                    };
                    if is_clipboard {
                        if is_preflight {
                            *response.status_mut() = StatusCode::NO_CONTENT;
                        }
                        response.headers_mut().insert(
                            header::CACHE_CONTROL,
                            axum::http::HeaderValue::from_static("no-store"),
                        );
                    }
                    if let Some(origin) = origin
                        .filter(|_| !(is_clipboard && response.status() == StatusCode::FORBIDDEN))
                    {
                        let headers = response.headers_mut();
                        headers.insert(
                            header::ACCESS_CONTROL_ALLOW_ORIGIN,
                            axum::http::HeaderValue::from_str(&origin).unwrap(),
                        );
                        headers.insert(
                            header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
                            axum::http::HeaderValue::from_static("true"),
                        );
                        headers.insert(
                            header::ACCESS_CONTROL_ALLOW_METHODS,
                            axum::http::HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS"),
                        );
                        headers.insert(
                            header::ACCESS_CONTROL_ALLOW_HEADERS,
                            axum::http::HeaderValue::from_static("Content-Type, Authorization"),
                        );
                    }
                    response
                },
            ))
            .with_state(state);

        tracing::info!("Embedded server listening on http://0.0.0.0:{}", local_port);
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    }
}

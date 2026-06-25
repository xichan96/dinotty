use axum::extract::State as AxumState;
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
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use dinotty_server::auth;
use dinotty_server::file_watcher::{self, FileWatcherState};
use dinotty_server::history;
use dinotty_server::history::HistoryState;
use dinotty_server::monitor::{self, MonitorState};
use dinotty_server::notification::{self, NotificationBroadcast};
use dinotty_server::plugin::{self, PluginManager, PluginManagerState};
use dinotty_server::proxy;
use dinotty_server::qr_code;
use dinotty_server::session::SessionManager;
use dinotty_server::settings;
use dinotty_server::tabs;
use dinotty_server::workspace;
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
    pub qr_codes: Arc<qr_code::QrCodeState>,
}

impl axum::extract::FromRef<AppState> for Arc<SessionManager> {
    fn from_ref(state: &AppState) -> Self {
        state.manager.clone()
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

impl axum::extract::FromRef<AppState> for Arc<qr_code::QrCodeState> {
    fn from_ref(state: &AppState) -> Self {
        state.qr_codes.clone()
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

async fn index(
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    AxumState(state): AxumState<AppState>,
) -> impl IntoResponse {
    let content = StaticFiles::get("index.html").expect("index.html must exist in frontend/dist/");
    let html = String::from_utf8_lossy(&content.data);

    let stored_token = state.auth_token.read().await.clone();

    // Accept either ?code=xxx (one-time QR code) or ?token=xxx (direct token)
    let token_value = if let Some(code) = params.get("code") {
        state.qr_codes.consume(code).unwrap_or_default()
    } else {
        params
            .get("token")
            .filter(|t| urlencoding::decode(t).map(|d| d == stored_token).unwrap_or(false))
            .map(|_| stored_token)
            .unwrap_or_default()
    };

    let tag = format!("<meta name=\"auth-token\" content=\"{}\">\n</head>", token_value);
    let html = html.replace("</head>", &tag);
    (
        [(header::CACHE_CONTROL, axum::http::HeaderValue::from_static("no-store"))],
        axum::response::Html(html),
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

fn read_git_info() -> GitInfo {
    let version = option_env!("DINOTTY_VERSION").unwrap_or(env!("CARGO_PKG_VERSION")).to_string();

    let repo_url = std::process::Command::new("git")
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
        .unwrap_or_else(|| env!("CARGO_PKG_REPOSITORY").to_string());

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

async fn check_auth(AxumState(_state): AxumState<AppState>) -> StatusCode {
    StatusCode::OK
}

async fn get_token(AxumState(state): AxumState<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    Json(serde_json::json!({ "token": *token }))
}

async fn token_configured(AxumState(state): AxumState<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    Json(serde_json::json!({ "configured": !token.is_empty() }))
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

async fn generate_qr_code(AxumState(state): AxumState<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    if token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "no token configured"})),
        )
            .into_response();
    }
    let code = state.qr_codes.generate(&token);
    Json(serde_json::json!({ "code": code })).into_response()
}

pub async fn run_server(port: u16, manager: Arc<SessionManager>) {
    let monitor_state = MonitorState::new();
    monitor_state.clone().start_collector();

    let notifier = Arc::new(NotificationBroadcast::new());
    let settings_state = settings::create_settings_state();
    notifier.set_settings(settings_state.clone());
    let history_state = HistoryState::new();
    let plugins = Arc::new(PluginManager::new());
    plugins.scan();

    let initial_token =
        settings::load_token().or_else(|| std::env::var("DINOTTY_TOKEN").ok()).unwrap_or_default();
    if initial_token.is_empty() {
        tracing::info!("No auth token configured — first-time setup required");
    } else {
        tracing::info!("Auth token loaded (length={})", initial_token.len());
    }
    let auth_token = Arc::new(tokio::sync::RwLock::new(initial_token));

    let git_info = read_git_info();
    let qr_codes = Arc::new(qr_code::QrCodeState::new());
    qr_codes.clone().start_cleanup_task();

    let state = AppState {
        manager: manager.clone(),
        settings: settings_state,
        file_watcher: Arc::new(FileWatcherState::new()),
        monitor: monitor_state,
        notifier,
        history: history_state,
        auth_token,
        plugins,
        port,
        git_info,
        qr_codes,
    };

    state.plugins.watch_changes(manager);

    let app = Router::new()
        .route("/ws", get(ws::ws_handler))
        .route("/ws/sync", get(ws::sync_handler))
        .route("/ws/watch", get(file_watcher::watch_handler))
        .route("/ws/monitor", get(monitor::ws_monitor_handler))
        .route("/ws/notify", get(ws::notification_ws_handler))
        .route("/ws/history", get(history::ws_history_handler))
        // Tab/Pane management
        .route("/api/tabs", get(tabs::list_tabs).post(tabs::create_tab))
        .route("/api/tabs/:tab_id", delete(tabs::close_tab))
        .route("/api/tabs/:tab_id/pane", post(tabs::split_pane))
        .route("/api/tabs/:tab_id/pane/:pane_id", delete(tabs::close_pane))
        .route("/api/tabs/:tab_id/pane/:pane_id/activate", put(tabs::activate_pane))
        .route("/api/tabs/:tab_id/layout", put(tabs::update_layout))
        .route("/api/input", post(ws::post_input))
        .route("/api/settings", get(settings::get_settings).put(settings::put_settings))
        .route(
            "/api/settings/background",
            post(settings::upload_background).get(settings::get_background),
        )
        .route("/api/workspace/resolve", get(workspace::workspace_resolve))
        .route("/api/workspace/list", get(workspace::workspace_list))
        .route("/api/workspace/meta", get(workspace::workspace_meta))
        .route("/api/workspace/raw", get(workspace::workspace_raw))
        .route("/api/workspace/upload", post(workspace::workspace_upload))
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
        .route("/api/notify", post(notification::post_notify))
        .route("/api/history", get(history::get_history).delete(history::delete_history))
        .route("/api/info", get(server_info))
        .route("/api/auth", post(check_auth))
        .route("/api/token-configured", get(token_configured))
        .route("/api/token", get(get_token).put(update_token))
        .route("/api/qr-code", post(generate_qr_code))
        .route("/api/plugins", get(plugin::list_plugins))
        .route("/api/plugins/market", get(plugin::get_market_registry))
        .route("/api/plugins/market/:id/readme", get(plugin::get_market_readme))
        .route("/api/plugins/dev-link", post(plugin::dev_link_plugin))
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
                auth::auth_middleware(req, next, &token, &s.settings, client_ip).await
            },
        ))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Embedded server listening on http://0.0.0.0:{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
}

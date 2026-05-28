use dinotty_server::{auth, session, settings, ws, proxy, workspace, file_watcher, monitor, notification, history, plugin};

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderValue, Response, StatusCode},
    middleware,
    response::{Html, IntoResponse},
    Json, Router,
    routing::{any, delete, get, post, put},
};
use rust_embed::Embed;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::session::SessionManager;
use crate::settings::SettingsState;
use crate::file_watcher::FileWatcherState;
use crate::monitor::MonitorState;
use crate::notification::NotificationBroadcast;
use crate::history::HistoryState;
use crate::plugin::PluginManagerState;

async fn index(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let content = StaticFiles::get("index.html")
        .expect("index.html must exist in frontend/dist/");
    let html = String::from_utf8_lossy(&content.data);

    // Only embed token if ?token=xxx matches the server token
    let token_value = params.get("token")
        .filter(|t| {
            urlencoding::decode(t).map(|d| &*d == &*state.auth_token).unwrap_or(false)
        })
        .map(|_| state.auth_token.to_string())
        .unwrap_or_default();

    let tag = format!(
        "<meta name=\"auth-token\" content=\"{}\">\n</head>",
        token_value
    );
    let html = html.replace("</head>", &tag);
    (
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Html(html),
    )
}

#[derive(Embed)]
#[folder = "frontend/dist/"]
pub struct StaticFiles;

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<SessionManager>,
    pub settings: SettingsState,
    pub file_watcher: Arc<FileWatcherState>,
    pub monitor: MonitorState,
    pub notifier: Arc<NotificationBroadcast>,
    pub history: HistoryState,
    pub auth_token: Arc<String>,
    pub port: u16,
    pub plugins: PluginManagerState,
}

// Allow extracting Arc<SessionManager> from AppState for ws handlers
impl axum::extract::FromRef<AppState> for Arc<SessionManager> {
    fn from_ref(state: &AppState) -> Self {
        state.manager.clone()
    }
}

// Allow extracting (Arc<SessionManager>, SettingsState) for settings handlers
impl axum::extract::FromRef<AppState> for (Arc<SessionManager>, SettingsState) {
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.settings.clone())
    }
}

// Allow extracting (Arc<SessionManager>, Arc<FileWatcherState>) for file watcher handlers
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
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("not found"))
            .unwrap(),
    }
}

async fn manifest_handler() -> impl IntoResponse {
    match StaticFiles::get("manifest.json") {
        Some(content) => {
            Response::builder()
                .header(header::CONTENT_TYPE, "application/manifest+json")
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("not found"))
            .unwrap(),
    }
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
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("not found"))
            .unwrap(),
    }
}

fn parse_port() -> u16 {
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--port" | "-p" => {
                if let Some(v) = args.get(i + 1) {
                    return v.parse().expect("invalid port number");
                }
            }
            s if s.starts_with("--port=") => {
                return s[7..].parse().expect("invalid port number");
            }
            _ => {}
        }
        i += 1;
    }
    8999
}

async fn server_info(State(state): State<AppState>) -> Json<serde_json::Value> {
    let lan_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());
    Json(serde_json::json!({
        "lan_ip": lan_ip,
        "port": state.port,
    }))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let port = parse_port();
    let manager = Arc::new(SessionManager::new());
    manager.start_cleanup_task();

    let auth_token = if let Ok(t) = std::env::var("DINOTTY_TOKEN") {
        Arc::new(t)
    } else {
        let mut buf = [0u8; 32];
        rand::fill(&mut buf);
        let token: String = buf.iter().map(|b| format!("{:02x}", b)).collect();
        Arc::new(token)
    };
    tracing::info!("Auth token: {}", &*auth_token);

    let monitor_state = MonitorState::new();
    monitor_state.clone().start_collector();

    let notifier = Arc::new(NotificationBroadcast::new());
    let settings_state = settings::create_settings_state();
    notifier.set_settings(settings_state.clone());
    let history_state = HistoryState::new();

    let plugins = Arc::new(plugin::PluginManager::new());
    plugins.scan();
    tracing::info!("Loaded {} plugins", plugins.list().len());

    let state = AppState {
        manager,
        settings: settings_state,
        file_watcher: Arc::new(FileWatcherState::new()),
        monitor: monitor_state,
        notifier,
        history: history_state,
        auth_token: auth_token.clone(),
        port,
        plugins,
    };

    state.plugins.watch_changes(state.manager.clone());

    let app = Router::new()
        .route("/ws", get(ws::ws_handler))
        .route("/ws/sync", get(ws::sync_handler))
        .route("/ws/watch", get(file_watcher::watch_handler))
        .route("/ws/monitor", get(monitor::ws_monitor_handler))
        .route("/ws/notify", get(ws::notification_ws_handler))
        .route("/api/notify", post(notification::post_notify))
        .route("/api/input", post(ws::post_input))
        .route("/api/settings", get(settings::get_settings).put(settings::put_settings))
        .route("/api/settings/background", post(settings::upload_background).get(settings::get_background))
        .route("/api/workspace/resolve", get(workspace::workspace_resolve))
        .route("/api/workspace/list", get(workspace::workspace_list))
        .route("/api/workspace/meta", get(workspace::workspace_meta))
        .route("/api/workspace/raw", get(workspace::workspace_raw))
        .merge(
            Router::new()
                .route("/api/workspace/upload", post(workspace::workspace_upload))
                .layer(axum::extract::DefaultBodyLimit::max(512 * 1024 * 1024))
        )
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
        .route("/ws/history", get(history::ws_history_handler))
        .route("/api/history", get(history::get_history).delete(history::delete_history))
        .route("/api/proxy", any(proxy::external_proxy_handler))
        .route("/api/info", get(server_info))
        // Plugin management
        .route("/api/plugins", get(plugin::list_plugins))
        .route("/api/plugins/dev-link", post(plugin::dev_link_plugin))
        .merge(
            Router::new()
                .route("/api/plugins/install", post(plugin::install_plugin))
                .route("/api/plugins/:id/update", post(plugin::update_plugin))
                .layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024))
        )
        .route("/api/plugins/:id", get(plugin::plugin_detail).delete(plugin::delete_plugin))
        .route("/api/plugins/:id/exec", post(plugin::plugin_exec))
        .route("/api/plugins/:id/spawn", get(plugin::plugin_spawn_ws))
        .route("/api/plugins/:id/storage", get(plugin::plugin_storage_list))
        .route("/api/plugins/:id/storage/:key",
            get(plugin::plugin_storage_get)
                .put(plugin::plugin_storage_set)
                .delete(plugin::plugin_storage_delete))
        .route("/api/plugins/:id/*path", get(plugin::plugin_asset))
        .route("/preview/:port", any(proxy::proxy_handler_root))
        .route("/preview/:port/", any(proxy::proxy_handler_root))
        .route("/preview/:port/*path", any(proxy::proxy_handler_wildcard))
        .route("/assets/*path", get(static_handler))
        .route("/icons/*path", get(icon_handler))
        .route("/manifest.json", get(manifest_handler))
        .route("/logo.png", get(|| async {
            match StaticFiles::get("logo.png") {
                Some(content) => {
                    Response::builder()
                        .header(header::CONTENT_TYPE, "image/png")
                        .header(header::CACHE_CONTROL, "public, max-age=86400")
                        .body(Body::from(content.data.into_owned()))
                        .unwrap()
                }
                None => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Body::from("not found"))
                    .unwrap(),
            }
        }))
        .route("/", get(index))
        .layer(middleware::from_fn(move |req, next| {
            let token = auth_token.clone();
            async move { auth::auth_middleware(req, next, &token).await }
        }))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Listening on http://0.0.0.0:{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

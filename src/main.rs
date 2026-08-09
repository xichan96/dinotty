#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]

use dinotty_server::{
    agent, api::clipboard, audit, auth, event_bus, events, file_watcher, history, mcp,
    mission_control, monitor, notification, openapi, plugin, proxy, session, settings, tabs,
    templates, token, update_check, webhook, workspace, workspace_mgmt, ws,
};

use axum::{
    body::Body,
    extract::{ConnectInfo, Path, State},
    http::{header, HeaderValue, Response, StatusCode},
    middleware,
    response::{Html, IntoResponse},
    routing::{any, delete, get, post, put},
    Json, Router,
};
use rust_embed::Embed;
use std::net::SocketAddr;

use std::sync::Arc;

use crate::auth::session::SessionStore;
use crate::auth::verification_code::CodeStore;
use crate::file_watcher::FileWatcherState;
use crate::history::HistoryState;
use crate::monitor::MonitorState;
use crate::notification::NotificationBroadcast;
use crate::session::SessionManager;

mod app_state;
use app_state::AppState;

mod auth_handlers;
use auth_handlers::{
    auto_token, check_auth, get_token, list_sessions, login, logout, put_settings_with_session_ttl,
    request_code, revoke_other_sessions, revoke_session, token_configured, update_token,
};

/// Dynamic CORS middleware that reads `allowed_origins` from settings on each request.
/// Default empty = same-origin only (Origin = Host, which browsers allow without CORS).
/// Tauri desktop mode does not go through CORS (`tauri_fetch` is not a browser fetch).
async fn dynamic_cors_middleware(
    State(state): State<AppState>,
    req: axum::extract::Request,
    next: middleware::Next,
) -> Response<Body> {
    let origin =
        req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()).map(str::to_string);
    let is_clipboard = req.uri().path() == "/api/clipboard";

    let allowed_origins = {
        let s = state.settings.read().await;
        s.auth.allowed_origins.clone()
    };

    let is_preflight = req.method() == axum::http::Method::OPTIONS;

    // Determine if origin is allowed
    let allowed_origin = origin.as_ref().and_then(|o| {
        if allowed_origins.iter().any(|a| a.trim() == o) {
            Some(o.clone())
        } else {
            None
        }
    });

    let mut response = if is_preflight {
        // For preflight, return 204 without calling the next handler
        Response::builder().status(StatusCode::NO_CONTENT).body(Body::empty()).unwrap()
    } else {
        next.run(req).await
    };

    let suppress_clipboard_origin = is_clipboard && response.status() == StatusCode::FORBIDDEN;
    let headers = response.headers_mut();
    if is_clipboard {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    if let Some(ref ao) = allowed_origin.filter(|_| !suppress_clipboard_origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, ao.parse().unwrap());
        headers.insert(header::ACCESS_CONTROL_ALLOW_CREDENTIALS, HeaderValue::from_static("true"));
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("Content-Type, Authorization"),
        );
    }

    response
}

async fn index(State(_state): State<AppState>) -> impl IntoResponse {
    let content = StaticFiles::get("index.html").expect("index.html must exist in frontend/dist/");
    let html = String::from_utf8_lossy(&content.data).into_owned();
    ([(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))], Html(html))
}

#[derive(Embed)]
#[folder = "frontend/dist/"]
pub struct StaticFiles;

#[derive(Clone, serde::Serialize)]
pub struct GitInfo {
    pub version: String,
    pub repo_url: String,
}

fn read_git_info() -> GitInfo {
    GitInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        repo_url: env!("CARGO_PKG_REPOSITORY").to_string(),
    }
}

async fn static_handler(Path(path): Path<String>) -> impl IntoResponse {
    let lookup = format!("assets/{path}");
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

async fn manifest_handler() -> impl IntoResponse {
    match StaticFiles::get("manifest.json") {
        Some(content) => Response::builder()
            .header(header::CONTENT_TYPE, "application/manifest+json")
            .body(Body::from(content.data.into_owned()))
            .unwrap(),
        None => {
            Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("not found")).unwrap()
        }
    }
}

async fn icon_handler(Path(path): Path<String>) -> impl IntoResponse {
    let lookup = format!("icons/{path}");
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

fn default_port() -> u16 {
    option_env!("DINOTTY_DEFAULT_PORT").and_then(|s| s.parse().ok()).unwrap_or(8999)
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
    default_port()
}

async fn server_info(State(state): State<AppState>) -> Json<serde_json::Value> {
    let lan_ip =
        local_ip_address::local_ip().map_or_else(|_| "127.0.0.1".to_string(), |ip| ip.to_string());
    Json(serde_json::json!({
        "lan_ip": lan_ip,
        "port": state.port,
        "version": state.git_info.version,
        "repo_url": state.git_info.repo_url,
    }))
}

#[tokio::main]
async fn main() {
    let _guard = settings::init_logging();

    let addr = SocketAddr::from(([0, 0, 0, 0], parse_port()));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    let port = listener.local_addr().expect("bound listener").port();
    auth::set_session_cookie_port(port);
    let manager = Arc::new(SessionManager::new());
    session::ledger::boot_sweep();

    let monitor_state = MonitorState::new(Arc::clone(&manager.sync_clients));
    monitor_state.clone().start_collector();

    let notifier = Arc::new(NotificationBroadcast::new(
        Arc::clone(&manager.sync_clients),
        manager.event_bus.clone(),
    ));
    let settings_state = settings::create_settings_state();
    notifier.set_settings(settings_state.clone());

    // Restore tabs/panes from the last session (if enabled in settings).
    // Done before `start_cleanup_task` so the reaper never sees restoring
    // sessions as unowned (it has a 60s grace anyway, but this is cleaner).
    {
        let restore_enabled = settings_state.read().await.restore_session_on_startup;
        if restore_enabled {
            let snapshot = session::SessionSnapshotStore::new().load();
            if !snapshot.tabs.is_empty() {
                tracing::info!("Restoring session: {} tabs in snapshot", snapshot.tabs.len());
                session::restore_session(&manager, &snapshot).await;
            }
        }
    }
    // Start the snapshot debounce task after restore so restore-time layout
    // commits don't trigger a redundant write.
    manager.start_snapshot_task();

    manager.register_notifier(Arc::clone(&notifier));
    manager.start_cleanup_task();
    manager.start_event_bridge();
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

    // Load token from dedicated file or env var; empty means first-time setup
    let initial_token =
        settings::load_token().or_else(|| std::env::var("DINOTTY_TOKEN").ok()).unwrap_or_default();
    let initial_token = if initial_token.is_empty() {
        if cfg!(feature = "server") {
            tracing::info!("No auth token configured — first-time setup required");
            String::new()
        } else {
            let token = generate_random_token();
            if let Err(e) = settings::save_token(&token) {
                tracing::error!("Failed to persist auto-generated token: {}", e);
            }
            tracing::info!("Desktop mode: auto-generated auth token");
            token
        }
    } else {
        tracing::info!("Auth token loaded (length={})", initial_token.len());
        initial_token
    };
    let auth_token = Arc::new(tokio::sync::RwLock::new(initial_token));

    let git_info = read_git_info();
    tracing::info!("Git info: {}", git_info.version);

    let plugins =
        Arc::new(plugin::PluginManager::new(format!("http://127.0.0.1:{port}"), "server".into()));
    plugins.scan();
    tracing::info!("Loaded {} plugins", plugins.list().len());

    // Initialize new modules
    let tokens = Arc::new(token::TokenManager::new(auth_token.clone()));
    tokens.start_cleanup_task();

    let audit_logger = Arc::new(audit::AuditLogger::new());

    let agent_state = agent::AgentState {
        manager: manager.clone(),
        settings: settings_state.clone(),
        tokens: tokens.clone(),
        audit: audit_logger.clone(),
        run_limiter: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
    };

    // Load webhook configs from settings
    let webhook_configs = {
        // Webhook configs will be added to settings later; for now empty
        Vec::<webhook::WebhookConfig>::new()
    };
    let webhooks = Arc::new(webhook::WebhookDispatcher::new(webhook_configs));
    webhooks.start(&manager.event_bus);

    let mcp_server = Arc::new(mcp::server::McpServer::new(manager.clone(), settings_state.clone()));
    let mcp_sse = Arc::new(mcp::transport::SseState::new());
    let workspaces_state = workspace_mgmt::create_workspaces_state();
    let mc_state = mission_control::create_mission_control_state();
    // Sync MC's selected_workspace_id to active_workspace_id so the overview
    // highlights the workspace the user is landing in.
    {
        let active_ws = settings_state.read().await.active_workspace_id.clone();
        mc_state.write().await.selected_workspace_id = active_ws;
    }

    let session_ttl_days = settings::load_settings().auth.session_ttl_days;
    let sessions = Arc::new(SessionStore::new(session_ttl_days));
    sessions.clone().start_cleanup_task();

    let (verification_code_ttl, verification_code_rate_limit) = {
        let s = settings::load_settings();
        (s.auth.verification_code_ttl_seconds, s.auth.verification_code_rate_limit_per_minute)
    };
    let code_store = Arc::new(CodeStore::new(verification_code_ttl, verification_code_rate_limit));
    code_store.clone().start_cleanup_task();

    let file_watcher_event_bus = manager.event_bus.clone();
    let state = AppState {
        manager: Arc::clone(&manager),
        settings: settings_state,
        shell_probe: Arc::new(dinotty_server::platform::shell_probe::ShellProbeService::new()),
        file_watcher: Arc::new(FileWatcherState::new(file_watcher_event_bus)),
        monitor: monitor_state,
        notifier,
        history: history_state,
        auth_token: auth_token.clone(),
        port,
        plugins: Arc::clone(&plugins),
        git_info,
        tokens,
        audit: audit_logger,
        agent: agent_state,
        webhooks,
        mcp: mcp_server,
        mcp_sse,
        workspaces: workspaces_state,
        mc: mc_state,
        sessions,
        code_store,
        subscriptions: plugin::SubscriptionRegistry::new(),
        update_checker: update_check::UpdateChecker::new(),
    };

    state.plugins.watch_changes(state.manager.clone());
    let notify_manager = state.manager.clone();

    let app =
        Router::new()
            .route("/ws", get(ws::ws_handler))
            .route("/ws/sync", get(ws::sync_handler))
            .route("/ws/watch", get(file_watcher::watch_handler))
            .route("/ws/plugins/:id/workspace/watch", get(plugin::plugin_workspace_watch))
            .route("/api/notify", post(notification::post_notify))
            .route("/api/events/emit", post(events::emit_event))
            .route("/api/input", post(ws::post_input))
            // Open API - public endpoints (session cookie / global Bearer via outer auth_middleware)
            .route("/api/sessions", get(openapi::list_sessions))
            .route("/api/sessions/:pane_id/screen", get(openapi::get_screen))
            .route("/api/sessions/:pane_id/scrollback", get(openapi::get_scrollback))
            .route("/api/sessions/:pane_id/input", post(openapi::session_input))
            .route("/api/sessions/:pane_id/resize", post(openapi::session_resize))
            // Tab/Pane management
            .route("/api/tabs", get(tabs::list_tabs).post(tabs::create_tab))
            // SSH tab routes (must be before :tab_id routes)
            .route("/api/tabs/ssh/quick", post(tabs::create_ssh_quick_tab))
            .route("/api/tabs/ssh", post(tabs::create_ssh_tab))
            .route("/api/tabs/:tab_id", delete(tabs::close_tab))
            .route("/api/tabs/:tab_id/rename", post(tabs::rename_tab))
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
            .route("/api/auth", post(login))
            .route("/api/auth/request-code", post(request_code))
            .route("/api/auth/check", get(check_auth))
            .route("/api/auth/logout", post(logout))
            .route("/api/auth/sessions", get(list_sessions).delete(revoke_other_sessions))
            .route("/api/auth/sessions/:id", delete(revoke_session))
            .route("/api/token-configured", get(token_configured))
            .route("/api/auto-token", get(auto_token))
            .route("/api/settings", get(settings::get_settings).put(put_settings_with_session_ttl))
            .route("/api/shells", get(dinotty_server::api::shells::get_shells))
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
            .merge(
                Router::new()
                    .route("/api/workspace/upload", post(workspace::workspace_upload))
                    .layer(axum::extract::DefaultBodyLimit::max(512 * 1024 * 1024)),
            )
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
            .route("/api/workspace/reveal", get(workspace::workspace_reveal))
            .route("/api/workspace/cwd", get(workspace::workspace_cwd))
            .route("/api/workspace/git-stage-lines", post(workspace::workspace_git_stage_lines))
            .route("/api/workspace/git-revert-lines", post(workspace::workspace_git_revert_lines))
            .route("/api/workspace/syntax-check", post(workspace::workspace_syntax_check))
            .route("/api/workspace/search", post(workspace::workspace_search))
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
            .route("/api/list-dirs", get(workspace_mgmt::list_dirs))
            .route("/api/history", get(history::get_history).delete(history::delete_history))
            .route("/api/proxy", any(proxy::external_proxy_handler))
            .route("/api/info", get(server_info))
            .route("/api/update-check", get(update_check::get_update_status))
            .route("/api/token", get(get_token).put(update_token))
            // Plugin management
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
            .route("/api/plugins/:id/events/subscribe", post(plugin::subscribe))
            .route("/api/plugins/:id/events/unsubscribe", post(plugin::unsubscribe))
            .route("/api/plugins/events/has-subscriber", get(plugin::has_subscriber))
            .route("/api/plugins/:id/workspace/readDir", get(plugin::plugin_workspace_read_dir))
            .route("/api/plugins/:id/workspace/readFile", get(plugin::plugin_workspace_read_file))
            .route("/api/plugins/:id/workspace/file", put(plugin::plugin_workspace_put_file))
            .route("/api/plugins/:id/workspace/stat", get(plugin::plugin_workspace_stat))
            .route("/api/plugins/:id/workspace/mkdir", post(plugin::plugin_workspace_mkdir))
            .route("/api/plugins/:id/workspace/delete", delete(plugin::plugin_workspace_delete))
            .route("/api/plugins/:id/workspace/rename", post(plugin::plugin_workspace_rename))
            .route("/api/plugins/:id/workspace/move", post(plugin::plugin_workspace_move))
            .route("/api/plugins/:id/*path", get(plugin::plugin_asset))
            // Sessions extended API (run/send/read/events) + Token management + MCP
            // - dual-track auth via sessions_token_middleware
            //   (session cookie / global Bearer -> TokenInfo::global(); agent Bearer -> capability check)
            .merge(
                Router::new()
                    .route("/api/sessions/:pane_id/run", post(agent::sessions_run))
                    .route("/api/sessions/:pane_id/send", post(agent::sessions_send))
                    .route("/api/sessions/:pane_id/read", get(agent::sessions_read))
                    .route("/ws/events", get(agent::events_ws_handler))
                    .route("/api/tokens", post(token::create_token).get(token::list_tokens))
                    .route(
                        "/api/tokens/:id",
                        get(token::get_token_detail)
                            .put(token::update_token)
                            .delete(token::revoke_token),
                    )
                    .route("/mcp/sse", get(mcp::transport::mcp_sse_handler))
                    .route("/mcp/message", post(mcp::transport::mcp_message_handler))
                    .layer(middleware::from_fn_with_state(
                        token::SessionsAuthState {
                            global_token: auth_token.clone(),
                            tokens: state.tokens.clone(),
                        },
                        token::sessions_token_middleware,
                    )),
            )
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
                |State(s): State<AppState>,
                 ConnectInfo(addr): ConnectInfo<SocketAddr>,
                 req,
                 next| async move {
                    let token = s.auth_token.read().await.clone();
                    auth::auth_middleware(
                        req,
                        next,
                        &token,
                        &s.settings,
                        &s.sessions,
                        addr.ip(),
                        s.port,
                    )
                    .await
                },
            ))
            .layer(middleware::from_fn_with_state(state.clone(), dynamic_cors_middleware))
            .with_state(state);

    tracing::info!("Listening on http://0.0.0.0:{}", port);

    notify_manager.set_notify_port(port);
    let shutdown_manager = Arc::clone(&manager);
    let shutdown_plugins = Arc::clone(&plugins);
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            shutdown_plugins.shutdown_all().await;
            // Sync-flush the session snapshot so the most recent layout is
            // persisted without waiting for the 1s debounce window.
            shutdown_manager.flush_snapshot_sync();
        })
        .await
        .unwrap();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
}

use axum::{
    body::Body,
    extract::State as AxumState,
    http::{header, Response, StatusCode},
    middleware,
    routing::{any, delete, get, post, put},
    Router,
};
use std::net::SocketAddr;

use dinotty_server::agent;
use dinotty_server::api::clipboard;
use dinotty_server::auth;
use dinotty_server::events;
use dinotty_server::file_watcher;
use dinotty_server::history;
use dinotty_server::mcp;
use dinotty_server::notification;
use dinotty_server::openapi;
use dinotty_server::plugin;
use dinotty_server::proxy;
use dinotty_server::settings;
use dinotty_server::tabs;
use dinotty_server::templates;
use dinotty_server::token;
use dinotty_server::update_check;
use dinotty_server::workspace;
use dinotty_server::workspace_mgmt;
use dinotty_server::ws;

use super::handlers::{
    auto_token, check_auth, check_auth_session, get_token, list_sessions_handler, logout,
    request_code, revoke_other_sessions, revoke_session_handler, token_configured, update_token,
};
use super::state::AppState;
use super::static_handlers::{icon_handler, index, manifest_handler, server_info, static_handler};
use super::StaticFiles;

pub fn build_router(state: AppState) -> Router {
    Router::new()
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
        // Open API - public endpoints (session cookie / global Bearer via outer auth_middleware)
        .route("/api/sessions", get(openapi::list_sessions))
        .route("/api/sessions/:pane_id/screen", get(openapi::get_screen))
        .route("/api/sessions/:pane_id/scrollback", get(openapi::get_scrollback))
        .route("/api/sessions/:pane_id/input", post(openapi::session_input))
        .route("/api/sessions/:pane_id/resize", post(openapi::session_resize))
        .route("/api/settings", get(settings::get_settings).put(settings::put_settings))
        .route("/api/shells", get(dinotty_server::api::shells::get_shells))
        .route("/api/clipboard", get(clipboard::get_clipboard))
        .route(
            "/api/settings/background",
            post(settings::upload_background).get(settings::get_background),
        )
        .route("/api/log", get(settings::get_log))
        .route("/api/templates", get(templates::list_templates).post(templates::create_template))
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
        .route("/api/update-check", get(update_check::get_update_status))
        .route("/api/auth", post(check_auth))
        .route("/api/auth/request-code", post(request_code))
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
                        global_token: state.auth_token.clone(),
                        tokens: state.tokens.clone(),
                        sessions: state.sessions.clone(),
                    },
                    token::sessions_token_middleware,
                )),
        )
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
                let mut response =
                    if is_preflight { Response::new(Body::empty()) } else { next.run(req).await };
                if is_clipboard {
                    if is_preflight {
                        *response.status_mut() = StatusCode::NO_CONTENT;
                    }
                    response.headers_mut().insert(
                        header::CACHE_CONTROL,
                        axum::http::HeaderValue::from_static("no-store"),
                    );
                }
                if let Some(origin) =
                    origin.filter(|_| !(is_clipboard && response.status() == StatusCode::FORBIDDEN))
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
        .with_state(state)
}

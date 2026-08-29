mod handlers;
mod router;
mod state;
mod static_handlers;

use rust_embed::Embed;
use std::net::SocketAddr;
use std::sync::Arc;

use dinotty_server::agent;
use dinotty_server::audit;
use dinotty_server::auth;
use dinotty_server::auth::session::SessionStore;
use dinotty_server::auth::verification_code::CodeStore;
use dinotty_server::file_watcher::FileWatcherState;
use dinotty_server::history::HistoryState;
use dinotty_server::mcp;
use dinotty_server::mission_control;
use dinotty_server::monitor::MonitorState;
use dinotty_server::notification::{self, NotificationBroadcast};
use dinotty_server::platform::shell_probe::ShellProbeService;
use dinotty_server::plugin::{self, PluginManager};
use dinotty_server::session::{restore_session, SessionManager, SessionSnapshotStore};
use dinotty_server::settings;
use dinotty_server::token;
use dinotty_server::update_check;
use dinotty_server::workspace_mgmt;

#[derive(Embed)]
#[folder = "../frontend/dist/"]
struct StaticFiles;

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

pub fn bind_listener(port: u16) -> std::io::Result<std::net::TcpListener> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = std::net::TcpListener::bind(addr)?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

pub fn run_server(
    listener: std::net::TcpListener,
    manager: Arc<SessionManager>,
    shell_probe: Arc<ShellProbeService>,
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

        let notifier = Arc::new(NotificationBroadcast::new(
            Arc::clone(&manager.sync_clients),
            manager.event_bus.clone(),
        ));
        let settings_state = settings::create_settings_state();
        notifier.set_settings(settings_state.clone());
        // Restore tabs/panes from the last session (if enabled in settings).
        // Done before `start_cleanup_task` so the reaper never sees restoring
        // sessions as unowned (mirrors src/main.rs server wiring).
        {
            let restore_enabled = settings_state.read().await.restore_session_on_startup;
            if restore_enabled {
                let snapshot = SessionSnapshotStore::new().load();
                if !snapshot.tabs.is_empty() {
                    tracing::info!("Restoring session: {} tabs in snapshot", snapshot.tabs.len());
                    restore_session(&manager, &snapshot).await;
                }
            }
        }
        // Start the snapshot debounce task after restore so restore-time layout
        // commits don't trigger a redundant write.
        manager.start_snapshot_task();
        // Registering the notifier is independent of starting the reaper: a bind failure or
        // startup-ordering issue here must never suppress the detached-session reaper itself
        // (mirrors src/main.rs server wiring).
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
        let git_info = static_handlers::read_git_info();
        let plugins = Arc::new(PluginManager::new(
            format!("http://127.0.0.1:{local_port}"),
            "desktop".into(),
        ));
        plugins.scan();
        // Seed the bundled keyboard plugin (installs when missing, updates when
        // the installed copy is older). Best-effort.
        if let Err(error) = plugins.ensure_seed().await {
            tracing::warn!(%error, "failed to ensure bundled seed plugin");
        }
        plugins.scan();
        let _plugin_process_guard = PluginProcessGuard(Arc::clone(&plugins));

        let initial_token = settings::load_token()
            .or_else(|| std::env::var("DINOTTY_TOKEN").ok())
            .unwrap_or_default();
        let initial_token = if initial_token.is_empty() {
            let token = static_handlers::generate_random_token();
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
        let mc_state = mission_control::create_mission_control_state();
        // Sync MC's selected_workspace_id to active_workspace_id so the
        // overview highlights the workspace the user is landing in (otherwise
        // MC opens with nothing selected, even though the workspace view
        // correctly shows the restored workspace's tabs).
        {
            let active_ws = settings_state.read().await.active_workspace_id.clone();
            mc_state.write().await.selected_workspace_id = active_ws;
        }

        let (verification_code_ttl, verification_code_rate_limit) = {
            let s = settings::load_settings();
            (s.auth.verification_code_ttl_seconds, s.auth.verification_code_rate_limit_per_minute)
        };
        let code_store =
            Arc::new(CodeStore::new(verification_code_ttl, verification_code_rate_limit));
        code_store.clone().start_cleanup_task();

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
        let mcp_server = Arc::new(mcp::server::McpServer::new(
            manager.clone(),
            settings_state.clone(),
            Arc::clone(&shell_probe),
        ));
        let mcp_sse = Arc::new(mcp::transport::SseState::new());

        let state = state::AppState {
            manager: manager.clone(),
            settings: settings_state,
            shell_probe,
            file_watcher: Arc::new(FileWatcherState::new(manager.event_bus.clone())),
            monitor: monitor_state,
            notifier,
            history: history_state,
            auth_token,
            plugins,
            port: local_port,
            git_info,
            sessions,
            workspaces: workspaces_state,
            mc: mc_state,
            subscriptions: plugin::SubscriptionRegistry::new(),
            code_store,
            update_checker: update_check::UpdateChecker::new(),
            tokens,
            agent: agent_state,
            mcp: mcp_server,
            mcp_sse,
        };

        state.plugins.watch_changes(manager);

        let app = router::build_router(state);

        tracing::info!("Embedded server listening on http://0.0.0.0:{}", local_port);
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    }
}

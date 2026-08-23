use std::sync::Arc;

use dinotty_server::agent;
use dinotty_server::api::clipboard;
use dinotty_server::auth::session::SessionStore;
use dinotty_server::auth::verification_code::CodeStore;
use dinotty_server::file_watcher::FileWatcherState;
use dinotty_server::history::HistoryState;
use dinotty_server::mcp;
use dinotty_server::mission_control;
use dinotty_server::monitor::MonitorState;
use dinotty_server::notification::NotificationBroadcast;
use dinotty_server::platform::shell_probe::ShellProbeService;
use dinotty_server::plugin;
use dinotty_server::session::SessionManager;
use dinotty_server::settings;
use dinotty_server::token;
use dinotty_server::update_check;
use dinotty_server::workspace_mgmt;

#[derive(Clone, serde::Serialize)]
pub struct GitInfo {
    pub version: String,
    pub repo_url: String,
}

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<SessionManager>,
    pub settings: settings::SettingsState,
    pub shell_probe: Arc<ShellProbeService>,
    pub file_watcher: Arc<FileWatcherState>,
    pub monitor: MonitorState,
    pub notifier: Arc<NotificationBroadcast>,
    pub history: HistoryState,
    pub auth_token: Arc<tokio::sync::RwLock<String>>,
    pub plugins: plugin::PluginManagerState,
    pub port: u16,
    pub git_info: GitInfo,
    pub sessions: Arc<SessionStore>,
    pub workspaces: workspace_mgmt::WorkspacesState,
    pub mc: mission_control::MissionControlState,
    pub subscriptions: plugin::SubscriptionRegistry,
    pub code_store: Arc<CodeStore>,
    pub update_checker: update_check::UpdateCheckState,
    pub tokens: token::TokenState,
    pub agent: agent::AgentState,
    pub mcp: Arc<mcp::server::McpServer>,
    pub mcp_sse: Arc<mcp::transport::SseState>,
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

impl axum::extract::FromRef<AppState> for Arc<ShellProbeService> {
    fn from_ref(state: &AppState) -> Self {
        state.shell_probe.clone()
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

impl axum::extract::FromRef<AppState> for plugin::PluginManagerState {
    fn from_ref(state: &AppState) -> Self {
        state.plugins.clone()
    }
}

impl axum::extract::FromRef<AppState> for plugin::SubscriptionRegistry {
    fn from_ref(state: &AppState) -> Self {
        state.subscriptions.clone()
    }
}

impl axum::extract::FromRef<AppState>
    for (plugin::PluginManagerState, plugin::SubscriptionRegistry)
{
    fn from_ref(state: &AppState) -> Self {
        (state.plugins.clone(), state.subscriptions.clone())
    }
}

impl axum::extract::FromRef<AppState>
    for (plugin::PluginManagerState, settings::SettingsState, plugin::SubscriptionRegistry)
{
    fn from_ref(state: &AppState) -> Self {
        (state.plugins.clone(), state.settings.clone(), state.subscriptions.clone())
    }
}

impl axum::extract::FromRef<AppState> for (plugin::PluginManagerState, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.plugins.clone(), state.manager.clone())
    }
}

impl axum::extract::FromRef<AppState>
    for (plugin::PluginManagerState, Arc<SessionManager>, workspace_mgmt::WorkspacesState)
{
    fn from_ref(state: &AppState) -> Self {
        (state.plugins.clone(), state.manager.clone(), state.workspaces.clone())
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

impl axum::extract::FromRef<AppState> for update_check::UpdateCheckState {
    fn from_ref(state: &AppState) -> Self {
        state.update_checker.clone()
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

impl axum::extract::FromRef<AppState> for mission_control::MissionControlState {
    fn from_ref(state: &AppState) -> Self {
        state.mc.clone()
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

impl axum::extract::FromRef<AppState> for token::TokenState {
    fn from_ref(state: &AppState) -> Self {
        state.tokens.clone()
    }
}

impl axum::extract::FromRef<AppState> for agent::AgentState {
    fn from_ref(state: &AppState) -> Self {
        state.agent.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<mcp::server::McpServer> {
    fn from_ref(state: &AppState) -> Self {
        state.mcp.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<mcp::transport::SseState> {
    fn from_ref(state: &AppState) -> Self {
        state.mcp_sse.clone()
    }
}

impl axum::extract::FromRef<AppState>
    for (Arc<SessionManager>, workspace_mgmt::WorkspacesState, settings::SettingsState)
{
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.workspaces.clone(), state.settings.clone())
    }
}

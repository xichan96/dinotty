use std::sync::Arc;

use axum::extract::FromRef;
use dinotty_server::{
    agent, api::clipboard, audit, mcp, mission_control, plugin, token, update_check, webhook,
    workspace_mgmt,
};

use crate::auth::session::SessionStore;
use crate::auth::verification_code::CodeStore;
use crate::file_watcher::FileWatcherState;
use crate::history::HistoryState;
use crate::monitor::MonitorState;
use crate::notification::NotificationBroadcast;
use crate::plugin::PluginManagerState;
use crate::session::SessionManager;
use crate::settings::SettingsState;
use crate::GitInfo;

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<SessionManager>,
    pub settings: SettingsState,
    pub shell_probe: Arc<dinotty_server::platform::shell_probe::ShellProbeService>,
    pub file_watcher: Arc<FileWatcherState>,
    pub monitor: MonitorState,
    pub notifier: Arc<NotificationBroadcast>,
    pub history: HistoryState,
    pub auth_token: Arc<tokio::sync::RwLock<String>>,
    pub port: u16,
    pub plugins: PluginManagerState,
    pub git_info: GitInfo,
    pub tokens: token::TokenState,
    pub audit: audit::AuditState,
    pub agent: agent::AgentState,
    pub webhooks: webhook::WebhookState,
    pub mcp: mcp::transport::McpState,
    pub mcp_sse: Arc<mcp::transport::SseState>,
    pub workspaces: workspace_mgmt::WorkspacesState,
    pub mc: mission_control::MissionControlState,
    pub sessions: Arc<SessionStore>,
    pub code_store: Arc<CodeStore>,
    pub subscriptions: plugin::SubscriptionRegistry,
    pub update_checker: update_check::UpdateCheckState,
}

// Allow extracting Arc<SessionManager> from AppState for ws handlers
impl FromRef<AppState> for Arc<SessionManager> {
    fn from_ref(state: &AppState) -> Self {
        state.manager.clone()
    }
}

// Allow extracting (Arc<SessionManager>, SettingsState) for settings handlers
impl FromRef<AppState> for (Arc<SessionManager>, SettingsState) {
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.settings.clone())
    }
}

impl FromRef<AppState> for SettingsState {
    fn from_ref(state: &AppState) -> Self {
        state.settings.clone()
    }
}

impl FromRef<AppState> for Arc<dinotty_server::platform::shell_probe::ShellProbeService> {
    fn from_ref(state: &AppState) -> Self {
        state.shell_probe.clone()
    }
}

// Allow extracting (Arc<SessionManager>, Arc<FileWatcherState>) for file watcher handlers
impl FromRef<AppState> for (Arc<SessionManager>, Arc<FileWatcherState>) {
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.file_watcher.clone())
    }
}

impl FromRef<AppState> for Arc<FileWatcherState> {
    fn from_ref(state: &AppState) -> Self {
        state.file_watcher.clone()
    }
}

impl FromRef<AppState> for MonitorState {
    fn from_ref(state: &AppState) -> Self {
        state.monitor.clone()
    }
}

impl FromRef<AppState> for Arc<NotificationBroadcast> {
    fn from_ref(state: &AppState) -> Self {
        state.notifier.clone()
    }
}

impl FromRef<AppState> for (Arc<NotificationBroadcast>, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.notifier.clone(), state.manager.clone())
    }
}

impl FromRef<AppState> for HistoryState {
    fn from_ref(state: &AppState) -> Self {
        state.history.clone()
    }
}

impl FromRef<AppState> for PluginManagerState {
    fn from_ref(state: &AppState) -> Self {
        state.plugins.clone()
    }
}

impl FromRef<AppState> for plugin::SubscriptionRegistry {
    fn from_ref(state: &AppState) -> Self {
        state.subscriptions.clone()
    }
}

impl FromRef<AppState> for (PluginManagerState, plugin::SubscriptionRegistry) {
    fn from_ref(state: &AppState) -> Self {
        (state.plugins.clone(), state.subscriptions.clone())
    }
}

impl FromRef<AppState> for (PluginManagerState, SettingsState, plugin::SubscriptionRegistry) {
    fn from_ref(state: &AppState) -> Self {
        (state.plugins.clone(), state.settings.clone(), state.subscriptions.clone())
    }
}

impl FromRef<AppState> for (PluginManagerState, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.plugins.clone(), state.manager.clone())
    }
}

impl FromRef<AppState>
    for (PluginManagerState, Arc<SessionManager>, workspace_mgmt::WorkspacesState)
{
    fn from_ref(state: &AppState) -> Self {
        (state.plugins.clone(), state.manager.clone(), state.workspaces.clone())
    }
}

impl FromRef<AppState> for token::TokenState {
    fn from_ref(state: &AppState) -> Self {
        state.tokens.clone()
    }
}

impl FromRef<AppState> for audit::AuditState {
    fn from_ref(state: &AppState) -> Self {
        state.audit.clone()
    }
}

impl FromRef<AppState> for agent::AgentState {
    fn from_ref(state: &AppState) -> Self {
        state.agent.clone()
    }
}

impl FromRef<AppState> for mcp::transport::McpState {
    fn from_ref(state: &AppState) -> Self {
        state.mcp.clone()
    }
}

impl FromRef<AppState> for Arc<mcp::transport::SseState> {
    fn from_ref(state: &AppState) -> Self {
        state.mcp_sse.clone()
    }
}

impl FromRef<AppState> for Arc<SessionStore> {
    fn from_ref(state: &AppState) -> Self {
        state.sessions.clone()
    }
}

impl FromRef<AppState> for Arc<tokio::sync::RwLock<String>> {
    fn from_ref(state: &AppState) -> Self {
        state.auth_token.clone()
    }
}

impl FromRef<AppState> for update_check::UpdateCheckState {
    fn from_ref(state: &AppState) -> Self {
        state.update_checker.clone()
    }
}

impl FromRef<AppState> for clipboard::ClipboardState {
    fn from_ref(state: &AppState) -> Self {
        clipboard::ClipboardState::new(state.auth_token.clone(), state.sessions.clone(), state.port)
    }
}

impl FromRef<AppState> for workspace_mgmt::WorkspacesState {
    fn from_ref(state: &AppState) -> Self {
        state.workspaces.clone()
    }
}

impl FromRef<AppState> for mission_control::MissionControlState {
    fn from_ref(state: &AppState) -> Self {
        state.mc.clone()
    }
}

impl FromRef<AppState>
    for (mission_control::MissionControlState, Arc<SessionManager>, workspace_mgmt::WorkspacesState)
{
    fn from_ref(state: &AppState) -> Self {
        (state.mc.clone(), state.manager.clone(), state.workspaces.clone())
    }
}

impl FromRef<AppState> for (workspace_mgmt::WorkspacesState, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.workspaces.clone(), state.manager.clone())
    }
}

impl FromRef<AppState> for (workspace_mgmt::WorkspacesState, Arc<SessionManager>, SettingsState) {
    fn from_ref(state: &AppState) -> Self {
        (state.workspaces.clone(), state.manager.clone(), state.settings.clone())
    }
}

impl FromRef<AppState> for (workspace_mgmt::WorkspacesState, SettingsState, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.workspaces.clone(), state.settings.clone(), state.manager.clone())
    }
}

impl FromRef<AppState> for (SettingsState, Arc<SessionManager>) {
    fn from_ref(state: &AppState) -> Self {
        (state.settings.clone(), state.manager.clone())
    }
}

impl FromRef<AppState> for (Arc<SessionManager>, workspace_mgmt::WorkspacesState, SettingsState) {
    fn from_ref(state: &AppState) -> Self {
        (state.manager.clone(), state.workspaces.clone(), state.settings.clone())
    }
}

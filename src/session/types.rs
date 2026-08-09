use crate::attention::{MarkReadResult, Severity, Snapshot, StateDelta};
use crate::workspace_mgmt::Workspace;
use serde::Serialize;
use std::time::Instant;
use tokio::sync::mpsc;

#[derive(Clone, Copy, Debug)]
pub enum CloseReason {
    Explicit,
    NaturalExit,
    Reaped,
    Shutdown,
}

#[derive(Clone, Copy, Debug)]
pub enum SessionStatus {
    Connected,
    Detached { since: Instant },
}

pub struct SyncClient {
    pub id: String,
    pub tx: mpsc::UnboundedSender<String>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncMsg {
    TabList {
        tabs: Vec<TabInfo>,
        active_pane_id: Option<String>,
    },
    TabCreated {
        tab_id: String,
        pane_id: String,
        layout: Option<serde_json::Value>,
        cwd: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        connection_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        workspace_id: Option<String>,
    },
    TabClosed {
        pane_id: String,
    },
    TabActivated {
        pane_id: String,
    },
    LayoutUpdated {
        pane_id: String,
        layout: serde_json::Value,
        active_pane_id: String,
    },
    PluginChanged {
        plugin_id: String,
        change: String,
    },
    ProcessExited {
        plugin_id: String,
        pid: u32,
        exit_code: Option<i32>,
    },
    CommandFinished {
        pane_id: String,
        command: String,
        exit_code: i32,
        duration_ms: u64,
        stdout: String,
        method: String,
    },
    WorkspaceCreated {
        workspace: Workspace,
    },
    WorkspaceUpdated {
        workspace: Workspace,
    },
    WorkspaceDeleted {
        id: String,
    },
    WorkspaceActivated {
        id: Option<String>,
    },
    WorkspaceReordered {
        ids: Vec<String>,
    },
    WorkspaceList {
        workspaces: Vec<Workspace>,
        active_workspace_id: Option<String>,
    },
    Event {
        #[serde(skip_serializing_if = "Option::is_none")]
        source_pane_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        plugin_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        target_plugin_id: Option<String>,
        event_name: String,
        data: serde_json::Value,
    },
    SyncHello {
        client_id: String,
    },
    Bell {
        v: u64,
        pane_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        body: String,
        notification_type: String,
        #[serde(rename = "eventSeq")]
        event_seq: String,
        #[serde(rename = "occurredAt")]
        occurred_at: u64,
        severity: Severity,
        #[serde(rename = "notifId", skip_serializing_if = "Option::is_none")]
        notif_id: Option<String>,
    },
    Notify {
        v: u64,
        pane_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        body: String,
        notification_type: String,
        #[serde(rename = "eventSeq")]
        event_seq: String,
        #[serde(rename = "occurredAt")]
        occurred_at: u64,
        severity: Severity,
        #[serde(rename = "notifId", skip_serializing_if = "Option::is_none")]
        notif_id: Option<String>,
    },
    StateDelta {
        #[serde(flatten)]
        delta: StateDelta,
    },
    Snapshot {
        #[serde(flatten)]
        snapshot: Snapshot,
    },
    MarkReadResult {
        #[serde(flatten)]
        result: MarkReadResult,
    },
    ResyncRequired {
        v: u64,
    },
    Suggestions {
        items: Vec<crate::history::SuggestionItem>,
    },
    MonitorData {
        data: serde_json::Value,
    },
    MonitorHistory {
        data: Vec<serde_json::Value>,
    },
    TabRenamed {
        tab_id: String,
        title: String,
    },
    /// Mission Control open/close flipped. Contains the full snapshot so
    /// receivers can refresh both `open` and the selected card atomically.
    /// Broadcast includes the sender - frontend treats it as the authoritative
    /// mirror update and does not re-send. `selected_*` are always sent
    /// (as `null` when cleared) so clients can distinguish "unchanged" from
    /// "cleared" - critical for the default workspace, which is encoded as
    /// `selected_workspace_id: null`.
    MissionControlToggled {
        open: bool,
        selected_workspace_id: Option<String>,
        selected_tab_id: Option<String>,
    },
    /// Selected card inside MC moved (arrow keys / mouse). `tab_title` is the
    /// title of `selected_tab_id` looked up at the server, so touchscreen
    /// clients can render the name without a separate `tab_list` round-trip.
    /// `selected_*` are always sent (as `null` when cleared) so the frontend
    /// can mirror clears, not just sets. `tab_title` is omitted when None
    /// because it's purely informational.
    SelectionChanged {
        selected_workspace_id: Option<String>,
        selected_tab_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tab_title: Option<String>,
    },
    /// Initial MC snapshot sent on sync WS connect (after `tab_list` /
    /// `workspace_list` so the selected ids can be resolved by the client).
    McSnapshot {
        open: bool,
        selected_workspace_id: Option<String>,
        selected_tab_id: Option<String>,
    },
}

#[derive(Serialize, Clone)]
pub struct TabInfo {
    pub tab_id: String,
    pub pane_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_pane_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// The `SshProfile.id` if this tab is an SSH session created from a profile.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    /// Explicit workspace assignment for tabs that cannot be identified by CWD.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

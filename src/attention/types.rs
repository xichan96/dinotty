use serde::{Deserialize, Serialize};

pub mod decimal_string {
    use serde::Serializer;

    pub fn serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&value.to_string())
    }
}

pub mod optional_decimal_string {
    use serde::Serializer;

    pub fn serialize<S>(value: &Option<u64>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            Some(value) => serializer.serialize_some(&value.to_string()),
            None => serializer.serialize_none(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Success,
    Warning,
    Error,
    Urgent,
}

impl Severity {
    /// Lowercase string matching the serde serialization. Used when bridging to
    /// `BusEvent::Notify` (which carries `severity: String`) without round-tripping
    /// through `serde_json` just to get the textual form.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Success => "success",
            Self::Warning => "warning",
            Self::Error => "error",
            Self::Urgent => "urgent",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnreadEvent {
    pub seq: u64,
    pub occurred_at: u64,
    pub severity: Severity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaneAttention {
    pub read_through_seq: u64,
    pub latest_event_seq: u64,
    pub unread: std::collections::VecDeque<UnreadEvent>,
    pub read_at: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NotifAttention {
    pub event_seq: u64,
    pub occurred_at: u64,
    pub severity: Severity,
    pub read: bool,
    pub read_at: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DedupEntry {
    pub(crate) payload_hash: u64,
    pub(crate) state: DedupState,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum DedupState {
    InFlight { reserved_at: u64, generation: u64 },
    Done { done_at: u64, outcome: DedupOutcome },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DedupOutcome {
    MarkRead(MarkReadResult),
    Producer(ProducerOutcome),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ProducerOutcome {
    #[serde(rename = "accepted")]
    AcceptedPane {
        #[serde(rename = "paneId")]
        pane_id: String,
        #[serde(rename = "eventSeq", with = "decimal_string")]
        event_seq: u64,
        #[serde(with = "decimal_string")]
        revision: u64,
    },
    #[serde(rename = "accepted")]
    AcceptedNotif {
        #[serde(rename = "notifId")]
        notif_id: String,
        #[serde(rename = "eventSeq", with = "decimal_string")]
        event_seq: u64,
        #[serde(with = "decimal_string")]
        revision: u64,
    },
    Suppressed {
        reason: String,
    },
    NotFound,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateDelta {
    pub epoch: String,
    #[serde(with = "decimal_string")]
    pub revision: u64,
    pub panes: Vec<PaneDelta>,
    pub notifs: Vec<NotifDelta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneDelta {
    pub pane_id: String,
    #[serde(with = "optional_decimal_string")]
    pub latest_event_seq: Option<u64>,
    #[serde(with = "optional_decimal_string")]
    pub read_through_seq: Option<u64>,
    pub first_unread_at: Option<u64>,
    pub severity: Option<Severity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifDelta {
    pub notif_id: String,
    pub read: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub epoch: String,
    #[serde(with = "decimal_string")]
    pub revision: u64,
    pub panes: Vec<PaneDelta>,
    pub notifs: Vec<NotifDelta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadResult {
    pub request_id: String,
    pub epoch: String,
    #[serde(with = "optional_decimal_string")]
    pub applied_at_revision: Option<u64>,
    pub results: Vec<TargetResult>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TargetResult {
    pub target: AttentionTarget,
    pub status: TargetStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum AttentionTarget {
    Pane {
        #[serde(rename = "paneId")]
        pane_id: String,
    },
    Notif {
        #[serde(rename = "notifId")]
        notif_id: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetStatus {
    Applied,
    StaleEpoch,
    Invalid,
    NotFound,
    Conflict,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReserveResult {
    Reserved { generation: u64 },
    Replay(DedupOutcome),
    Conflict,
    InFlight,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IngestSource {
    Bell { debounce_duplicate: bool },
    OscNotify { debounce_duplicate: bool },
    CommandComplete { matched_rule: bool },
    KeywordMatch { matched_rule: bool },
    Plugin,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IngestGateResult {
    Accepted,
    Suppressed(String),
}

impl PaneDelta {
    pub(crate) fn removed(pane_id: &str) -> Self {
        Self {
            pane_id: pane_id.to_owned(),
            latest_event_seq: None,
            read_through_seq: None,
            first_unread_at: None,
            severity: None,
            removed: Some(true),
        }
    }
}

impl NotifDelta {
    pub(crate) fn removed(notif_id: &str) -> Self {
        Self { notif_id: notif_id.to_owned(), read: None, removed: Some(true) }
    }
}

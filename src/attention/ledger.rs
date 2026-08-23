use std::collections::{HashMap, VecDeque};

use uuid::Uuid;

use super::types::{
    AttentionTarget, DedupEntry, DedupOutcome, DedupState, IngestGateResult, IngestSource,
    NotifAttention, NotifDelta, PaneAttention, PaneDelta, ReserveResult, Severity, Snapshot,
    StateDelta, TargetResult, TargetStatus, UnreadEvent,
};
use crate::settings::NotificationConfig;

/// Memory and retention bounds for attention state and request deduplication.
pub const UNREAD_CAP: usize = 100;
/// Maximum age of an unread event and retention period for fully-read identities.
pub const UNREAD_TTL: u64 = 72 * 60 * 60 * 1_000;
/// Maximum number of pane identities and pane-less notification identities, independently.
pub const IDENTITY_CAP: usize = 512;
/// Completed request replay horizon, measured from completion time.
pub const DEDUP_TTL: u64 = 10 * 60 * 1_000;
/// Maximum age of an unfinished reservation before it may be reclaimed.
pub const RESERVATION_TIMEOUT: u64 = 30 * 1_000;

/// Evaluates the configuration-dependent ingest gate before an event sequence is allocated.
///
/// `matched_rule` and `debounce_duplicate` must be computed by the caller from the current
/// configuration and attention state.
pub fn evaluate_ingest_gate(cfg: &NotificationConfig, source: IngestSource) -> IngestGateResult {
    if !cfg.enabled {
        return IngestGateResult::Suppressed("notification_disabled".into());
    }

    match source {
        IngestSource::Bell { .. } if !cfg.bell.enabled => {
            IngestGateResult::Suppressed("bell_disabled".into())
        }
        IngestSource::Bell { debounce_duplicate: true } => {
            IngestGateResult::Suppressed("bell_debounce_duplicate".into())
        }
        IngestSource::Bell { debounce_duplicate: false } | IngestSource::Plugin => {
            IngestGateResult::Accepted
        }
        IngestSource::OscNotify { debounce_duplicate: true } => {
            IngestGateResult::Suppressed("osc_debounce_duplicate".into())
        }
        IngestSource::OscNotify { debounce_duplicate: false } if cfg.osc_notify => {
            IngestGateResult::Accepted
        }
        IngestSource::OscNotify { .. } => {
            IngestGateResult::Suppressed("osc_notify_disabled".into())
        }
        IngestSource::CommandComplete { matched_rule }
            if cfg.command_complete.enabled && matched_rule =>
        {
            IngestGateResult::Accepted
        }
        IngestSource::CommandComplete { .. } => {
            IngestGateResult::Suppressed("command_complete_not_matched".into())
        }
        IngestSource::KeywordMatch { matched_rule } if matched_rule => IngestGateResult::Accepted,
        IngestSource::KeywordMatch { .. } => {
            IngestGateResult::Suppressed("keyword_match_not_matched".into())
        }
    }
}

#[derive(Clone, Debug)]
pub struct AttentionLedger {
    pub(crate) epoch: String,
    pub(crate) next_event_seq: u64,
    pub(crate) next_dedup_generation: u64,
    pub(crate) revision: u64,
    pub(crate) panes: HashMap<String, PaneAttention>,
    pub(crate) notifs: HashMap<String, NotifAttention>,
    pub(crate) dedup: HashMap<(String, String), DedupEntry>,
}

impl AttentionLedger {
    #[must_use]
    pub fn new() -> Self {
        Self::with_epoch(Uuid::new_v4().to_string())
    }

    #[must_use]
    pub fn with_epoch(epoch: String) -> Self {
        Self {
            epoch,
            next_event_seq: 1,
            next_dedup_generation: 1,
            revision: 0,
            panes: HashMap::new(),
            notifs: HashMap::new(),
            dedup: HashMap::new(),
        }
    }

    #[must_use]
    pub fn epoch(&self) -> &str {
        &self.epoch
    }

    #[must_use]
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn record_pane_event(
        &mut self,
        pane_id: impl Into<String>,
        occurred_at: u64,
        severity: Severity,
        now_ms: u64,
    ) -> (u64, StateDelta) {
        let mut pane_deltas = Vec::new();
        let mut notif_deltas = Vec::new();
        self.expire_into(now_ms, &mut pane_deltas, &mut notif_deltas);

        let pane_id = pane_id.into();
        let event_seq = self.take_event_seq();
        let pane = self.panes.entry(pane_id.clone()).or_insert_with(|| PaneAttention {
            read_through_seq: 0,
            latest_event_seq: 0,
            unread: VecDeque::new(),
            read_at: None,
        });
        pane.latest_event_seq = event_seq;
        pane.unread.push_back(UnreadEvent { seq: event_seq, occurred_at, severity });
        pane.read_at = None;

        while pane.unread.len() > UNREAD_CAP {
            if let Some(dropped) = pane.unread.pop_front() {
                tracing::warn!(
                    pane_id,
                    event_seq = dropped.seq,
                    "[unread-drop] per-pane unread cap exceeded"
                );
            }
        }

        upsert_pane_delta(&mut pane_deltas, self.pane_delta(&pane_id));
        self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);
        let revision = self.bump_revision();
        (event_seq, self.delta(revision, pane_deltas, notif_deltas))
    }

    pub fn record_notif_event(
        &mut self,
        notif_id: impl Into<String>,
        occurred_at: u64,
        severity: Severity,
        now_ms: u64,
    ) -> (u64, StateDelta) {
        let mut pane_deltas = Vec::new();
        let mut notif_deltas = Vec::new();
        self.expire_into(now_ms, &mut pane_deltas, &mut notif_deltas);

        let notif_id = notif_id.into();
        let event_seq = self.take_event_seq();
        self.notifs.insert(
            notif_id.clone(),
            NotifAttention { event_seq, occurred_at, severity, read: false, read_at: None },
        );

        upsert_notif_delta(&mut notif_deltas, self.notif_delta(&notif_id));
        self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);
        let revision = self.bump_revision();
        (event_seq, self.delta(revision, pane_deltas, notif_deltas))
    }

    pub fn mark_read(
        &mut self,
        epoch: &str,
        panes: &[(String, u64)],
        notifs: &[String],
        now_ms: u64,
    ) -> (Option<StateDelta>, Vec<TargetResult>, Option<u64>) {
        let mut pane_deltas = Vec::new();
        let mut notif_deltas = Vec::new();
        self.expire_into(now_ms, &mut pane_deltas, &mut notif_deltas);

        if epoch != self.epoch {
            let results = panes
                .iter()
                .map(|(pane_id, _)| TargetResult {
                    target: AttentionTarget::Pane { pane_id: pane_id.clone() },
                    status: TargetStatus::StaleEpoch,
                })
                .chain(notifs.iter().map(|notif_id| TargetResult {
                    target: AttentionTarget::Notif { notif_id: notif_id.clone() },
                    status: TargetStatus::StaleEpoch,
                }))
                .collect();
            self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);
            let delta = self.finish_delta(pane_deltas, notif_deltas);
            return (delta, results, None);
        }

        let mut results = Vec::with_capacity(panes.len() + notifs.len());
        let mut accepted_any = false;
        let mut changed_panes = Vec::new();
        let mut changed_notifs = Vec::new();

        for (pane_id, through_seq) in panes {
            let status = match self.panes.get_mut(pane_id) {
                None => TargetStatus::NotFound,
                Some(pane) if *through_seq > pane.latest_event_seq => TargetStatus::Invalid,
                Some(pane) => {
                    accepted_any = true;
                    let old_watermark = pane.read_through_seq;
                    let was_unread = !pane.unread.is_empty();
                    pane.read_through_seq = pane.read_through_seq.max(*through_seq);
                    while pane
                        .unread
                        .front()
                        .is_some_and(|event| event.seq <= pane.read_through_seq)
                    {
                        pane.unread.pop_front();
                    }
                    if pane.unread.is_empty() && was_unread {
                        pane.read_through_seq = pane.latest_event_seq;
                        pane.read_at = Some(now_ms);
                    }
                    if pane.read_through_seq != old_watermark
                        || (was_unread && pane.unread.is_empty())
                    {
                        push_unique(&mut changed_panes, pane_id);
                    }
                    TargetStatus::Applied
                }
            };
            results.push(TargetResult {
                target: AttentionTarget::Pane { pane_id: pane_id.clone() },
                status,
            });
        }

        for notif_id in notifs {
            let status = match self.notifs.get_mut(notif_id) {
                None => TargetStatus::NotFound,
                Some(notif) => {
                    accepted_any = true;
                    if !notif.read {
                        notif.read = true;
                        notif.read_at = Some(now_ms);
                        push_unique(&mut changed_notifs, notif_id);
                    }
                    TargetStatus::Applied
                }
            };
            results.push(TargetResult {
                target: AttentionTarget::Notif { notif_id: notif_id.clone() },
                status,
            });
        }

        for id in changed_panes {
            upsert_pane_delta(&mut pane_deltas, self.pane_delta(&id));
        }
        for id in changed_notifs {
            upsert_notif_delta(&mut notif_deltas, self.notif_delta(&id));
        }
        self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);

        let delta = self.finish_delta(pane_deltas, notif_deltas);
        let applied_at_revision = accepted_any.then_some(self.revision);
        (delta, results, applied_at_revision)
    }

    pub fn pane_closed(&mut self, pane_id: &str, now_ms: u64) -> Option<StateDelta> {
        let mut pane_deltas = Vec::new();
        let mut notif_deltas = Vec::new();
        self.expire_into(now_ms, &mut pane_deltas, &mut notif_deltas);
        if self.panes.remove(pane_id).is_some() {
            upsert_pane_delta(&mut pane_deltas, PaneDelta::removed(pane_id));
        }
        self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);
        self.finish_delta(pane_deltas, notif_deltas)
    }

    /// Reserves a deduplication key for a caller that will mutate and complete under one lock.
    ///
    /// The integration layer normally holds one lock across reserve -> mutate -> complete. The
    /// generation guard protects the detached/reclaimed case, where a stale owner may finish
    /// after another caller has reclaimed the reservation.
    pub fn reserve(
        &mut self,
        client_id: impl Into<String>,
        request_id: impl Into<String>,
        payload_hash: u64,
        now_ms: u64,
    ) -> ReserveResult {
        let key = (client_id.into(), request_id.into());
        if let Some(entry) = self.dedup.get(&key) {
            match &entry.state {
                DedupState::InFlight { reserved_at, .. }
                    if is_expired(*reserved_at, RESERVATION_TIMEOUT, now_ms) => {}
                DedupState::Done { done_at, .. } if is_expired(*done_at, DEDUP_TTL, now_ms) => {}
                DedupState::InFlight { .. } if entry.payload_hash != payload_hash => {
                    return ReserveResult::Conflict;
                }
                DedupState::InFlight { .. } => return ReserveResult::InFlight,
                DedupState::Done { .. } if entry.payload_hash != payload_hash => {
                    return ReserveResult::Conflict;
                }
                DedupState::Done { outcome, .. } => {
                    return ReserveResult::Replay(outcome.clone());
                }
            }
        }

        let generation = self.take_dedup_generation();
        self.dedup.insert(
            key,
            DedupEntry {
                payload_hash,
                state: DedupState::InFlight { reserved_at: now_ms, generation },
            },
        );
        ReserveResult::Reserved { generation }
    }

    pub fn complete(
        &mut self,
        key: &(String, String),
        generation: u64,
        outcome: DedupOutcome,
        now_ms: u64,
    ) -> bool {
        let Some(entry) = self.dedup.get_mut(key) else {
            return false;
        };
        match entry.state {
            DedupState::InFlight { generation: active_generation, .. }
                if active_generation == generation =>
            {
                entry.state = DedupState::Done { done_at: now_ms, outcome };
                true
            }
            DedupState::InFlight { .. } | DedupState::Done { .. } => false,
        }
    }

    pub fn sweep(&mut self, now_ms: u64) -> Option<StateDelta> {
        let mut pane_deltas = Vec::new();
        let mut notif_deltas = Vec::new();
        self.expire_into(now_ms, &mut pane_deltas, &mut notif_deltas);
        self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);
        self.finish_delta(pane_deltas, notif_deltas)
    }

    #[must_use]
    pub fn snapshot(&self) -> Snapshot {
        let mut panes: Vec<_> = self.panes.keys().map(|id| self.pane_delta(id)).collect();
        let mut notifs: Vec<_> = self.notifs.keys().map(|id| self.notif_delta(id)).collect();
        panes.sort_by(|a, b| a.pane_id.cmp(&b.pane_id));
        notifs.sort_by(|a, b| a.notif_id.cmp(&b.notif_id));
        Snapshot { epoch: self.epoch.clone(), revision: self.revision, panes, notifs }
    }

    #[must_use]
    pub fn first_unread_at(&self, pane_id: &str) -> Option<u64> {
        self.panes.get(pane_id)?.unread.front().map(|event| event.occurred_at)
    }

    fn expire_into(
        &mut self,
        now_ms: u64,
        pane_deltas: &mut Vec<PaneDelta>,
        notif_deltas: &mut Vec<NotifDelta>,
    ) {
        self.sweep_dedup(now_ms);

        let mut changed_panes = Vec::new();
        let mut changed_notifs = Vec::new();
        let mut removed_panes = Vec::new();
        let mut removed_notifs = Vec::new();

        for (pane_id, pane) in &mut self.panes {
            let old_unread_len = pane.unread.len();
            let was_unread = !pane.unread.is_empty();
            while pane
                .unread
                .front()
                .is_some_and(|event| is_expired(event.occurred_at, UNREAD_TTL, now_ms))
            {
                pane.unread.pop_front();
            }
            if was_unread && pane.unread.is_empty() {
                pane.read_through_seq = pane.latest_event_seq;
                pane.read_at = Some(now_ms);
                push_unique(&mut changed_panes, pane_id);
            } else if pane.unread.len() < old_unread_len {
                push_unique(&mut changed_panes, pane_id);
            }
        }

        for (notif_id, notif) in &mut self.notifs {
            if !notif.read && is_expired(notif.occurred_at, UNREAD_TTL, now_ms) {
                notif.read = true;
                notif.read_at = Some(now_ms);
                push_unique(&mut changed_notifs, notif_id);
            }
        }

        self.panes.retain(|pane_id, pane| {
            let collect = pane.unread.is_empty()
                && pane.read_at.is_some_and(|read_at| is_expired(read_at, UNREAD_TTL, now_ms));
            if collect {
                removed_panes.push(pane_id.clone());
            }
            !collect
        });
        self.notifs.retain(|notif_id, notif| {
            let collect = notif.read
                && notif.read_at.is_some_and(|read_at| is_expired(read_at, UNREAD_TTL, now_ms));
            if collect {
                removed_notifs.push(notif_id.clone());
            }
            !collect
        });

        for id in changed_panes {
            if self.panes.contains_key(&id) {
                upsert_pane_delta(pane_deltas, self.pane_delta(&id));
            }
        }
        for id in changed_notifs {
            if self.notifs.contains_key(&id) {
                upsert_notif_delta(notif_deltas, self.notif_delta(&id));
            }
        }
        for id in removed_panes {
            upsert_pane_delta(pane_deltas, PaneDelta::removed(&id));
        }
        for id in removed_notifs {
            upsert_notif_delta(notif_deltas, NotifDelta::removed(&id));
        }
    }

    fn sweep_dedup(&mut self, now_ms: u64) {
        self.dedup.retain(|_, entry| match &entry.state {
            DedupState::InFlight { reserved_at, .. } => {
                !is_expired(*reserved_at, RESERVATION_TIMEOUT, now_ms)
            }
            DedupState::Done { done_at, .. } => !is_expired(*done_at, DEDUP_TTL, now_ms),
        });
    }

    fn enforce_identity_caps(
        &mut self,
        pane_deltas: &mut Vec<PaneDelta>,
        notif_deltas: &mut Vec<NotifDelta>,
    ) {
        while self.panes.len() > IDENTITY_CAP {
            let pane_id = self
                .panes
                .iter()
                .filter(|(_, pane)| pane.unread.is_empty())
                .min_by(|(left_id, left), (right_id, right)| {
                    (left.read_at.unwrap_or(0), left.latest_event_seq, left_id.as_str()).cmp(&(
                        right.read_at.unwrap_or(0),
                        right.latest_event_seq,
                        right_id.as_str(),
                    ))
                })
                .or_else(|| {
                    self.panes.iter().min_by(|(left_id, left), (right_id, right)| {
                        let left_head = left.unread.front().expect("unread victim has a head");
                        let right_head = right.unread.front().expect("unread victim has a head");
                        (left_head.occurred_at, left_head.seq, left_id.as_str()).cmp(&(
                            right_head.occurred_at,
                            right_head.seq,
                            right_id.as_str(),
                        ))
                    })
                })
                .map(|(id, _)| id.clone())
                .expect("over-cap pane map cannot be empty");
            let evicted_unread =
                self.panes.get(&pane_id).is_some_and(|pane| !pane.unread.is_empty());
            self.panes.remove(&pane_id);
            if evicted_unread {
                tracing::warn!(pane_id, "[identity-evict] evicting live unread pane identity");
            }
            upsert_pane_delta(pane_deltas, PaneDelta::removed(&pane_id));
        }

        while self.notifs.len() > IDENTITY_CAP {
            let notif_id = self
                .notifs
                .iter()
                .filter(|(_, notif)| notif.read)
                .min_by(|(left_id, left), (right_id, right)| {
                    (left.read_at.unwrap_or(0), left.event_seq, left_id.as_str()).cmp(&(
                        right.read_at.unwrap_or(0),
                        right.event_seq,
                        right_id.as_str(),
                    ))
                })
                .or_else(|| {
                    self.notifs.iter().min_by(|(left_id, left), (right_id, right)| {
                        (left.occurred_at, left.event_seq, left_id.as_str()).cmp(&(
                            right.occurred_at,
                            right.event_seq,
                            right_id.as_str(),
                        ))
                    })
                })
                .map(|(id, _)| id.clone())
                .expect("over-cap notification map cannot be empty");
            let evicted_unread = self.notifs.get(&notif_id).is_some_and(|notif| !notif.read);
            self.notifs.remove(&notif_id);
            if evicted_unread {
                tracing::warn!(
                    notif_id,
                    "[identity-evict] evicting live unread notification identity"
                );
            }
            upsert_notif_delta(notif_deltas, NotifDelta::removed(&notif_id));
        }
    }

    pub(crate) fn pane_delta(&self, pane_id: &str) -> PaneDelta {
        let pane = &self.panes[pane_id];
        PaneDelta {
            pane_id: pane_id.to_owned(),
            latest_event_seq: Some(pane.latest_event_seq),
            read_through_seq: Some(pane.read_through_seq),
            first_unread_at: pane.unread.front().map(|event| event.occurred_at),
            severity: pane.unread.iter().map(|event| event.severity).max(),
            removed: None,
        }
    }

    pub(crate) fn notif_delta(&self, notif_id: &str) -> NotifDelta {
        NotifDelta {
            notif_id: notif_id.to_owned(),
            read: Some(self.notifs[notif_id].read),
            removed: None,
        }
    }

    fn delta(&self, revision: u64, panes: Vec<PaneDelta>, notifs: Vec<NotifDelta>) -> StateDelta {
        StateDelta { epoch: self.epoch.clone(), revision, panes, notifs }
    }

    fn finish_delta(
        &mut self,
        panes: Vec<PaneDelta>,
        notifs: Vec<NotifDelta>,
    ) -> Option<StateDelta> {
        if panes.is_empty() && notifs.is_empty() {
            return None;
        }
        let revision = self.bump_revision();
        Some(self.delta(revision, panes, notifs))
    }

    fn take_event_seq(&mut self) -> u64 {
        let event_seq = self.next_event_seq;
        self.next_event_seq = self.next_event_seq.checked_add(1).expect("event sequence exhausted");
        event_seq
    }

    fn take_dedup_generation(&mut self) -> u64 {
        let generation = self.next_dedup_generation;
        self.next_dedup_generation = self
            .next_dedup_generation
            .checked_add(1)
            .expect("dedup reservation generation exhausted");
        generation
    }

    fn bump_revision(&mut self) -> u64 {
        self.revision = self.revision.checked_add(1).expect("attention revision exhausted");
        self.revision
    }
}

impl Default for AttentionLedger {
    fn default() -> Self {
        Self::new()
    }
}

fn is_expired(start: u64, duration: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(start) >= duration
}

fn upsert_pane_delta(deltas: &mut Vec<PaneDelta>, delta: PaneDelta) {
    if let Some(existing) = deltas.iter_mut().find(|existing| existing.pane_id == delta.pane_id) {
        *existing = delta;
    } else {
        deltas.push(delta);
    }
}

fn upsert_notif_delta(deltas: &mut Vec<NotifDelta>, delta: NotifDelta) {
    if let Some(existing) = deltas.iter_mut().find(|existing| existing.notif_id == delta.notif_id) {
        *existing = delta;
    } else {
        deltas.push(delta);
    }
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if !values.iter().any(|existing| existing == value) {
        values.push(value.to_owned());
    }
}

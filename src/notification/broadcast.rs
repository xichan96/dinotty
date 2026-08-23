use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use uuid::Uuid;

use crate::attention::{
    evaluate_ingest_gate, AttentionLedger, DedupOutcome, IngestGateResult, IngestSource,
    MarkReadResult, ProducerOutcome, ReserveResult, Severity,
};
use crate::event_bus::{BusEvent, EventBus};
use crate::platform::{process::CommandNoWindowExt, shell};
use crate::session::{SyncClient, SyncMsg};
use crate::settings::{NotificationConfig, SettingsState};

use super::types::{NotifyRequest, ProducerProcessResult};
use super::util::{conflict_mark_read, now_ms, payload_hash, severity_from_type};
use super::MIN_PROTOCOL_VERSION;

pub struct NotificationBroadcast {
    ledger: Mutex<AttentionLedger>,
    sync_clients: std::sync::Arc<Mutex<Vec<SyncClient>>>,
    bell_debounce: Mutex<HashMap<String, Instant>>,
    osc_debounce: Mutex<HashMap<(String, u64), Instant>>,
    settings: Mutex<Option<SettingsState>>,
    event_bus: EventBus,
}

impl NotificationBroadcast {
    #[must_use]
    pub fn new(sync_clients: std::sync::Arc<Mutex<Vec<SyncClient>>>, event_bus: EventBus) -> Self {
        Self {
            ledger: Mutex::new(AttentionLedger::new()),
            sync_clients,
            bell_debounce: Mutex::new(HashMap::new()),
            osc_debounce: Mutex::new(HashMap::new()),
            settings: Mutex::new(None),
            event_bus,
        }
    }

    pub fn set_settings(&self, state: SettingsState) {
        *self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(state);
    }

    /// Register a new sync client: pushes the current ledger snapshot so the client can
    /// initialize its local attention state. The `sync_client_id` must match the id assigned
    /// by `SessionManager::add_sync_client` - messages are routed to that client via its
    /// `sync_clients` entry.
    pub fn register_client(&self, sync_client_id: &str) {
        let snapshot =
            self.ledger.lock().unwrap_or_else(std::sync::PoisonError::into_inner).snapshot();
        self.send_to_client(sync_client_id, &SyncMsg::Snapshot { snapshot });
    }

    /// No per-client state to clean up - the sync client is already removed from
    /// `sync_clients` by the WS handler on disconnect. Kept for API symmetry with
    /// `register_client` and future per-client bookkeeping.
    pub fn unregister_client(&self, _sync_client_id: &str) {}

    /// Entry point for BELs detected in PTY/SSH output. Applies the content-
    /// aware OSC debounce window (keyed by pane only - bells carry no payload)
    /// before delegating to `send_bell`, so sustained 0x07 output (e.g. binary
    /// files) is capped at one bell per window instead of ~3/s through the
    /// 300ms bell debounce alone.
    pub fn send_detected_bell(&self, pane_id: &str) {
        let cfg = self.notification_config();
        let duplicate = self.check_osc_debounce(
            &(pane_id.to_string(), payload_hash(&"bell")),
            u128::from(cfg.osc_notify_debounce_ms),
        );
        if duplicate {
            return;
        }
        self.send_bell(pane_id);
    }

    pub fn send_bell(&self, pane_id: &str) {
        let cfg = self.notification_config();
        let debounce_duplicate = {
            let mut map =
                self.bell_debounce.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let now = Instant::now();
            let duplicate = map.get(pane_id).is_some_and(|last| {
                now.duration_since(*last).as_millis() < u128::from(cfg.bell.debounce_ms)
            });
            map.retain(|_, last| now.duration_since(*last).as_secs() < 60);
            if !duplicate {
                map.insert(pane_id.to_string(), now);
            }
            duplicate
        };
        if !matches!(
            evaluate_ingest_gate(&cfg, IngestSource::Bell { debounce_duplicate }),
            IngestGateResult::Accepted
        ) {
            return;
        }

        let occurred_at = now_ms();
        let (event_seq, delta) = self
            .ledger
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .record_pane_event(pane_id, occurred_at, Severity::Info, occurred_at);
        self.broadcast(&SyncMsg::StateDelta { delta });
        self.broadcast(&SyncMsg::Bell {
            v: MIN_PROTOCOL_VERSION,
            pane_id: pane_id.to_string(),
            title: None,
            body: "Bell".into(),
            notification_type: "bell".into(),
            event_seq: event_seq.to_string(),
            occurred_at,
            severity: Severity::Info,
            notif_id: None,
        });
        self.event_bus.publish(BusEvent::Notify {
            pane_id: pane_id.to_string(),
            title: None,
            body: "Bell".into(),
            notification_type: "bell".into(),
            severity: Severity::Info.as_str().into(),
            occurred_at,
        });
        self.run_hooks("bell", pane_id, None, "Bell");
    }

    pub fn send_notify(
        &self,
        pane_id: &str,
        title: Option<&str>,
        body: &str,
        notification_type: &str,
    ) {
        let cfg = self.notification_config();
        let debounce_duplicate = self.check_osc_debounce(
            &(pane_id.to_string(), payload_hash(&(title, body))),
            u128::from(cfg.osc_notify_debounce_ms),
        );
        if !matches!(
            evaluate_ingest_gate(&cfg, IngestSource::OscNotify { debounce_duplicate }),
            IngestGateResult::Accepted
        ) {
            return;
        }
        let severity = severity_from_type(notification_type).unwrap_or(Severity::Info);
        let occurred_at = now_ms();
        let (event_seq, delta) = self
            .ledger
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .record_pane_event(pane_id, occurred_at, severity, occurred_at);
        self.broadcast(&SyncMsg::StateDelta { delta });
        self.broadcast(&SyncMsg::Notify {
            v: MIN_PROTOCOL_VERSION,
            pane_id: pane_id.to_string(),
            title: title.map(String::from),
            body: body.to_string(),
            notification_type: notification_type.to_string(),
            event_seq: event_seq.to_string(),
            occurred_at,
            severity,
            notif_id: None,
        });
        self.event_bus.publish(BusEvent::Notify {
            pane_id: pane_id.to_string(),
            title: title.map(String::from),
            body: body.to_string(),
            notification_type: notification_type.to_string(),
            severity: severity.as_str().into(),
            occurred_at,
        });
        self.run_hooks(notification_type, pane_id, title, body);
    }

    pub fn apply_mark_read(&self, sync_client_id: &str, request: &super::types::MarkReadRequest) {
        let now = now_ms();
        let payload_hash = payload_hash(&("notification.mark_read", request));
        let key = (request.client_id.clone(), request.request_id.clone());
        let outcome = {
            let mut ledger = self.ledger.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            match ledger.reserve(&key.0, &key.1, payload_hash, now) {
                ReserveResult::Replay(DedupOutcome::MarkRead(result)) => {
                    self.send_to_client(sync_client_id, &SyncMsg::MarkReadResult { result });
                    return;
                }
                ReserveResult::InFlight => {
                    // Only reachable during a zombie RESERVATION_TIMEOUT window under the
                    // synchronous critical section. Per design C3-03, an in-flight duplicate must
                    // NOT get a conflict verdict (that would make the client drop its overlay) - send
                    // no reply at all; the client's own ack-timeout resend will later hit either
                    // Done(replay) or a reclaimed key (fresh apply).
                    tracing::debug!(
                        "mark_read reservation in-flight for {:?}; suppressing reply, awaiting resend",
                        key
                    );
                    return;
                }
                ReserveResult::Replay(_) | ReserveResult::Conflict => {
                    conflict_mark_read(request, ledger.epoch())
                }
                ReserveResult::Reserved { generation } => {
                    let panes: Vec<_> = request
                        .panes
                        .iter()
                        .filter_map(|pane| {
                            pane.through_event_seq
                                .parse::<u64>()
                                .ok()
                                .map(|seq| (pane.pane_id.clone(), seq))
                        })
                        .collect();
                    let notifs: Vec<_> =
                        request.notifs.iter().map(|notif| notif.notif_id.clone()).collect();
                    let (delta, results, applied_at_revision) =
                        ledger.mark_read(&request.epoch, &panes, &notifs, now);
                    let result = MarkReadResult {
                        request_id: request.request_id.clone(),
                        epoch: ledger.epoch().to_string(),
                        applied_at_revision,
                        results,
                    };
                    let installed = ledger.complete(
                        &key,
                        generation,
                        DedupOutcome::MarkRead(result.clone()),
                        now,
                    );
                    debug_assert!(installed);
                    if let Some(delta) = delta {
                        self.broadcast(&SyncMsg::StateDelta { delta });
                    }
                    result
                }
            }
        };
        self.send_to_client(sync_client_id, &SyncMsg::MarkReadResult { result: outcome });
    }

    pub fn sweep(&self, now: u64) {
        let delta =
            self.ledger.lock().unwrap_or_else(std::sync::PoisonError::into_inner).sweep(now);
        if let Some(delta) = delta {
            self.broadcast(&SyncMsg::StateDelta { delta });
        }
    }

    /// Notifies the ledger that a pane was authoritatively removed (tab/pane close, or the
    /// detached-session reaper), broadcasting the resulting removal delta if the pane had any
    /// attention state. Safe to call for a pane the ledger never tracked (no-op).
    pub fn pane_closed(&self, pane_id: &str) {
        let now = now_ms();
        let delta = self
            .ledger
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pane_closed(pane_id, now);
        if let Some(delta) = delta {
            self.broadcast(&SyncMsg::StateDelta { delta });
        }
    }

    fn notification_config(&self) -> NotificationConfig {
        let guard = self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        guard
            .as_ref()
            .and_then(|state| state.try_read().ok().map(|settings| settings.notification.clone()))
            .unwrap_or_default()
    }

    /// Check (and refresh) the content-aware OSC debounce map. Returns true when
    /// the same key was seen within `debounce_ms`. Mirrors `bell_debounce`
    /// semantics, including the 60s retain sweep that bounds the key set.
    fn check_osc_debounce(&self, key: &(String, u64), debounce_ms: u128) -> bool {
        let mut map = self.osc_debounce.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let now = Instant::now();
        let duplicate =
            map.get(key).is_some_and(|last| now.duration_since(*last).as_millis() < debounce_ms);
        map.retain(|_, last| now.duration_since(*last).as_secs() < 60);
        if !duplicate {
            map.insert(key.clone(), now);
        }
        duplicate
    }

    pub(crate) fn process_notify<F>(
        &self,
        req: NotifyRequest,
        pane_is_live: F,
    ) -> ProducerProcessResult
    where
        F: FnOnce(&str) -> bool,
    {
        let severity = match severity_from_type(&req.notification_type) {
            Some(severity) => severity,
            None => return ProducerProcessResult::Malformed("invalid notification type".into()),
        };
        if req.source.as_deref().is_some_and(|source| source != "plugin") {
            return ProducerProcessResult::Malformed("invalid source".into());
        }
        let cfg = self.notification_config();
        if cfg.enabled && req.category.as_deref() == Some("idle_reminder") && !cfg.idle_reminder {
            return ProducerProcessResult::Outcome(ProducerOutcome::Suppressed {
                reason: "idle_reminder_disabled".into(),
            });
        }
        if req.client_id.is_some() != req.request_id.is_some() {
            return ProducerProcessResult::Malformed(
                "clientId and requestId must be provided together".into(),
            );
        }
        let pane_id = req.pane_id.as_deref().filter(|id| !id.is_empty()).map(str::to_owned);
        if pane_id.as_ref().is_some_and(|id| Uuid::parse_str(id).is_err()) {
            return ProducerProcessResult::Malformed("invalid paneId".into());
        }

        let client_id = req.client_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
        let request_id = req.request_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
        if client_id.is_empty() || request_id.is_empty() {
            return ProducerProcessResult::Malformed("clientId/requestId must not be empty".into());
        }
        let payload_hash = payload_hash(&("producer.notify", &req));
        let key = (client_id.clone(), request_id.clone());
        let now = now_ms();
        let mut pane_is_live = Some(pane_is_live);
        // Hooks (spec §10) must fire exactly once, ONLY on a newly-accepted event - never on
        // suppressed/not_found/replay/conflict - and must run AFTER the ledger lock is released
        // (run_hooks takes the settings lock and spawns processes; it must not run under the
        // ledger mutex). Stash what to call here; fire it once the guard below is dropped.
        let mut accepted_hook: Option<(String, String, Option<String>, String)> = None;
        let result = {
            let mut ledger = self.ledger.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            match ledger.reserve(&client_id, &request_id, payload_hash, now) {
                ReserveResult::Replay(DedupOutcome::Producer(outcome)) => {
                    ProducerProcessResult::Outcome(outcome)
                }
                ReserveResult::Replay(_) | ReserveResult::Conflict => {
                    ProducerProcessResult::Conflict
                }
                // Only reachable during a zombie RESERVATION_TIMEOUT window under the synchronous
                // critical section. Per design C3-03 this must not be treated as a payload
                // conflict - it is retryable, not a genuine same-key-different-payload collision.
                ReserveResult::InFlight => ProducerProcessResult::Retry,
                ReserveResult::Reserved { generation } => {
                    let outcome = match evaluate_ingest_gate(&cfg, IngestSource::Plugin) {
                        IngestGateResult::Suppressed(reason) => {
                            ProducerOutcome::Suppressed { reason }
                        }
                        IngestGateResult::Accepted => {
                            if let Some(ref pane_id) = pane_id {
                                if !(pane_is_live.take().expect("liveness closure used once"))(
                                    pane_id,
                                ) {
                                    ProducerOutcome::NotFound
                                } else {
                                    let (event_seq, delta) =
                                        ledger.record_pane_event(pane_id, now, severity, now);
                                    let revision = delta.revision;
                                    self.broadcast(&SyncMsg::StateDelta { delta });
                                    self.broadcast(&SyncMsg::Notify {
                                        v: MIN_PROTOCOL_VERSION,
                                        pane_id: pane_id.clone(),
                                        title: req.title.clone(),
                                        body: req.body.clone(),
                                        notification_type: req.notification_type.clone(),
                                        event_seq: event_seq.to_string(),
                                        occurred_at: now,
                                        severity,
                                        notif_id: None,
                                    });
                                    self.event_bus.publish(BusEvent::Notify {
                                        pane_id: pane_id.clone(),
                                        title: req.title.clone(),
                                        body: req.body.clone(),
                                        notification_type: req.notification_type.clone(),
                                        severity: severity.as_str().into(),
                                        occurred_at: now,
                                    });
                                    accepted_hook = Some((
                                        req.notification_type.clone(),
                                        pane_id.clone(),
                                        req.title.clone(),
                                        req.body.clone(),
                                    ));
                                    ProducerOutcome::AcceptedPane {
                                        pane_id: pane_id.clone(),
                                        event_seq,
                                        revision,
                                    }
                                }
                            } else {
                                let notif_id = Uuid::new_v4().to_string();
                                let (event_seq, delta) =
                                    ledger.record_notif_event(&notif_id, now, severity, now);
                                let revision = delta.revision;
                                self.broadcast(&SyncMsg::StateDelta { delta });
                                self.broadcast(&SyncMsg::Notify {
                                    v: MIN_PROTOCOL_VERSION,
                                    pane_id: String::new(),
                                    title: req.title.clone(),
                                    body: req.body.clone(),
                                    notification_type: req.notification_type.clone(),
                                    event_seq: event_seq.to_string(),
                                    occurred_at: now,
                                    severity,
                                    notif_id: Some(notif_id.clone()),
                                });
                                self.event_bus.publish(BusEvent::Notify {
                                    pane_id: String::new(),
                                    title: req.title.clone(),
                                    body: req.body.clone(),
                                    notification_type: req.notification_type.clone(),
                                    severity: severity.as_str().into(),
                                    occurred_at: now,
                                });
                                accepted_hook = Some((
                                    req.notification_type.clone(),
                                    String::new(),
                                    req.title.clone(),
                                    req.body.clone(),
                                ));
                                ProducerOutcome::AcceptedNotif { notif_id, event_seq, revision }
                            }
                        }
                    };
                    let installed = ledger.complete(
                        &key,
                        generation,
                        DedupOutcome::Producer(outcome.clone()),
                        now,
                    );
                    debug_assert!(installed);
                    ProducerProcessResult::Outcome(outcome)
                }
            }
        };
        if let Some((notification_type, pane_id, title, body)) = accepted_hook {
            self.run_hooks(&notification_type, &pane_id, title.as_deref(), &body);
        }
        result
    }

    fn run_hooks(&self, notification_type: &str, pane_id: &str, title: Option<&str>, body: &str) {
        let hooks = {
            let guard = self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let Some(state) = guard.as_ref() else { return };
            let Ok(settings) = state.try_read() else { return };
            if !settings.notification.enabled {
                return;
            }
            settings.notification.hooks.clone()
        };

        for hook in hooks {
            if !hook.enabled || hook.command.is_empty() {
                continue;
            }
            if let Some(ref nt) = hook.notification_type {
                let nt_str =
                    serde_json::to_string(nt).unwrap_or_default().trim_matches('"').to_string();
                if nt_str != notification_type {
                    continue;
                }
            }
            let cmd = hook.command.clone();
            let env_type = notification_type.to_string();
            let env_pane = pane_id.to_string();
            let env_title = title.unwrap_or("").to_string();
            let env_body = body.to_string();

            tokio::spawn(async move {
                let hook_shell = shell::notification_hook_shell(&cmd);
                let mut command = tokio::process::Command::new(hook_shell.program);
                command.no_window().args(hook_shell.args);
                command
                    .env("DINOTTY_NOTIFICATION_TYPE", &env_type)
                    .env("DINOTTY_PANE_ID", &env_pane)
                    .env("DINOTTY_TITLE", &env_title)
                    .env("DINOTTY_BODY", &env_body);

                let result = tokio::time::timeout(Duration::from_secs(30), command.output()).await;
                match result {
                    Ok(Ok(output)) => {
                        if !output.status.success() {
                            tracing::warn!(
                                "Notification hook exited with {}: {}",
                                output.status,
                                String::from_utf8_lossy(&output.stderr)
                            );
                        }
                    }
                    Ok(Err(e)) => tracing::warn!("Notification hook failed: {e}"),
                    Err(_) => tracing::warn!("Notification hook timed out after 30s"),
                }
            });
        }
    }

    /// Broadcast a `SyncMsg` to every currently-connected sync client. Dead clients
    /// (whose `tx` has been dropped) are reaped. This mirrors `SessionManager::broadcast_sync`
    /// but operates on the shared `sync_clients` Arc the notifier was constructed with.
    #[allow(clippy::expect_used)]
    fn broadcast(&self, msg: &SyncMsg) {
        let json = serde_json::to_string(msg).expect("serialization is infallible");
        let mut clients =
            self.sync_clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        clients.retain(|c| c.tx.send(json.clone()).is_ok());
    }

    /// Send a `SyncMsg` to a single sync client by id. Used to route `MarkReadResult`
    /// back to the originator. Silently no-ops if the client has already disconnected
    /// (the writer task's `rx.recv()` loop will have returned None and the handler will
    /// unregister it shortly).
    #[allow(clippy::expect_used)]
    fn send_to_client(&self, client_id: &str, msg: &SyncMsg) {
        let json = serde_json::to_string(msg).expect("serialization is infallible");
        let clients = self.sync_clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        for client in clients.iter() {
            if client.id == client_id {
                let _ = client.tx.send(json);
                break;
            }
        }
    }
}

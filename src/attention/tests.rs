//! Blocking-waiter semantics belong to the integration layer and are not tested here.

use super::ledger::{
    evaluate_ingest_gate, AttentionLedger, DEDUP_TTL, IDENTITY_CAP, RESERVATION_TIMEOUT,
    UNREAD_CAP, UNREAD_TTL,
};
use super::types::{
    DedupOutcome, IngestGateResult, IngestSource, PaneDelta, ProducerOutcome, ReserveResult,
    Severity, TargetStatus,
};
use crate::settings::NotificationConfig;

fn ledger() -> AttentionLedger {
    AttentionLedger::with_epoch("epoch-a".into())
}

fn pane(id: &str, seq: u64) -> (String, u64) {
    (id.into(), seq)
}

#[test]
fn first_event_and_same_pane_keep_exact_first_unread_at() {
    let mut ledger = ledger();
    ledger.record_pane_event("p", 100, Severity::Info, 100);
    ledger.record_pane_event("p", 250, Severity::Urgent, 250);
    assert_eq!(ledger.first_unread_at("p"), Some(100));
    assert_eq!(ledger.panes["p"].unread.len(), 2);
}

#[test]
fn watermark_pop_is_exact_and_stale_receipt_cannot_clear_newer() {
    let mut ledger = ledger();
    let (first, _) = ledger.record_pane_event("p", 100, Severity::Info, 100);
    let (second, _) = ledger.record_pane_event("p", 200, Severity::Warning, 200);
    let (third, _) = ledger.record_pane_event("p", 300, Severity::Error, 300);
    let epoch = ledger.epoch.clone();

    let (delta, _, _) = ledger.mark_read(&epoch, &[pane("p", second)], &[], 400);
    assert!(delta.is_some());
    assert_eq!(ledger.first_unread_at("p"), Some(300));
    assert_eq!(ledger.panes["p"].read_through_seq, second);

    let (delta, results, applied) = ledger.mark_read(&epoch, &[pane("p", first)], &[], 500);
    assert!(delta.is_none());
    assert_eq!(results[0].status, TargetStatus::Applied);
    assert_eq!(applied, Some(ledger.revision));
    assert_eq!(ledger.panes["p"].unread.front().map(|event| event.seq), Some(third));
}

#[test]
fn union_of_reads_uses_max_watermark_and_replay_is_idempotent() {
    let mut ledger = ledger();
    let (_, _) = ledger.record_pane_event("p", 10, Severity::Info, 10);
    let (second, _) = ledger.record_pane_event("p", 20, Severity::Info, 20);
    let (third, _) = ledger.record_pane_event("p", 30, Severity::Info, 30);
    let epoch = ledger.epoch.clone();
    ledger.mark_read(&epoch, &[pane("p", second)], &[], 40);
    ledger.mark_read(&epoch, &[pane("p", third)], &[], 50);
    let revision = ledger.revision;
    let (delta, result, applied) = ledger.mark_read(&epoch, &[pane("p", second)], &[], 60);
    assert!(delta.is_none());
    assert_eq!(result[0].status, TargetStatus::Applied);
    assert_eq!(applied, Some(revision));
    assert_eq!(ledger.panes["p"].read_through_seq, third);
}

#[test]
fn invalid_watermark_is_rejected_not_clamped_per_target() {
    let mut ledger = ledger();
    let (latest, _) = ledger.record_pane_event("p", 10, Severity::Info, 10);
    let epoch = ledger.epoch.clone();
    let (delta, results, applied) =
        ledger.mark_read(&epoch, &[pane("p", latest + 1), pane("missing", 1)], &[], 20);
    assert!(delta.is_none());
    assert_eq!(results[0].status, TargetStatus::Invalid);
    assert_eq!(results[1].status, TargetStatus::NotFound);
    assert_eq!(applied, None);
    assert_eq!(ledger.panes["p"].read_through_seq, 0);
}

#[test]
fn foreign_epoch_is_stale_and_new_epoch_starts_empty() {
    let mut ledger = ledger();
    ledger.record_pane_event("p", 10, Severity::Info, 10);
    let (delta, results, applied) = ledger.mark_read("epoch-b", &[pane("p", 1)], &["n".into()], 20);
    assert!(delta.is_none());
    assert!(results.iter().all(|result| result.status == TargetStatus::StaleEpoch));
    assert_eq!(applied, None);
    let reset = AttentionLedger::with_epoch("epoch-b".into());
    assert!(reset.panes.is_empty());
    assert_eq!(reset.revision, 0);
}

#[test]
fn snapshot_matches_state_and_revisions_are_monotonic() {
    let mut ledger = ledger();
    let (_, first) = ledger.record_pane_event("p", 10, Severity::Warning, 10);
    let (_, second) = ledger.record_notif_event("n", 20, Severity::Error, 20);
    let snapshot = ledger.snapshot();
    assert!(first.revision < second.revision);
    assert_eq!(snapshot.revision, second.revision);
    assert_eq!(snapshot.panes, vec![ledger.pane_delta("p")]);
    assert_eq!(snapshot.notifs, vec![ledger.notif_delta("n")]);

    let json = serde_json::to_value(snapshot).unwrap();
    assert_eq!(json["revision"], "2");
    assert_eq!(json["panes"][0]["latestEventSeq"], "1");
}

#[test]
fn ingest_gate_table_covers_every_source_and_rule_predicate() {
    let mut cfg = NotificationConfig::default();
    assert_eq!(
        evaluate_ingest_gate(&cfg, IngestSource::Bell { debounce_duplicate: false }),
        IngestGateResult::Accepted
    );
    assert!(matches!(
        evaluate_ingest_gate(&cfg, IngestSource::Bell { debounce_duplicate: true }),
        IngestGateResult::Suppressed(_)
    ));
    assert_eq!(
        evaluate_ingest_gate(&cfg, IngestSource::OscNotify { debounce_duplicate: false }),
        IngestGateResult::Accepted
    );
    assert!(matches!(
        evaluate_ingest_gate(&cfg, IngestSource::CommandComplete { matched_rule: true }),
        IngestGateResult::Suppressed(_)
    ));
    cfg.command_complete.enabled = true;
    assert_eq!(
        evaluate_ingest_gate(&cfg, IngestSource::CommandComplete { matched_rule: true }),
        IngestGateResult::Accepted
    );
    assert!(matches!(
        evaluate_ingest_gate(&cfg, IngestSource::CommandComplete { matched_rule: false }),
        IngestGateResult::Suppressed(_)
    ));
    assert_eq!(
        evaluate_ingest_gate(&cfg, IngestSource::KeywordMatch { matched_rule: true }),
        IngestGateResult::Accepted
    );
    assert!(matches!(
        evaluate_ingest_gate(&cfg, IngestSource::KeywordMatch { matched_rule: false }),
        IngestGateResult::Suppressed(_)
    ));
    assert_eq!(evaluate_ingest_gate(&cfg, IngestSource::Plugin), IngestGateResult::Accepted);

    cfg.osc_notify = false;
    assert!(matches!(
        evaluate_ingest_gate(&cfg, IngestSource::OscNotify { debounce_duplicate: false }),
        IngestGateResult::Suppressed(_)
    ));
    cfg.bell.enabled = false;
    assert!(matches!(
        evaluate_ingest_gate(&cfg, IngestSource::Bell { debounce_duplicate: false }),
        IngestGateResult::Suppressed(_)
    ));
    cfg.enabled = false;
    assert!(matches!(
        evaluate_ingest_gate(&cfg, IngestSource::Plugin),
        IngestGateResult::Suppressed(_)
    ));
}

#[test]
fn plugin_target_models_are_distinct() {
    let mut ledger = ledger();
    ledger.record_notif_event("plugin-notif", 10, Severity::Info, 10);
    ledger.record_pane_event("plugin-pane", 20, Severity::Success, 20);
    assert!(ledger.notifs.contains_key("plugin-notif"));
    assert!(!ledger.notifs.contains_key("plugin-pane"));
    assert!(ledger.panes.contains_key("plugin-pane"));
}

#[test]
fn fully_read_entries_are_garbage_collected_after_retention() {
    let mut ledger = ledger();
    let (seq, _) = ledger.record_pane_event("p", 1, Severity::Info, 1);
    ledger.record_notif_event("n", 1, Severity::Info, 1);
    let epoch = ledger.epoch.clone();
    ledger.mark_read(&epoch, &[pane("p", seq)], &["n".into()], 10);
    let delta = ledger.sweep(10 + UNREAD_TTL).unwrap();
    assert!(ledger.panes.is_empty());
    assert!(ledger.notifs.is_empty());
    assert_eq!(delta.panes[0].removed, Some(true));
    assert_eq!(delta.notifs[0].removed, Some(true));
}

#[test]
fn unread_cap_drops_oldest_and_keeps_exact_next_head() {
    let mut ledger = ledger();
    for index in 0..=UNREAD_CAP {
        ledger.record_pane_event("p", index as u64, Severity::Info, index as u64);
    }
    assert_eq!(ledger.panes["p"].unread.len(), UNREAD_CAP);
    assert_eq!(ledger.first_unread_at("p"), Some(1));
}

#[test]
fn unread_ttl_transitions_pane_and_notif_to_read() {
    let mut ledger = ledger();
    let (seq, _) = ledger.record_pane_event("p", 10, Severity::Info, 10);
    ledger.record_notif_event("n", 10, Severity::Info, 10);
    let delta = ledger.sweep(10 + UNREAD_TTL).unwrap();
    assert_eq!(ledger.panes["p"].read_through_seq, seq);
    assert!(ledger.panes["p"].unread.is_empty());
    assert!(ledger.notifs["n"].read);
    assert_eq!(delta.panes.len(), 1);
    assert_eq!(delta.notifs.len(), 1);
}

#[test]
fn identity_cap_mixed_state_evicts_fully_read_first_even_pre_ttl() {
    let mut ledger = ledger();
    let (seq, _) = ledger.record_pane_event("read-me", 50, Severity::Info, 50);
    let epoch = ledger.epoch.clone();
    ledger.mark_read(&epoch, &[pane("read-me", seq)], &[], 1_000);
    for index in 0..(IDENTITY_CAP - 1) {
        ledger.record_pane_event(
            format!("live-{index}"),
            index as u64 + 100,
            Severity::Info,
            index as u64 + 100,
        );
    }
    ledger.record_pane_event("new-live", 2_000, Severity::Info, 2_000);
    assert!(!ledger.panes.contains_key("read-me"));
    assert!(ledger.panes.contains_key("live-0"));
    assert!(ledger.panes.contains_key("new-live"));
    assert_eq!(ledger.panes.len(), IDENTITY_CAP);
}

#[test]
fn all_unread_identity_cap_evicts_oldest_first_unread() {
    let mut ledger = ledger();
    for index in 0..=IDENTITY_CAP {
        ledger.record_pane_event(format!("p-{index}"), 10, Severity::Info, 10);
    }
    assert!(!ledger.panes.contains_key("p-0"));
    assert_eq!(ledger.panes.len(), IDENTITY_CAP);
}

#[test]
fn unread_notif_identity_cap_breaks_timestamp_ties_by_event_sequence() {
    let mut ledger = ledger();
    for index in 0..=IDENTITY_CAP {
        ledger.record_notif_event(format!("n-{index}"), 10, Severity::Info, 10);
    }
    assert!(!ledger.notifs.contains_key("n-0"));
    assert!(ledger.notifs.contains_key(&format!("n-{IDENTITY_CAP}")));
    assert_eq!(ledger.notifs.len(), IDENTITY_CAP);
}

#[test]
fn mutation_touch_expiry_is_folded_into_each_mutations_single_delta() {
    let mut pane_record = ledger();
    pane_record.record_pane_event("expired-pane", 0, Severity::Info, 0);
    pane_record.record_notif_event("expired-notif", 0, Severity::Info, 0);
    let before = pane_record.revision;
    let (_, delta) =
        pane_record.record_pane_event("fresh-pane", UNREAD_TTL, Severity::Success, UNREAD_TTL);
    assert_eq!(delta.revision, before + 1);
    assert_eq!(delta.panes.len(), 2);
    assert_eq!(delta.notifs.len(), 1);
    assert!(pane_record.panes["expired-pane"].unread.is_empty());
    assert!(pane_record.notifs["expired-notif"].read);

    let mut notif_record = ledger();
    notif_record.record_pane_event("expired-pane", 0, Severity::Info, 0);
    let before = notif_record.revision;
    let (_, delta) =
        notif_record.record_notif_event("fresh-notif", UNREAD_TTL, Severity::Success, UNREAD_TTL);
    assert_eq!(delta.revision, before + 1);
    assert_eq!(delta.panes.len(), 1);
    assert_eq!(delta.notifs.len(), 1);

    let mut mark_read = ledger();
    mark_read.record_notif_event("expired-notif", 0, Severity::Info, 0);
    let (seq, _) = mark_read.record_pane_event("live-pane", 1, Severity::Info, 1);
    let epoch = mark_read.epoch.clone();
    let before = mark_read.revision;
    let (delta, _, applied) =
        mark_read.mark_read(&epoch, &[pane("live-pane", seq)], &[], UNREAD_TTL);
    let delta = delta.unwrap();
    assert_eq!(delta.revision, before + 1);
    assert_eq!(applied, Some(delta.revision));
    assert_eq!(delta.panes.len(), 1);
    assert_eq!(delta.notifs.len(), 1);

    let mut pane_close = ledger();
    pane_close.record_notif_event("expired-notif", 0, Severity::Info, 0);
    pane_close.record_pane_event("closing-pane", 1, Severity::Info, 1);
    let before = pane_close.revision;
    let delta = pane_close.pane_closed("closing-pane", UNREAD_TTL).unwrap();
    assert_eq!(delta.revision, before + 1);
    assert_eq!(delta.panes, vec![PaneDelta::removed("closing-pane")]);
    assert_eq!(delta.notifs.len(), 1);
}

#[test]
fn pane_close_emits_removal_delta() {
    let mut ledger = ledger();
    ledger.record_pane_event("p", 10, Severity::Info, 10);
    let delta = ledger.pane_closed("p", 11).unwrap();
    assert_eq!(delta.panes, vec![PaneDelta::removed("p")]);
    assert!(!ledger.panes.contains_key("p"));
    assert!(ledger.pane_closed("p", 12).is_none());
}

fn suppressed(reason: &str) -> DedupOutcome {
    DedupOutcome::Producer(ProducerOutcome::Suppressed { reason: reason.into() })
}

fn key(client_id: &str, request_id: &str) -> (String, String) {
    (client_id.into(), request_id.into())
}

fn generation(result: ReserveResult) -> u64 {
    match result {
        ReserveResult::Reserved { generation } => generation,
        other => panic!("expected reservation, got {other:?}"),
    }
}

#[test]
fn dedup_in_flight_replay_and_conflict_state_machine() {
    let mut ledger = ledger();
    let generation = generation(ledger.reserve("c", "r", 7, 100));
    assert_eq!(ledger.reserve("c", "r", 7, 101), ReserveResult::InFlight);
    assert_eq!(ledger.reserve("c", "r", 8, 101), ReserveResult::Conflict);
    let outcome = suppressed("disabled");
    assert!(ledger.complete(&key("c", "r"), generation, outcome.clone(), 200));
    assert_eq!(ledger.reserve("c", "r", 7, 201), ReserveResult::Replay(outcome));
}

#[test]
fn reservation_timeout_reclaims_zombie_without_permanent_block() {
    let mut ledger = ledger();
    let first = generation(ledger.reserve("c", "r", 7, 100));
    assert_eq!(ledger.reserve("c", "r", 7, 100 + RESERVATION_TIMEOUT - 1), ReserveResult::InFlight);
    let second = generation(ledger.reserve("c", "r", 8, 100 + RESERVATION_TIMEOUT));
    assert_ne!(first, second);
    assert_eq!(ledger.dedup.len(), 1);
}

#[test]
fn dedup_ttl_starts_at_done_time_and_never_evicts_in_flight_early() {
    let mut ledger = ledger();
    ledger.reserve("c", "in-flight", 1, 0);
    let generation = generation(ledger.reserve("c", "done", 2, 0));
    ledger.complete(&key("c", "done"), generation, suppressed("x"), 1_000);
    ledger.sweep(DEDUP_TTL);
    assert!(ledger.dedup.contains_key(&("c".into(), "done".into())));
    assert!(!ledger.dedup.contains_key(&("c".into(), "in-flight".into())));
    ledger.sweep(1_000 + DEDUP_TTL);
    assert!(!ledger.dedup.contains_key(&("c".into(), "done".into())));
}

#[test]
fn suppressed_outcome_is_cached_across_settings_change() {
    let mut ledger = ledger();
    let mut cfg = NotificationConfig::default();
    cfg.enabled = false;
    let gate = evaluate_ingest_gate(&cfg, IngestSource::Plugin);
    assert!(matches!(gate, IngestGateResult::Suppressed(_)));
    let generation = generation(ledger.reserve("c", "r", 1, 0));
    let outcome = suppressed("notification_disabled");
    ledger.complete(&key("c", "r"), generation, outcome.clone(), 1);
    cfg.enabled = true;
    assert_eq!(evaluate_ingest_gate(&cfg, IngestSource::Plugin), IngestGateResult::Accepted);
    assert_eq!(ledger.reserve("c", "r", 1, 2), ReserveResult::Replay(outcome));
}

#[test]
fn multi_pane_batch_uses_one_revision_and_one_delta() {
    let mut ledger = ledger();
    let (a, _) = ledger.record_pane_event("a", 10, Severity::Info, 10);
    let (b, _) = ledger.record_pane_event("b", 20, Severity::Info, 20);
    let epoch = ledger.epoch.clone();
    let before = ledger.revision;
    let (delta, results, applied) =
        ledger.mark_read(&epoch, &[pane("a", a), pane("b", b)], &[], 30);
    let delta = delta.unwrap();
    assert_eq!(ledger.revision, before + 1);
    assert_eq!(delta.revision, ledger.revision);
    assert_eq!(applied, Some(ledger.revision));
    assert_eq!(delta.panes.len(), 2);
    assert!(results.iter().all(|result| result.status == TargetStatus::Applied));
}

#[test]
fn detached_style_reserved_mutation_can_commit_and_install_outcome() {
    let mut ledger = ledger();
    let generation = generation(ledger.reserve("c", "r", 1, 0));
    let (seq, delta) = ledger.record_pane_event("p", 10, Severity::Info, 10);
    let outcome = DedupOutcome::Producer(ProducerOutcome::AcceptedPane {
        pane_id: "p".into(),
        event_seq: seq,
        revision: delta.revision,
    });
    assert!(ledger.complete(&key("c", "r"), generation, outcome.clone(), 11));
    assert_eq!(ledger.reserve("c", "r", 1, 12), ReserveResult::Replay(outcome));
    assert_eq!(ledger.panes["p"].latest_event_seq, seq);
}

#[test]
fn stale_owner_completion_after_reclaim_is_rejected_without_mutation() {
    let mut ledger = ledger();
    let old_generation = generation(ledger.reserve("c", "r", 1, 100));
    let new_generation = generation(ledger.reserve("c", "r", 2, 100 + RESERVATION_TIMEOUT));
    let reclaimed_entry = ledger.dedup[&key("c", "r")].clone();

    assert!(!ledger.complete(&key("c", "r"), old_generation, suppressed("stale"), 200));
    assert_eq!(ledger.dedup[&key("c", "r")], reclaimed_entry);

    let outcome = suppressed("fresh");
    assert!(ledger.complete(&key("c", "r"), new_generation, outcome.clone(), 201));
    assert_eq!(ledger.reserve("c", "r", 2, 202), ReserveResult::Replay(outcome));
}

#[test]
fn completion_cannot_overwrite_already_done_entry() {
    let mut ledger = ledger();
    let generation = generation(ledger.reserve("c", "r", 1, 0));
    let original = suppressed("original");
    assert!(ledger.complete(&key("c", "r"), generation, original.clone(), 10));
    let done_entry = ledger.dedup[&key("c", "r")].clone();

    assert!(!ledger.complete(&key("c", "r"), generation, suppressed("replacement"), 20));
    assert_eq!(ledger.dedup[&key("c", "r")], done_entry);
    assert_eq!(ledger.reserve("c", "r", 1, 21), ReserveResult::Replay(original));
}

#[test]
fn completed_same_key_different_payload_is_conflict() {
    let mut ledger = ledger();
    let generation = generation(ledger.reserve("c", "r", 1, 0));
    assert!(ledger.complete(&key("c", "r"), generation, suppressed("cached"), 1));
    assert_eq!(ledger.reserve("c", "r", 2, 2), ReserveResult::Conflict);
}

#[test]
fn reclaim_then_fresh_reserve_cycle_completes_and_replays() {
    let mut ledger = ledger();
    let old_generation = generation(ledger.reserve("c", "r", 1, 0));
    let new_generation = generation(ledger.reserve("c", "r", 2, RESERVATION_TIMEOUT));
    assert_ne!(old_generation, new_generation);

    let outcome = suppressed("new-owner");
    assert!(ledger.complete(&key("c", "r"), new_generation, outcome.clone(), 31_000));
    assert_eq!(ledger.reserve("c", "r", 2, 31_001), ReserveResult::Replay(outcome));
}

#[test]
fn accepted_outcome_variants_preserve_exact_wire_shape() {
    let pane = serde_json::to_value(ProducerOutcome::AcceptedPane {
        pane_id: "p".into(),
        event_seq: 7,
        revision: 8,
    })
    .unwrap();
    assert_eq!(
        pane,
        serde_json::json!({
            "status": "accepted",
            "paneId": "p",
            "eventSeq": "7",
            "revision": "8"
        })
    );

    let notif = serde_json::to_value(ProducerOutcome::AcceptedNotif {
        notif_id: "n".into(),
        event_seq: 9,
        revision: 10,
    })
    .unwrap();
    assert_eq!(
        notif,
        serde_json::json!({
            "status": "accepted",
            "notifId": "n",
            "eventSeq": "9",
            "revision": "10"
        })
    );
}

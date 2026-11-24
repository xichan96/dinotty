/// Concurrency tests for the fit-then-snapshot reconnect path
/// (`Session::atomic_resize_and_snapshot_for_client`) and its interaction
/// with the other actors that touch the same locks in production: the PTY
/// reader (`screen.feed`), the broadcast task (`broadcast`), and the resize
/// debounce task (`apply_and_broadcast_resize`).
///
/// All tests use the `SessionBackend::Exited` stub, so no real PTY or child
/// process is spawned; `resize`/`resize_async` then only update `size` and the
/// virtual screen, which is exactly the state the snapshot contract depends on.
use super::test_support::{add_ready_client, stub_session};
use super::*;
use std::panic::AssertUnwindSafe;
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

/// Upper bound for any single worker in the concurrency tests. Generous for
/// CI; a deadlock holds a lock forever, so a timeout is a definitive failure.
const STORM_TIMEOUT: Duration = Duration::from_secs(15);

// ── helpers ─────────────────────────────────────────────────────

fn feed_screen(session: &Session, data: &[u8]) {
    session.screen.lock().unwrap_or_else(std::sync::PoisonError::into_inner).feed(data);
}

fn feed_lines(session: &Session, n: usize) {
    for i in 0..n {
        feed_screen(session, format!("L{i}\r\n").as_bytes());
    }
}

fn screen_dims(session: &Session) -> (usize, usize) {
    let screen = session.screen.lock().unwrap();
    (screen.cols(), screen.rows())
}

fn client_pending(session: &Session, client_id: u64) -> bool {
    session
        .clients
        .lock()
        .unwrap()
        .iter()
        .find(|client| client.id == client_id)
        .expect("client must be registered")
        .snapshot_pending
        .load(Ordering::Relaxed)
}

fn drain(rx: &mut mpsc::Receiver<SessionClientEvent>) -> Vec<SessionClientEvent> {
    std::iter::from_fn(|| rx.try_recv().ok()).collect()
}

/// Extract the viewport row count from a replay snapshot's scroll-out prefix
/// (`ESC [ rows ; 1 H`). Returns `None` when the snapshot has no scrollback
/// and therefore no scroll-out prefix.
fn scrollout_rows(snapshot: &str) -> Option<usize> {
    let rest = snapshot.strip_prefix("\x1b[?25l")?;
    let rest = rest.strip_prefix("\x1b[")?;
    let end = rest.find(";1H")?;
    rest[..end].parse().ok()
}

/// Run `f` on a detached thread that reports `true` on clean completion,
/// `false` on panic, and nothing on deadlock (detected by `recv_timeout`).
fn spawn_worker<F>(f: F) -> std_mpsc::Receiver<bool>
where
    F: FnOnce() + Send + 'static,
{
    let (done_tx, done_rx) = std_mpsc::channel();
    std::thread::spawn(move || {
        let ok = std::panic::catch_unwind(AssertUnwindSafe(f)).is_ok();
        let _ = done_tx.send(ok);
    });
    done_rx
}

async fn await_worker(name: &str, done: std_mpsc::Receiver<bool>) {
    let result =
        tokio::task::spawn_blocking(move || done.recv_timeout(STORM_TIMEOUT)).await.unwrap();
    match result {
        Ok(true) => {}
        Ok(false) => panic!("{name} worker panicked"),
        Err(std_mpsc::RecvTimeoutError::Timeout) => {
            panic!("{name} worker deadlocked (no completion within {STORM_TIMEOUT:?})")
        }
        Err(std_mpsc::RecvTimeoutError::Disconnected) => {
            panic!("{name} worker exited without reporting completion")
        }
    }
}

// ── wire-order contract ─────────────────────────────────────────

/// Fit-then-snapshot handshake: `atomic_resize_and_snapshot_for_client`
/// enqueues exactly one replay transaction - `ReplayBegin{cols, rows}` ->
/// scrollback chunks -> snapshot -> `ReplayEnd` - with the PTY size and the
/// virtual screen resized to the requested geometry. Output broadcast while
/// `snapshot_pending` is set is dropped (its effect is captured by the
/// snapshot); post-snapshot output lands after `ReplayEnd` via mpsc FIFO.
#[tokio::test]
async fn fit_then_snapshot_replays_scrollback_and_resumes_live_output() {
    let session = stub_session();
    feed_lines(&session, 30); // 24 rows -> L0..L6 in scrollback, L7..L29 on screen

    let (client_id, mut rx) = session.add_client();
    assert!(client_pending(&session, client_id), "add_client must start snapshot_pending");

    session.broadcast("PRE"); // must be dropped while snapshot_pending
    session
        .atomic_resize_and_snapshot_for_client(client_id, 100, 30, true)
        .await
        .expect("fit-then-snapshot must succeed");

    let events = drain(&mut rx);
    assert_eq!(
        events.len(),
        4,
        "expected ReplayBegin + 1 scrollback chunk + snapshot + ReplayEnd, got {events:?}"
    );
    assert!(matches!(events[0], SessionClientEvent::ReplayBegin { cols: 100, rows: 30 }));
    let SessionClientEvent::Output(chunk) = &events[1] else {
        panic!("expected scrollback chunk, got {:?}", events[1]);
    };
    for i in 0..7 {
        assert!(chunk.contains(&format!("L{i}\r\n")), "chunk must replay scrollback line L{i}");
    }
    let SessionClientEvent::Output(snapshot) = &events[2] else {
        panic!("expected snapshot payload, got {:?}", events[2]);
    };
    // The snapshot is taken at the NEW rows: it scrolls min(scrollback, rows-1)
    // = 7 pending lines out of the viewport before the absolute-addressed
    // redraw, addressing the new bottom row (30).
    let scroll_out = format!("\x1b[?25l\x1b[30;1H{}", "\n".repeat(7));
    assert!(
        snapshot.starts_with(&scroll_out),
        "snapshot must use the requested geometry, got prefix {:?}",
        &snapshot[..scroll_out.len().min(snapshot.len())]
    );
    assert!(snapshot.contains("L29"), "snapshot must contain the latest screen content");
    assert!(matches!(events[3], SessionClientEvent::ReplayEnd));

    // Fit applied to both the PTY size record and the virtual screen.
    assert_eq!(*session.size.lock().unwrap(), (100, 30));
    assert_eq!(screen_dims(&session), (100, 30));
    assert!(!client_pending(&session, client_id), "snapshot_pending must be cleared");

    session.broadcast("POST");
    let events = drain(&mut rx);
    assert!(
        matches!(&events[..], [SessionClientEvent::Output(data)] if data == "POST"),
        "live output must resume after ReplayEnd, got {events:?}"
    );
}

/// Snapshot content must reflect the requested cols/rows, not the pre-fit
/// geometry: shrinking 80x24 -> 60x10 pushes the top 14 screen rows into
/// scrollback (like a real terminal), so the replay contains those lines as
/// scrollback chunks and a viewport redraw addressed for the new 10-row
/// geometry with only the surviving rows on screen.
#[tokio::test]
async fn snapshot_content_reflects_requested_cols_and_rows() {
    let session = stub_session();
    feed_lines(&session, 30); // L0..L6 scrollback, L7..L29 on screen

    let (client_id, mut rx) = session.add_client();
    session
        .atomic_resize_and_snapshot_for_client(client_id, 60, 10, true)
        .await
        .expect("fit-then-snapshot must succeed");

    assert_eq!(*session.size.lock().unwrap(), (60, 10));
    assert_eq!(screen_dims(&session), (60, 10));

    let events = drain(&mut rx);
    assert!(matches!(events.first(), Some(SessionClientEvent::ReplayBegin { cols: 60, rows: 10 })));
    let SessionClientEvent::Output(chunk) = &events[1] else {
        panic!("expected scrollback chunk, got {:?}", events[1]);
    };
    // L0..L6 were already in scrollback; L7..L20 are pushed there by the shrink.
    assert!(chunk.contains("L0\r\n") && chunk.contains("L20\r\n"), "chunk: {chunk:?}");
    assert!(!chunk.contains("L21\r\n"), "surviving rows must not be in scrollback");
    let SessionClientEvent::Output(snapshot) = &events[2] else {
        panic!("expected snapshot payload, got {:?}", events[2]);
    };
    // Viewport now starts at L21; scroll-out addresses the NEW bottom row (10)
    // and scrolls min(21, 10-1) = 9 pending lines out.
    let scroll_out = format!("\x1b[?25l\x1b[10;1H{}", "\n".repeat(9));
    assert!(
        snapshot.starts_with(&scroll_out),
        "snapshot must be addressed for the new geometry, got prefix {:?}",
        &snapshot[..scroll_out.len().min(snapshot.len())]
    );
    assert!(snapshot.contains("L21") && snapshot.contains("L29"), "snapshot: {snapshot:?}");
    assert!(matches!(events.last(), Some(SessionClientEvent::ReplayEnd)));
}

/// Resize breaks synchronized-output mode (DEC 2026): the handshake flushes
/// the sync buffer and enqueues `SyncEnd` BEFORE the replay transaction, so a
/// reconnecting client never has replay chunks buffered behind active sync mode.
#[tokio::test]
async fn fit_then_snapshot_breaks_sync_mode_before_replay() {
    let session = stub_session();
    feed_screen(&session, b"sync-content");
    let (client_id, mut rx) = session.add_client();

    session.set_sync_mode(true);
    session.broadcast("BUF"); // buffered while sync is active
    session
        .atomic_resize_and_snapshot_for_client(client_id, 90, 28, true)
        .await
        .expect("fit-then-snapshot must succeed");

    // Control events bypass snapshot_pending, so the client sees the sync
    // teardown complete before the replay transaction starts. "BUF" itself is
    // dropped for this pending client (captured by the snapshot instead).
    let events = drain(&mut rx);
    let sync_end = events
        .iter()
        .position(|event| matches!(event, SessionClientEvent::SyncEnd))
        .expect("SyncEnd must be enqueued when resize breaks sync mode");
    let replay_begin = events
        .iter()
        .position(|event| matches!(event, SessionClientEvent::ReplayBegin { .. }))
        .expect("ReplayBegin must be enqueued");
    let replay_end = events
        .iter()
        .position(|event| matches!(event, SessionClientEvent::ReplayEnd))
        .expect("ReplayEnd must be enqueued");
    assert!(sync_end < replay_begin, "SyncEnd must precede ReplayBegin: {events:?}");
    assert!(replay_begin < replay_end);
    assert!(!session.is_sync_active());
}

/// The handshake fails cleanly (no panic, no hang) when the target client is
/// unknown or already disconnected - e.g. the WS dropped between
/// `SnapshotRequest` being sent and processed.
#[tokio::test]
async fn snapshot_for_unknown_or_disconnected_client_errors() {
    let session = stub_session();

    let err = session
        .atomic_resize_and_snapshot_for_client(9999, 80, 24, true)
        .await
        .expect_err("unknown client must be rejected");
    assert!(err.contains("not found"), "unexpected error: {err}");

    let (client_id, rx) = session.add_client();
    drop(rx); // closed channel is pruned from the client list
    let err = session
        .atomic_resize_and_snapshot_for_client(client_id, 80, 24, true)
        .await
        .expect_err("disconnected client must be rejected");
    assert!(err.contains("not found"), "unexpected error: {err}");
}

/// Liveness net: a client that never sends `SnapshotRequest` is recovered at the
/// session's current size by the watchdog path (`spawn_snapshot_watchdog` calls
/// `recover_snapshot_if_pending`). Live Output must resume afterwards instead
/// of being dropped forever.
#[test]
fn snapshot_recovery_clears_pending_at_current_size() {
    let session = stub_session();
    feed_lines(&session, 30);
    let (client_id, mut rx) = session.add_client();
    assert!(client_pending(&session, client_id), "add_client must start pending");

    assert!(session.recover_snapshot_if_pending(client_id));
    assert!(!client_pending(&session, client_id), "recovery must clear pending");

    let events = drain(&mut rx);
    assert!(
        matches!(events.first(), Some(SessionClientEvent::ReplayBegin { cols: 80, rows: 24 })),
        "recovery must replay at the current session size: {events:?}"
    );
    assert!(matches!(events.last(), Some(SessionClientEvent::ReplayEnd)));

    session.broadcast("LIVE");
    assert!(
        matches!(&drain(&mut rx)[..], [SessionClientEvent::Output(data)] if data == "LIVE"),
        "live output must resume after recovery"
    );

    // Second call is a no-op once the flag is clear.
    assert!(!session.recover_snapshot_if_pending(client_id));
}

/// A resize attempt on an exited session must not publish geometry or tell
/// peers about a size the backend never accepted.
#[test]
fn resize_on_exited_session_does_not_change_geometry_or_broadcast() {
    let session = stub_session();
    let (origin, _origin_rx) = add_ready_client(&session);
    let (_peer, mut peer_rx) = add_ready_client(&session);
    session.mark_exited();

    session.apply_and_broadcast_resize(origin, 100, 30);

    assert_eq!(*session.size.lock().unwrap(), (80, 24), "size must not change");
    assert_eq!(screen_dims(&session), (80, 24), "screen must not change");
    assert!(drain(&mut peer_rx).is_empty(), "peers must not receive a phantom resize");
}

/// The blocking resize publishes `size` and the virtual screen only after the
/// backend accepts it, keeping the three in lockstep.
#[test]
fn resize_blocking_publishes_matching_size_and_screen() {
    let session = stub_session();
    let outcome = session.resize_blocking(100, 30).expect("stub resize must succeed");
    assert_eq!(outcome, ResizeOutcome::Applied);
    assert_eq!(*session.size.lock().unwrap(), (100, 30));
    assert_eq!(screen_dims(&session), (100, 30));
}

/// Describes how the owner's grid is distributed to followers.
/// A peer claim always wins, resizes the PTY, and notifies the old owner.
#[tokio::test]
async fn claim_wins_and_notifies_the_previous_owner() {
    let session = stub_session();
    let (origin, mut origin_rx) = add_ready_client(&session);
    let (peer, mut peer_rx) = add_ready_client(&session);

    session.claim_and_resize(origin, 100, 30).await.expect("claim must apply");
    assert_eq!(session.size_owner_id(), Some(origin));
    assert_eq!(*session.size.lock().unwrap(), (100, 30));
    assert!(matches!(
        drain(&mut peer_rx).first(),
        Some(SessionClientEvent::Resize { cols: 100, rows: 30 })
    ));

    session.claim_and_resize(peer, 60, 20).await.expect("second claim must apply");
    assert_eq!(session.size_owner_id(), Some(peer));
    assert_eq!(*session.size.lock().unwrap(), (60, 20));
    assert_eq!(screen_dims(&session), (60, 20));
    assert!(matches!(
        drain(&mut origin_rx).first(),
        Some(SessionClientEvent::Resize { cols: 60, rows: 20 })
    ));
}

/// A same-size claim moves ownership without touching the PTY, but the previous
/// owner must still be told so it drops local ownership and can claim again.
#[tokio::test]
async fn same_size_claim_transfers_ownership_and_notifies_previous_owner() {
    let session = stub_session();
    let (owner, mut owner_rx) = add_ready_client(&session);
    let (claimer, mut claimer_rx) = add_ready_client(&session);
    session.claim_and_resize(owner, 100, 30).await.expect("claim must apply");
    let _ = drain(&mut owner_rx);
    let _ = drain(&mut claimer_rx);

    session.claim_and_resize(claimer, 100, 30).await.expect("same-size claim must apply");

    assert_eq!(*session.size.lock().unwrap(), (100, 30), "PTY must not move");
    assert_eq!(session.size_owner_id(), Some(claimer));
    assert!(
        matches!(
            drain(&mut owner_rx).first(),
            Some(SessionClientEvent::Resize { cols: 100, rows: 30 })
        ),
        "previous owner must receive the ownership notice"
    );

    // Repeated same-owner claims stay silent (no claim/reclaim loop).
    session.claim_and_resize(claimer, 100, 30).await.expect("repeat claim must apply");
    assert!(drain(&mut owner_rx).is_empty());
}

/// The same ownership notice applies when the claim arrives as a snapshot
/// request, which is how a reconnecting device claims.
#[tokio::test]
async fn same_size_claiming_snapshot_notifies_previous_owner() {
    let session = stub_session();
    let (owner, mut owner_rx) = add_ready_client(&session);
    let (claimer, mut claimer_rx) = add_ready_client(&session);
    session.claim_and_resize(owner, 100, 30).await.expect("claim must apply");
    let _ = drain(&mut owner_rx);
    let _ = drain(&mut claimer_rx);

    session
        .atomic_resize_and_snapshot_for_client(claimer, 100, 30, true)
        .await
        .expect("same-size claiming snapshot must succeed");

    assert_eq!(*session.size.lock().unwrap(), (100, 30));
    assert_eq!(session.size_owner_id(), Some(claimer));
    assert!(matches!(
        drain(&mut owner_rx).first(),
        Some(SessionClientEvent::Resize { cols: 100, rows: 30 })
    ));
    assert!(matches!(
        drain(&mut claimer_rx).first(),
        Some(SessionClientEvent::ReplayBegin { cols: 100, rows: 30 })
    ));
}

/// A non-owner's ordinary resize is ignored and answered with the owner size,
/// so the follower can adopt the real PTY grid instead of drifting.
#[tokio::test]
async fn non_owner_resize_is_rejected_and_returns_owner_size() {
    let session = stub_session();
    let (owner, _owner_rx) = add_ready_client(&session);
    let (follower, mut follower_rx) = add_ready_client(&session);
    session.claim_and_resize(owner, 100, 30).await.expect("claim must apply");
    let _ = drain(&mut follower_rx); // drop the claim broadcast

    let session_for_resize = Arc::clone(&session);
    tokio::task::spawn_blocking(move || {
        session_for_resize.apply_and_broadcast_resize(follower, 60, 20);
    })
    .await
    .expect("resize task must join");

    assert_eq!(*session.size.lock().unwrap(), (100, 30), "non-owner must not resize");
    assert_eq!(screen_dims(&session), (100, 30));
    assert_eq!(session.size_owner_id(), Some(owner));
    assert!(matches!(
        drain(&mut follower_rx).first(),
        Some(SessionClientEvent::Resize { cols: 100, rows: 30 })
    ));
}

/// A snapshot request without an ownership claim must replay at the current
/// owner size and leave the PTY untouched.
#[tokio::test]
async fn non_owner_snapshot_replays_at_owner_size() {
    let session = stub_session();
    let (owner, _owner_rx) = add_ready_client(&session);
    let (follower, mut follower_rx) = add_ready_client(&session);
    session.claim_and_resize(owner, 100, 30).await.expect("claim must apply");
    let _ = drain(&mut follower_rx);

    session
        .atomic_resize_and_snapshot_for_client(follower, 60, 20, false)
        .await
        .expect("non-owner snapshot must succeed");

    assert_eq!(*session.size.lock().unwrap(), (100, 30), "PTY must not move");
    assert_eq!(session.size_owner_id(), Some(owner));
    let events = drain(&mut follower_rx);
    assert!(
        matches!(events.first(), Some(SessionClientEvent::ReplayBegin { cols: 100, rows: 30 })),
        "replay must use the owner size: {events:?}"
    );
}

/// A claiming snapshot request takes ownership, resizes the PTY, and tells the
/// previous owner to follow.
#[tokio::test]
async fn claiming_snapshot_resizes_and_notifies_peers() {
    let session = stub_session();
    let (owner, mut owner_rx) = add_ready_client(&session);
    let (claimer, mut claimer_rx) = add_ready_client(&session);
    session.claim_and_resize(owner, 100, 30).await.expect("claim must apply");
    let _ = drain(&mut owner_rx);
    let _ = drain(&mut claimer_rx);

    session
        .atomic_resize_and_snapshot_for_client(claimer, 60, 20, true)
        .await
        .expect("claiming snapshot must succeed");

    assert_eq!(*session.size.lock().unwrap(), (60, 20));
    assert_eq!(session.size_owner_id(), Some(claimer));
    assert!(matches!(
        drain(&mut owner_rx).first(),
        Some(SessionClientEvent::Resize { cols: 60, rows: 20 })
    ));
    let events = drain(&mut claimer_rx);
    assert!(matches!(events.first(), Some(SessionClientEvent::ReplayBegin { cols: 60, rows: 20 })));
}

/// When the owner disconnects, ownership is released and the next resize wins.
#[tokio::test]
async fn owner_disconnect_releases_ownership() {
    let session = stub_session();
    let (owner, _owner_rx) = add_ready_client(&session);
    let (next, _next_rx) = add_ready_client(&session);
    session.claim_and_resize(owner, 100, 30).await.expect("claim must apply");

    session.remove_client(owner);
    assert_eq!(session.size_owner_id(), None);

    let session_for_resize = Arc::clone(&session);
    tokio::task::spawn_blocking(move || {
        session_for_resize.apply_and_broadcast_resize(next, 60, 20);
    })
    .await
    .expect("resize task must join");

    assert_eq!(*session.size.lock().unwrap(), (60, 20));
    assert_eq!(session.size_owner_id(), Some(next));
}

// ── concurrency ─────────────────────────────────────────────────

/// PTY output concurrent with the handshake must not corrupt the size
/// calculation: with feed/broadcast running continuously, every completed
/// handshake leaves `size` and the virtual screen at exactly the requested
/// geometry, and every replay snapshot on the wire is addressed for it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn feed_during_fit_and_snapshot_keeps_requested_dims() {
    const COLS: u16 = 100;
    const ROWS: u16 = 30;
    const SNAPSHOTS: usize = 50;

    let session = stub_session();
    feed_lines(&session, 40); // scrollback 17, stays non-empty throughout
    let (client_id, mut rx) = session.add_client();

    let feeder_session = Arc::clone(&session);
    let feeder = spawn_worker(move || {
        for _ in 0..600 {
            feed_screen(&feeder_session, b"live-output\r\n");
            feeder_session.broadcast("live");
        }
    });

    let snap_session = Arc::clone(&session);
    let snapshotter = tokio::spawn(async move {
        for _ in 0..SNAPSHOTS {
            snap_session
                .atomic_resize_and_snapshot_for_client(client_id, COLS, ROWS, true)
                .await
                .expect("fit-then-snapshot must succeed while the reader feeds");
            assert_eq!(*snap_session.size.lock().unwrap(), (COLS, ROWS));
            assert_eq!(screen_dims(&snap_session), (usize::from(COLS), usize::from(ROWS)));
        }
    });

    await_worker("feeder", feeder).await;
    tokio::time::timeout(STORM_TIMEOUT, snapshotter)
        .await
        .expect("snapshotter deadlocked")
        .expect("snapshotter panicked");

    let events = drain(&mut rx);
    let replays = events
        .iter()
        .filter(|event| matches!(event, SessionClientEvent::ReplayBegin { .. }))
        .count();
    assert!(replays > 0, "no replay transactions were delivered");
    for event in &events {
        match event {
            SessionClientEvent::ReplayBegin { cols, rows } => {
                assert_eq!((*cols, *rows), (COLS, ROWS), "replay dims drifted: {event:?}");
            }
            SessionClientEvent::Output(data) if data.starts_with("\x1b[?25l") => {
                assert_eq!(
                    scrollout_rows(data),
                    Some(usize::from(ROWS)),
                    "snapshot geometry drifted: {}",
                    &data[..40.min(data.len())]
                );
            }
            _ => {}
        }
    }
}

/// Full contention storm: concurrent resize (debounce path), PTY feed +
/// broadcast, and two simultaneous fit-then-snapshot handshakes must all
/// complete without deadlock or panic. Every observed replay transaction must
/// be addressed at a whole requested geometry - a snapshot must never be torn
/// between two concurrent resizes (e.g. rows from one, cols from another).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_resize_feed_and_snapshot_storm_completes() {
    const SIZES: [(u16, u16); 3] = [(100, 30), (80, 24), (60, 10)];
    const ITER: usize = 150;

    let session = stub_session();
    feed_lines(&session, 30);
    let (target_a, mut rx_a) = session.add_client();
    let (target_b, mut rx_b) = session.add_client();
    let (origin_id, _origin_rx) = add_ready_client(&session);

    // PTY reader stand-in: feed the screen, then broadcast raw output.
    let feeder_session = Arc::clone(&session);
    let feeder = spawn_worker(move || {
        for _ in 0..(ITER * 4) {
            feed_screen(&feeder_session, b"storm\r\n");
            feeder_session.broadcast("storm-data");
        }
    });

    // Resize debounce stand-in: apply_and_broadcast_resize from another client.
    let resize_session = Arc::clone(&session);
    let resizer = spawn_worker(move || {
        for i in 0..ITER {
            let (cols, rows) = SIZES[i % SIZES.len()];
            resize_session.apply_and_broadcast_resize(origin_id, cols, rows);
        }
    });

    // Two WS reconnect handshakes racing with each other and the above.
    let snap_session = Arc::clone(&session);
    let snap_a = tokio::spawn(async move {
        for i in 0..ITER {
            let (cols, rows) = SIZES[i % SIZES.len()];
            snap_session
                .atomic_resize_and_snapshot_for_client(target_a, cols, rows, true)
                .await
                .expect("handshake A must keep succeeding under contention");
        }
    });
    let snap_session = Arc::clone(&session);
    let snap_b = tokio::spawn(async move {
        for i in 0..ITER {
            let (cols, rows) = SIZES[SIZES.len() - 1 - (i % SIZES.len())];
            snap_session
                .atomic_resize_and_snapshot_for_client(target_b, cols, rows, true)
                .await
                .expect("handshake B must keep succeeding under contention");
        }
    });

    await_worker("feeder", feeder).await;
    await_worker("resizer", resizer).await;
    let (a, b) = tokio::join!(
        tokio::time::timeout(STORM_TIMEOUT, snap_a),
        tokio::time::timeout(STORM_TIMEOUT, snap_b),
    );
    a.expect("handshake A deadlocked").expect("handshake A panicked");
    b.expect("handshake B deadlocked").expect("handshake B panicked");

    // Every replay transaction observed on the wire is addressed at a whole
    // requested geometry, and every snapshot's scroll-out prefix matches a
    // requested row count - never a torn mix of two concurrent resizes.
    let mut replay_dims = Vec::new();
    let mut snapshot_rows = Vec::new();
    for event in drain(&mut rx_a).into_iter().chain(drain(&mut rx_b)) {
        match event {
            SessionClientEvent::ReplayBegin { cols, rows } => replay_dims.push((cols, rows)),
            SessionClientEvent::Output(data) if data.starts_with("\x1b[?25l") => {
                if let Some(rows) = scrollout_rows(&data) {
                    snapshot_rows.push(rows);
                }
            }
            _ => {}
        }
    }
    assert!(!replay_dims.is_empty(), "no replay transactions were delivered");
    for (cols, rows) in replay_dims {
        assert!(SIZES.contains(&(cols, rows)), "corrupt replay geometry: {cols}x{rows}");
    }
    assert!(!snapshot_rows.is_empty(), "no snapshots with scroll-out prefix were delivered");
    for rows in snapshot_rows {
        assert!(
            SIZES.iter().any(|&(_, candidate)| usize::from(candidate) == rows),
            "torn snapshot geometry: rows={rows}"
        );
    }

    // The session is still fully functional after the storm: one more
    // handshake completes and leaves a consistent geometry.
    session
        .atomic_resize_and_snapshot_for_client(target_a, 80, 24, true)
        .await
        .expect("post-storm handshake must succeed");
    assert_eq!(*session.size.lock().unwrap(), (80, 24));
    assert_eq!(screen_dims(&session), (80, 24));
    assert!(!client_pending(&session, target_a));
}

/// The blocking resize must not publish a `size` the backend has not accepted.
/// With the old `try_lock` implementation a contended backend silently skipped
/// the PTY resize while `size`/the virtual screen still moved to the requested
/// geometry, leaving the PTY and every client's grid disagreeing.
#[test]
fn resize_waits_for_the_backend_before_publishing_size() {
    let session = stub_session();
    let holder_session = Arc::clone(&session);
    let (acquired_tx, acquired_rx) = std_mpsc::channel();
    let holder = std::thread::spawn(move || {
        let _guard = holder_session.backend.blocking_lock();
        acquired_tx.send(()).expect("signal lock acquisition");
        std::thread::sleep(Duration::from_millis(300));
    });
    acquired_rx.recv().expect("backend lock must be acquired");

    let resize_session = Arc::clone(&session);
    let resizer = std::thread::spawn(move || resize_session.resize_blocking(100, 30));
    // While the backend is busy the resize must still be waiting, not published.
    std::thread::sleep(Duration::from_millis(100));

    let while_contended = *session.size.lock().unwrap();
    holder.join().unwrap();
    let outcome = resizer.join().unwrap().expect("resize must succeed after the lock frees");
    let after = *session.size.lock().unwrap();

    assert_eq!(while_contended, (80, 24), "size published before the backend accepted it");
    assert_eq!(outcome, ResizeOutcome::Applied);
    assert_eq!(after, (100, 30));
}

/// The watchdog calls `recover_snapshot_if_pending` for every attached client
/// shortly after attach. For a client that already completed its handshake this
/// must be a pure no-op: in particular it must not end an active synchronized
/// output (DEC 2026) block and cut a frame mid-draw. A genuinely pending client
/// still gets its recovery replay.
#[test]
fn recovery_keeps_sync_mode_when_nothing_is_pending() {
    let session = stub_session();
    let (ready, _ready_rx) = add_ready_client(&session);

    session.set_sync_mode(true);
    assert!(!session.recover_snapshot_if_pending(ready), "nothing pending, no replay");
    assert!(session.is_sync_active(), "no-op recovery must not break sync mode");

    let (pending, mut pending_rx) = session.add_client();
    assert!(session.recover_snapshot_if_pending(pending), "pending client must be recovered");
    assert!(!session.is_sync_active(), "a real recovery still ends sync mode");
    assert!(matches!(drain(&mut pending_rx).last(), Some(SessionClientEvent::ReplayEnd)));
}

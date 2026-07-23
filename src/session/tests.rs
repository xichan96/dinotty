use super::*;
use portable_pty::{Child, ChildKiller, ExitStatus, NativePtySystem, PtySize, PtySystem};
use std::io;

#[derive(Debug)]
struct TestChild;

impl ChildKiller for TestChild {
    fn kill(&mut self) -> io::Result<()> {
        Ok(())
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(Self)
    }
}

impl Child for TestChild {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        Ok(None)
    }

    fn wait(&mut self) -> io::Result<ExitStatus> {
        Ok(ExitStatus::with_exit_code(0))
    }

    fn process_id(&self) -> Option<u32> {
        None
    }

    #[cfg(windows)]
    fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
        None
    }
}

fn local_session_for_write_input() -> Arc<Session> {
    let pair = NativePtySystem::default()
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .unwrap();
    drop(pair.slave);

    let (resize_tx, _resize_rx) = watch::channel(None);
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    Arc::new(Session {
        backend: tokio::sync::Mutex::new(SessionBackend::Local {
            writer: Box::new(io::sink()),
            master: pair.master,
            child: Box::new(TestChild),
        }),
        ssh_params: None,
        screen: Mutex::new(VirtualScreen::new(80, 24)),
        clients: Mutex::new(Vec::new()),
        next_client_id: AtomicU64::new(1),
        tauri_client_id: Mutex::new(None),
        input_tx: Mutex::new(None),
        status: Mutex::new(SessionStatus::Connected),
        is_connected: AtomicBool::new(true),
        size: Mutex::new((80, 24)),
        exited: Mutex::new(false),
        shell_type: "test".to_string(),
        tauri_on_exit: Mutex::new(None),
        cwd_state: Mutex::new(CwdState { cwd: PathBuf::from("/"), sniff_buf: Vec::new() }),
        sync: Mutex::new(SyncState::default()),
        sync_disable_hook: Mutex::new(None),
        resize_tx,
        ssh_cmd_tx: Mutex::new(None),
        ssh_handle: tokio::sync::Mutex::new(None),
        sftp_session: Mutex::new(None),
        remote_home: Mutex::new(None),
        remote_user: Mutex::new(None),
        output_tx,
        output_rx: Mutex::new(Some(output_rx)),
        pending_results: Mutex::new(Vec::new()),
    })
}

/// Reproduction for PR #196: `write_input_sync` uses `try_lock` and reports
/// routine contention as a fatal error. The four long-lived writer tasks
/// treat any `Err` as fatal and `break`, so one unlucky moment kills the
/// keyboard for that pane permanently. This test pins the root cause:
/// when the backend lock is held (as happens every 200ms per pane during
/// child polling, and during resize), `write_input_sync` returns
/// `Err("backend lock held")`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn write_input_sync_errors_on_backend_contention() {
    let session = local_session_for_write_input();
    let _backend = session.backend.lock().await;

    let write_session = Arc::clone(&session);
    let result = tokio::task::spawn_blocking(move || write_session.write_input_sync(b"x"))
        .await
        .expect("spawn_blocking panicked");

    assert_eq!(result, Err("backend lock held".to_string()));
}

/// PR #196 fix: `write_input_blocking` uses `blocking_lock` so that routine
/// contention becomes a short wait instead of a fatal error. While the
/// backend lock is held, the call must NOT return within 50ms; once the
/// lock is released, it must complete with `Ok(())`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn write_input_blocking_waits_for_backend_lock() {
    let session = local_session_for_write_input();
    let backend = session.backend.lock().await;

    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let write_session = Arc::clone(&session);
    let mut writer = tokio::task::spawn_blocking(move || {
        let _ = started_tx.send(());
        write_session.write_input_blocking(b"blocking")
    });
    started_rx.await.unwrap();

    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut writer).await.is_err(),
        "write_input_blocking returned while backend lock was held"
    );

    drop(backend);
    assert_eq!(writer.await.expect("spawn_blocking panicked"), Ok(()));
}

// ── helpers ──────────────────────────────────────────────────────

fn leaf(id: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "leaf",
        "paneId": id,
        "title": "Terminal",
        "ratio": 1,
        "zoomed": false,
    })
}

fn leaf_with_kind(id: &str, kind: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "leaf",
        "kind": kind,
        "paneId": id,
        "title": "X",
        "ratio": 1,
        "zoomed": false,
    })
}

fn split(direction: &str, children: Vec<serde_json::Value>) -> serde_json::Value {
    let n = children.len();
    serde_json::json!({
        "type": "split",
        "id": "split-1",
        "direction": direction,
        "children": children,
        "ratios": (0..n).map(|_| serde_json::Value::from(1.0 / n as f64)).collect::<Vec<_>>(),
    })
}

// ── find_subslice ────────────────────────────────────────────────

#[test]
fn find_subslice_finds_needle() {
    assert_eq!(find_subslice(b"hello world", b"world"), Some(6));
}

#[test]
fn find_subslice_returns_none_when_absent() {
    assert_eq!(find_subslice(b"hello", b"xyz"), None);
}

#[test]
fn find_subslice_at_start() {
    assert_eq!(find_subslice(b"abcdef", b"abc"), Some(0));
}

#[test]
fn find_subslice_needle_longer_than_haystack() {
    assert_eq!(find_subslice(b"ab", b"abc"), None);
}

// ── parse_title_cwd ─────────────────────────────────────────────

#[test]
fn parse_title_cwd_absolute_path() {
    let home = PathBuf::from("/home/user");
    let result = parse_title_cwd("user@host:/var/log", &home);
    assert_eq!(result, Some(PathBuf::from("/var/log")));
}

#[test]
fn parse_title_cwd_home_shorthand() {
    let home = PathBuf::from("/home/user");
    let result = parse_title_cwd("user@host:~", &home);
    assert_eq!(result, Some(PathBuf::from("/home/user")));
}

#[test]
fn parse_title_cwd_relative_path() {
    let home = PathBuf::from("/home/user");
    let result = parse_title_cwd("user@host:projects/foo", &home);
    assert_eq!(result, Some(PathBuf::from("/home/user/projects/foo")));
}

#[test]
fn parse_title_cwd_home_slash_prefix() {
    let home = PathBuf::from("/home/user");
    let result = parse_title_cwd("user@host:~/code", &home);
    assert_eq!(result, Some(PathBuf::from("/home/user/code")));
}

#[test]
fn parse_title_cwd_no_at_sign() {
    let home = PathBuf::from("/home/user");
    assert_eq!(parse_title_cwd("no-at-sign", &home), None);
}

#[test]
fn parse_title_cwd_no_colon() {
    let home = PathBuf::from("/home/user");
    assert_eq!(parse_title_cwd("user@host-no-colon", &home), None);
}

#[test]
fn parse_title_cwd_empty_path() {
    let home = PathBuf::from("/home/user");
    assert_eq!(parse_title_cwd("user@host:", &home), None);
}

#[test]
fn parse_title_cwd_whitespace_trimmed() {
    let home = PathBuf::from("/home/user");
    let result = parse_title_cwd("user@host:  /tmp  ", &home);
    assert_eq!(result, Some(PathBuf::from("/tmp")));
}

#[cfg(windows)]
#[test]
fn parse_title_cwd_windows_drive_path() {
    let home = PathBuf::from(r"C:\Users\dev");
    let result = parse_title_cwd(r"user@host:C:\Users\dev\project", &home);
    assert_eq!(result, Some(PathBuf::from(r"C:\Users\dev\project")));
}

// ── sniff_cwd_from_title_osc ────────────────────────────────────

#[test]
fn sniff_cwd_extracts_from_bel_terminated_osc() {
    // Use a real directory and canonicalize the expected path, because
    // parse_title_cwd calls canonicalize() which resolves symlinks
    // (e.g. /tmp -> /private/tmp on macOS).
    let home = PathBuf::from("/home/user");
    let mut cwd = PathBuf::from("/home/user");
    let mut buf = Vec::new();
    // Use the real temp dir path so canonicalize succeeds
    let tmp = std::env::temp_dir();
    let tmp_str = tmp.to_string_lossy();
    let data = format!("\x1b]0;user@host:{}\x07", tmp_str);
    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd);
    assert_eq!(cwd, tmp.canonicalize().unwrap_or(tmp));
}

#[test]
fn sniff_cwd_extracts_from_st_terminated_osc() {
    let home = PathBuf::from("/home/user");
    let mut cwd = PathBuf::from("/home/user");
    let mut buf = Vec::new();
    let tmp = std::env::temp_dir();
    let tmp_str = tmp.to_string_lossy();
    let data = format!("\x1b]0;user@host:{}\x1b\\", tmp_str);
    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd);
    assert_eq!(cwd, tmp.canonicalize().unwrap_or(tmp));
}

#[test]
fn sniff_cwd_handles_chunked_input() {
    let home = PathBuf::from("/home/user");
    let mut cwd = PathBuf::from("/home/user");
    let mut buf = Vec::new();
    let target = std::env::temp_dir();
    let target_str = target.to_string_lossy();
    sniff_cwd_from_title_osc(&mut buf, b"\x1b]0;user", &home, &mut cwd);
    assert_eq!(cwd, PathBuf::from("/home/user")); // not yet
    let chunk = format!("@host:{target_str}\x07");
    sniff_cwd_from_title_osc(&mut buf, chunk.as_bytes(), &home, &mut cwd);
    assert_eq!(cwd, target.canonicalize().unwrap_or(target));
}

#[test]
fn sniff_cwd_buffers_beyond_cap() {
    let home = PathBuf::from("/home/user");
    let mut cwd = PathBuf::from("/home/user");
    let mut buf = Vec::new();
    // Fill buffer with garbage beyond the cap
    let big_data = vec![b'x'; OSC_SNIFF_CAP + 1000];
    sniff_cwd_from_title_osc(&mut buf, &big_data, &home, &mut cwd);
    assert!(buf.len() <= OSC_SNIFF_CAP);
}

#[cfg(windows)]
#[test]
fn sniff_cwd_accepts_powershell_title_with_windows_path() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().to_path_buf();
    let target = tmp.path().join("project");
    std::fs::create_dir(&target).unwrap();
    let mut cwd = home.clone();
    let mut buf = Vec::new();
    let data = format!("\x1b]0;user@host:{}\x07", target.display());

    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd);

    assert_eq!(cwd, target.canonicalize().unwrap());
}

#[cfg(windows)]
#[test]
fn sniff_cwd_buffers_chunked_powershell_title_with_windows_path() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().to_path_buf();
    let target = tmp.path().join("chunked-project");
    std::fs::create_dir(&target).unwrap();
    let mut cwd = home.clone();
    let mut buf = Vec::new();

    sniff_cwd_from_title_osc(&mut buf, b"\x1b]0;user@host:", &home, &mut cwd);
    assert_eq!(cwd, home);
    sniff_cwd_from_title_osc(
        &mut buf,
        format!("{}\x07", target.display()).as_bytes(),
        &home,
        &mut cwd,
    );

    assert_eq!(cwd, target.canonicalize().unwrap());
}

#[cfg(windows)]
#[test]
fn sniff_cwd_falls_back_to_raw_windows_path_when_missing() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().to_path_buf();
    let old_cwd = tmp.path().join("old");
    std::fs::create_dir(&old_cwd).unwrap();
    let missing = tmp.path().join("missing");
    let mut cwd = old_cwd.canonicalize().unwrap();
    let mut buf = Vec::new();
    let data = format!("\x1b]0;user@host:{}\x07", missing.display());

    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd);

    assert_eq!(cwd, missing);
}

// ── collect_leaf_pane_ids ────────────────────────────────────────

#[test]
fn collect_leaf_ids_single_leaf() {
    let layout = leaf("p1");
    assert_eq!(collect_leaf_pane_ids(&layout), vec!["p1"]);
}

#[test]
fn collect_leaf_ids_split_two() {
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    assert_eq!(collect_leaf_pane_ids(&layout), vec!["p1", "p2"]);
}

#[test]
fn collect_leaf_ids_nested_split() {
    let inner = split("vertical", vec![leaf("p2"), leaf("p3")]);
    let layout = split("horizontal", vec![leaf("p1"), inner]);
    assert_eq!(collect_leaf_pane_ids(&layout), vec!["p1", "p2", "p3"]);
}

#[test]
fn collect_leaf_ids_empty_unknown_type() {
    let layout = serde_json::json!({ "type": "unknown" });
    assert_eq!(collect_leaf_pane_ids(&layout), Vec::<String>::new());
}

// ── first_leaf_id ───────────────────────────────────────────────

#[test]
fn first_leaf_id_single() {
    assert_eq!(first_leaf_id(&leaf("p1")), Some("p1".into()));
}

#[test]
fn first_leaf_id_in_split() {
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    assert_eq!(first_leaf_id(&layout), Some("p1".into()));
}

#[test]
fn first_leaf_id_nested_takes_leftmost() {
    let inner = split("vertical", vec![leaf("p2"), leaf("p3")]);
    let layout = split("horizontal", vec![inner, leaf("p1")]);
    assert_eq!(first_leaf_id(&layout), Some("p2".into()));
}

#[test]
fn first_leaf_id_unknown_type() {
    let layout = serde_json::json!({ "type": "unknown" });
    assert_eq!(first_leaf_id(&layout), None);
}

// ── remove_pane_from_layout ─────────────────────────────────────

#[test]
fn remove_pane_removes_leaf() {
    let layout = leaf("p1");
    assert_eq!(remove_pane_from_layout(&layout, "p1"), None);
}

#[test]
fn remove_pane_keeps_other_leaf() {
    let layout = leaf("p1");
    let result = remove_pane_from_layout(&layout, "p2").unwrap();
    assert_eq!(result, layout);
}

#[test]
fn remove_pane_from_split_two_panes() {
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let result = remove_pane_from_layout(&layout, "p2").unwrap();
    // Single-child split collapses to the remaining child
    assert_eq!(result.get("type").unwrap(), "leaf");
    assert_eq!(result.get("paneId").unwrap(), "p1");
}

#[test]
fn remove_pane_from_split_three_panes() {
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2"), leaf("p3")]);
    let result = remove_pane_from_layout(&layout, "p2").unwrap();
    let children = result.get("children").unwrap().as_array().unwrap();
    assert_eq!(children.len(), 2);
    // Ratios should be rebalanced
    let ratios = result.get("ratios").unwrap().as_array().unwrap();
    assert_eq!(ratios.len(), 2);
}

#[test]
fn remove_pane_from_split_last_pane() {
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let result = remove_pane_from_layout(&layout, "p1");
    // p1 removed, only p2 left, single-child split collapses to p2
    let result = result.unwrap();
    assert_eq!(result.get("paneId").unwrap(), "p2");
}

#[test]
fn remove_pane_nested_split() {
    let inner = split("vertical", vec![leaf("p2"), leaf("p3")]);
    let layout = split("horizontal", vec![leaf("p1"), inner]);
    let result = remove_pane_from_layout(&layout, "p3").unwrap();
    let ids = collect_leaf_pane_ids(&result);
    assert_eq!(ids, vec!["p1", "p2"]);
}

// ── extract_leaf_from_layout ─────────────────────────────────────

#[test]
fn extract_leaf_finds_matching_leaf() {
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let extracted = extract_leaf_from_layout(&layout, "p2").unwrap();
    assert_eq!(extracted.get("paneId").unwrap(), "p2");
    assert_eq!(extracted.get("type").unwrap(), "leaf");
}

#[test]
fn extract_leaf_returns_none_for_missing_pane() {
    let layout = leaf("p1");
    assert!(extract_leaf_from_layout(&layout, "p_missing").is_none());
}

#[test]
fn extract_leaf_preserves_kind_field() {
    let plugin_leaf = leaf_with_kind("p1", "plugin");
    let layout = split("horizontal", vec![plugin_leaf, leaf("p2")]);
    let extracted = extract_leaf_from_layout(&layout, "p1").unwrap();
    assert_eq!(extracted.get("kind").unwrap(), "plugin");
    assert_eq!(extracted.get("paneId").unwrap(), "p1");
}

#[test]
fn extract_leaf_finds_in_nested_split() {
    let inner = split("vertical", vec![leaf("p2"), leaf("p3")]);
    let layout = split("horizontal", vec![leaf("p1"), inner]);
    let extracted = extract_leaf_from_layout(&layout, "p3").unwrap();
    assert_eq!(extracted.get("paneId").unwrap(), "p3");
}

// ── insert_pane_into_layout ─────────────────────────────────────

#[test]
fn insert_pane_splits_leaf() {
    let layout = leaf("p1");
    let result = insert_pane_into_layout(&layout, "p1", "horizontal", "p_new").unwrap();
    assert_eq!(result.get("type").unwrap(), "split");
    assert_eq!(result.get("direction").unwrap(), "horizontal");
    let children = result.get("children").unwrap().as_array().unwrap();
    assert_eq!(children.len(), 2);
    assert_eq!(children[0].get("paneId").unwrap(), "p1");
    assert_eq!(children[1].get("paneId").unwrap(), "p_new");
}

#[test]
fn insert_pane_returns_unchanged_if_target_not_in_leaf() {
    let layout = leaf("p1");
    let result = insert_pane_into_layout(&layout, "nonexistent", "horizontal", "p_new").unwrap();
    // Target not found — layout returned unchanged
    assert_eq!(result.get("paneId").unwrap(), "p1");
    assert_eq!(result.get("type").unwrap(), "leaf");
}

#[test]
fn insert_pane_into_existing_split() {
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let result = insert_pane_into_layout(&layout, "p2", "vertical", "p_new").unwrap();
    let ids = collect_leaf_pane_ids(&result);
    assert!(ids.contains(&"p1".to_string()));
    assert!(ids.contains(&"p2".to_string()));
    assert!(ids.contains(&"p_new".to_string()));
}

#[test]
fn insert_pane_preserves_non_target_leaves() {
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let result = insert_pane_into_layout(&layout, "p1", "vertical", "p3").unwrap();
    let ids = collect_leaf_pane_ids(&result);
    assert_eq!(ids.len(), 3);
}

#[test]
fn insert_pane_equalizes_ratios_same_direction() {
    // Splitting p2 horizontally in a horizontal split should flatten: [p1, p2, p_new]
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let result = insert_pane_into_layout(&layout, "p2", "horizontal", "p_new").unwrap();
    let children = result.get("children").unwrap().as_array().unwrap();
    assert_eq!(children.len(), 3, "same-direction split should flatten to 3 siblings");
    let ratios: Vec<f64> =
        result["ratios"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    assert_eq!(ratios.len(), 3);
    for r in &ratios {
        assert!((r - 1.0 / 3.0).abs() < 1e-10, "expected 1/3, got {r}");
    }
    let ids = collect_leaf_pane_ids(&result);
    assert_eq!(ids, vec!["p1", "p2", "p_new"]);
}

#[test]
fn insert_pane_nested_different_direction() {
    // Splitting p2 vertically in a horizontal split should nest: [p1, [p2, p_new]]
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let result = insert_pane_into_layout(&layout, "p2", "vertical", "p_new").unwrap();
    let children = result.get("children").unwrap().as_array().unwrap();
    assert_eq!(children.len(), 2, "different-direction split should nest");
    let inner = &children[1];
    assert_eq!(inner.get("type").unwrap(), "split");
    assert_eq!(inner.get("direction").unwrap(), "vertical");
    let inner_ids = collect_leaf_pane_ids(inner);
    assert_eq!(inner_ids, vec!["p2", "p_new"]);
}

// ── collect_terminal_leaf_pane_ids ───────────────────────────

#[test]
fn collect_terminal_leaf_pane_ids_pure_terminal() {
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let ids = collect_terminal_leaf_pane_ids(&layout);
    assert_eq!(ids, vec!["p1", "p2"]);
}

#[test]
fn collect_terminal_leaf_pane_ids_mixed_kinds() {
    let layout = split(
        "horizontal",
        vec![
            leaf_with_kind("p1", "terminal"),
            leaf_with_kind("p2", "plugin"),
            leaf_with_kind("p3", "files"),
            leaf_with_kind("p4", "web"),
        ],
    );
    let ids = collect_terminal_leaf_pane_ids(&layout);
    assert_eq!(ids, vec!["p1"]);
}

#[test]
fn collect_terminal_leaf_pane_ids_no_terminal() {
    let layout =
        split("horizontal", vec![leaf_with_kind("p1", "plugin"), leaf_with_kind("p2", "files")]);
    let ids = collect_terminal_leaf_pane_ids(&layout);
    assert!(ids.is_empty());
}

#[test]
fn collect_terminal_leaf_pane_ids_legacy_no_kind_defaults_terminal() {
    // leaf() helper omits kind - should default to terminal.
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let ids = collect_terminal_leaf_pane_ids(&layout);
    assert_eq!(ids, vec!["p1", "p2"]);
}

// ── ensure_leaf_kind ──────────────────────────────────────────

#[test]
fn ensure_leaf_kind_adds_terminal_when_absent() {
    let layout = leaf("p1");
    let result = ensure_leaf_kind(layout);
    assert_eq!(result.get("kind").unwrap(), "terminal");
}

#[test]
fn ensure_leaf_kind_preserves_existing_kind() {
    let layout = leaf_with_kind("p1", "plugin");
    let result = ensure_leaf_kind(layout);
    assert_eq!(result.get("kind").unwrap(), "plugin");
}

#[test]
fn ensure_leaf_kind_recurses_split_children() {
    let layout = split("horizontal", vec![leaf("p1"), leaf_with_kind("p2", "plugin")]);
    let result = ensure_leaf_kind(layout);
    let children = result.get("children").unwrap().as_array().unwrap();
    assert_eq!(children[0].get("kind").unwrap(), "terminal");
    assert_eq!(children[1].get("kind").unwrap(), "plugin");
}

// ── insert_subtree_into_layout ────────────────────────────────

#[test]
fn insert_subtree_right_target_in_leaf() {
    let layout = leaf("target");
    let subtree = leaf("new");
    let result = insert_subtree_into_layout(&layout, "target", "right", subtree).unwrap();
    assert_eq!(result.get("type").unwrap(), "split");
    // "right" is a position hint; the stored `direction` field is the axis.
    assert_eq!(result.get("direction").unwrap(), "horizontal");
    let children = result.get("children").unwrap().as_array().unwrap();
    assert_eq!(children.len(), 2);
    assert_eq!(children[0].get("paneId").unwrap(), "target");
    assert_eq!(children[1].get("paneId").unwrap(), "new");
}

#[test]
fn insert_subtree_top_normalizes_to_vertical() {
    let layout = leaf("target");
    let subtree = leaf("new");
    let result = insert_subtree_into_layout(&layout, "target", "top", subtree).unwrap();
    assert_eq!(result.get("type").unwrap(), "split");
    assert_eq!(result.get("direction").unwrap(), "vertical");
}

#[test]
fn insert_subtree_left_puts_subtree_first() {
    let layout = leaf("target");
    let subtree = leaf("new");
    let result = insert_subtree_into_layout(&layout, "target", "left", subtree).unwrap();
    let children = result.get("children").unwrap().as_array().unwrap();
    assert_eq!(children[0].get("paneId").unwrap(), "new", "left => subtree first");
    assert_eq!(children[1].get("paneId").unwrap(), "target");
}

#[test]
fn insert_subtree_top_puts_subtree_first() {
    let layout = leaf("target");
    let subtree = leaf("new");
    let result = insert_subtree_into_layout(&layout, "target", "top", subtree).unwrap();
    let children = result.get("children").unwrap().as_array().unwrap();
    assert_eq!(children[0].get("paneId").unwrap(), "new");
    assert_eq!(children[1].get("paneId").unwrap(), "target");
}

#[test]
fn insert_subtree_flattens_when_direction_matches_parent() {
    // Parent is horizontal [p1, p2]. Insert horizontal-split subtree at p2 with direction=horizontal.
    // Outer split (wrapping [p2, subtree]) flattens with parent.
    // Subtree's internal split is preserved (mode A: subtree internals preserved).
    // Result: horizontal [p1, p2, horizontal-split [a, b]]
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let subtree = split("horizontal", vec![leaf("a"), leaf("b")]);
    let result = insert_subtree_into_layout(&layout, "p2", "horizontal", subtree).unwrap();
    let ids = collect_leaf_pane_ids(&result);
    assert_eq!(ids, vec!["p1", "p2", "a", "b"]);

    // Verify structure: outer split has 3 children, last one is nested split.
    let children = result.get("children").unwrap().as_array().unwrap();
    assert_eq!(children.len(), 3, "outer split flattens, subtree preserved as nested");
    assert_eq!(children[0].get("paneId").unwrap(), "p1");
    assert_eq!(children[1].get("paneId").unwrap(), "p2");
    assert_eq!(children[2].get("type").unwrap(), "split");
    assert_eq!(children[2].get("direction").unwrap(), "horizontal");
    let nested = children[2].get("children").unwrap().as_array().unwrap();
    assert_eq!(nested.len(), 2);
}

#[test]
fn insert_subtree_preserves_subtree_internal_direction_when_different() {
    // Parent is horizontal. Insert vertical-split subtree at p2.
    // Should NOT flatten - nested vertical split preserved.
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    let subtree = split("vertical", vec![leaf("a"), leaf("b")]);
    let result = insert_subtree_into_layout(&layout, "p2", "horizontal", subtree).unwrap();
    let children = result.get("children").unwrap().as_array().unwrap();
    let nested = children
        .iter()
        .find(|c| c.get("direction").and_then(|v| v.as_str()) == Some("vertical"))
        .expect("should preserve nested vertical split");
    let nested_children = nested.get("children").unwrap().as_array().unwrap();
    assert_eq!(nested_children.len(), 2);
}

#[test]
fn insert_subtree_returns_unchanged_when_target_not_found() {
    let layout = leaf("p1");
    let subtree = leaf("new");
    let result = insert_subtree_into_layout(&layout, "nonexistent", "right", subtree).unwrap();
    assert_eq!(result.get("paneId").unwrap(), "p1");
    assert_eq!(result.get("type").unwrap(), "leaf");
}

#[test]
fn insert_subtree_into_nested_layout_finds_deep_target() {
    // Layout: [p1, [p2, p3]] (horizontal outer, vertical inner)
    let layout =
        split("horizontal", vec![leaf("p1"), split("vertical", vec![leaf("p2"), leaf("p3")])]);
    let subtree = leaf("new");
    let result = insert_subtree_into_layout(&layout, "p3", "right", subtree).unwrap();
    let ids = collect_leaf_pane_ids(&result);
    assert!(ids.contains(&"p1".to_string()));
    assert!(ids.contains(&"p2".to_string()));
    assert!(ids.contains(&"p3".to_string()));
    assert!(ids.contains(&"new".to_string()));
    assert_eq!(ids.len(), 4);
}

// ── SessionManager tab operations ───────────────────────────────

#[test]
fn insert_tab_and_list() {
    let manager = SessionManager::new();
    manager
        .insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1"), "active_pane_id": "p1"}));
    manager
        .insert_tab("t2".into(), serde_json::json!({"layout": leaf("p2"), "active_pane_id": "p2"}));

    // tab_layouts should have both
    assert!(manager.tab_layouts.contains_key("t1"));
    assert!(manager.tab_layouts.contains_key("t2"));

    // tab_order should have both in insertion order
    let order = manager.tab_order.lock().unwrap();
    assert_eq!(*order, vec!["t1", "t2"]);
    drop(order);
}

#[test]
fn insert_tab_idempotent() {
    let manager = SessionManager::new();
    manager.insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1")}));
    manager.insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1-updated")}));

    // Should not have duplicate entries in order
    let order = manager.tab_order.lock().unwrap();
    assert_eq!(order.len(), 1);
    drop(order);

    // Layout should be updated
    let val = manager.tab_layouts.get("t1").unwrap();
    assert_eq!(val.get("layout").unwrap().get("paneId").unwrap(), "p1-updated");
}

#[test]
fn remove_tab_cleans_up() {
    let manager = SessionManager::new();
    manager.insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1")}));
    manager.insert_tab("t2".into(), serde_json::json!({"layout": leaf("p2")}));
    manager.remove_tab("t1");

    assert!(!manager.tab_layouts.contains_key("t1"));
    let order = manager.tab_order.lock().unwrap();
    assert_eq!(*order, vec!["t2"]);
}

#[test]
fn remove_nonexistent_tab_no_panic() {
    let manager = SessionManager::new();
    manager.remove_tab("nonexistent"); // should not panic
}

// ── SessionManager::purge_pane_from_layouts ─────────────────────

#[test]
fn purge_pane_removes_from_layout() {
    let manager = SessionManager::new();
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    manager.insert_tab(
        "t1".into(),
        serde_json::json!({
            "layout": layout,
            "active_pane_id": "p1",
        }),
    );

    let emptied = manager.purge_pane_from_layouts("p2");
    assert!(emptied.is_empty()); // p1 still exists

    let val = manager.tab_layouts.get("t1").unwrap();
    let remaining = collect_leaf_pane_ids(val.get("layout").unwrap());
    assert_eq!(remaining, vec!["p1"]);
}

#[test]
fn purge_last_pane_marks_tab_empty() {
    let manager = SessionManager::new();
    manager.insert_tab(
        "t1".into(),
        serde_json::json!({
            "layout": leaf("p1"),
            "active_pane_id": "p1",
        }),
    );

    let emptied = manager.purge_pane_from_layouts("p1");
    assert_eq!(emptied, vec!["t1"]);
    assert!(!manager.tab_layouts.contains_key("t1"));
}

#[test]
fn purge_pane_ignores_tab_matching_pane_id() {
    // tab_layouts key == pane_id means it's a pseudo-tab from orphan sessions
    let manager = SessionManager::new();
    manager.insert_tab(
        "p1".into(),
        serde_json::json!({
            "layout": leaf("p1"),
        }),
    );

    let emptied = manager.purge_pane_from_layouts("p1");
    // The entry with key "p1" is skipped (tab_pane_id == pane_id guard)
    assert!(emptied.is_empty());
}

// ── SessionManager::broadcast_sync ──────────────────────────────

#[test]
fn broadcast_sync_delivers_to_clients() {
    let manager = SessionManager::new();
    let (id, mut rx) = manager.add_sync_client();
    assert!(!id.is_empty());

    manager.broadcast_sync(&SyncMsg::TabActivated { pane_id: "p1".into() });

    let msg = rx.try_recv().unwrap();
    assert!(msg.contains("TabActivated") || msg.contains("tab_activated"));
}

#[test]
fn broadcast_sync_others_excludes_client() {
    let manager = SessionManager::new();
    let (id1, mut rx1) = manager.add_sync_client();
    let (_id2, mut rx2) = manager.add_sync_client();

    manager.broadcast_sync_others(&SyncMsg::TabActivated { pane_id: "p1".into() }, &id1);

    // id1 should NOT receive the message
    assert!(rx1.try_recv().is_err());
    // id2 SHOULD receive the message
    assert!(rx2.try_recv().is_ok());
}

#[test]
fn broadcast_sync_removes_closed_clients() {
    let manager = SessionManager::new();
    let (_id, rx) = manager.add_sync_client();
    drop(rx); // close the receiver

    manager.broadcast_sync(&SyncMsg::TabActivated { pane_id: "p1".into() });

    // Client should have been pruned
    let clients = manager.sync_clients.lock().unwrap();
    assert!(clients.is_empty());
}

// ── SessionManager::on_pty_exited ───────────────────────────────

#[test]
fn on_pty_exited_single_pane_removes_tab() {
    let manager = SessionManager::new();
    manager.insert_tab(
        "t1".into(),
        serde_json::json!({
            "layout": leaf("p1"),
            "active_pane_id": "p1",
        }),
    );

    let result = manager.on_pty_exited("p1");
    assert_eq!(result, Some("t1".into()));
    assert!(!manager.tab_layouts.contains_key("t1"));
}

#[test]
fn on_pty_exited_multi_pane_updates_layout() {
    let manager = SessionManager::new();
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    manager.insert_tab(
        "t1".into(),
        serde_json::json!({
            "layout": layout,
            "active_pane_id": "p1",
        }),
    );

    let result = manager.on_pty_exited("p2");
    assert!(result.is_none()); // tab still exists

    let val = manager.tab_layouts.get("t1").unwrap();
    let remaining = collect_leaf_pane_ids(val.get("layout").unwrap());
    assert_eq!(remaining, vec!["p1"]);
}

#[test]
fn on_pty_exited_unknown_pane_returns_none() {
    let manager = SessionManager::new();
    assert!(manager.on_pty_exited("nonexistent").is_none());
}

// ── No pane limit ──────────────────────────────────────────────────

#[test]
fn insert_many_panes_into_layout() {
    // Verify there is no artificial limit — inserting many panes should work.
    let mut layout = leaf("p1");
    for i in 2..=12 {
        let new_id = format!("p{i}");
        let result = insert_pane_into_layout(&layout, "p1", "horizontal", &new_id);
        assert!(result.is_some(), "insert_pane should succeed for pane {i}");
        layout = result.unwrap();
    }
    let ids = collect_leaf_pane_ids(&layout);
    assert_eq!(ids.len(), 12);
}

// ── Tab list operations ────────────────────────────────────────────

#[test]
fn tab_list_prunes_stale_tabs() {
    let manager = SessionManager::new();
    // Insert tab without a matching session — tab_list should prune it
    manager
        .insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1"), "active_pane_id": "p1"}));
    let (tabs, _) = manager.tab_list();
    assert!(tabs.is_empty(), "tab without session should be pruned");
}

#[test]
fn tab_list_returns_empty_for_no_tabs() {
    let manager = SessionManager::new();
    let (tabs, active) = manager.tab_list();
    assert!(tabs.is_empty());
    assert!(active.is_none());
}

// ── CWD state tracking ─────────────────────────────────────────────

#[test]
fn cwd_state_default_path() {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let state = CwdState { cwd: home.clone(), sniff_buf: Vec::new() };
    assert_eq!(state.cwd, home);
}

#[test]
fn sniff_cwd_updates_cwd_state() {
    let home = PathBuf::from("/");
    let mut cwd = home.clone();
    let mut buf = Vec::new();
    let target = std::env::temp_dir();
    let target_str = target.to_string_lossy();
    // OSC 0: \x1b]0;user@host:path\x07
    let data = format!("\x1b]0;user@host:{target_str}\x07");
    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd);
    assert_eq!(cwd, target.canonicalize().unwrap_or(target));
}

#[test]
fn sniff_cwd_falls_back_to_raw_path_when_canonicalize_fails() {
    let home = PathBuf::from("/");
    let mut cwd = home.clone();
    let mut buf = Vec::new();
    // Path does not exist — canonicalize() fails; the raw path is used as fallback so SSH remote cwd tracking still works (a89eb0a4)
    sniff_cwd_from_title_osc(
        &mut buf,
        b"\x1b]0;user@host:/nonexistent_path_12345\x07",
        &home,
        &mut cwd,
    );
    assert_eq!(cwd, PathBuf::from("/nonexistent_path_12345"));
}

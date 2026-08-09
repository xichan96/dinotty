use super::*;

// ── helpers ──────────────────────────────────────────────────────

pub(super) fn leaf(id: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "leaf",
        "paneId": id,
        "title": "Terminal",
        "ratio": 1,
        "zoomed": false,
    })
}

pub(super) fn leaf_with_kind(id: &str, kind: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "leaf",
        "kind": kind,
        "paneId": id,
        "title": "X",
        "ratio": 1,
        "zoomed": false,
    })
}

pub(super) fn split(direction: &str, children: Vec<serde_json::Value>) -> serde_json::Value {
    let n = children.len();
    serde_json::json!({
        "type": "split",
        "id": "split-1",
        "direction": direction,
        "children": children,
        "ratios": (0..n).map(|_| serde_json::Value::from(1.0 / n as f64)).collect::<Vec<_>>(),
    })
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
    // Target not found - layout returned unchanged
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

// ── No pane limit ──────────────────────────────────────────────────

#[test]
fn insert_many_panes_into_layout() {
    // Verify there is no artificial limit - inserting many panes should work.
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

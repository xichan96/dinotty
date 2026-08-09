use super::*;

#[test]
fn test_workspace_serialization_roundtrip() {
    let ws = Workspace {
        id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        name: "dinotty".to_string(),
        path: "/Users/talentc/rust/dinotty".to_string(),
        order: 0,
        connection_id: None,
        abbr: None,
        color: None,
    };
    let json = serde_json::to_string(&ws).unwrap();
    let deserialized: Workspace = serde_json::from_str(&json).unwrap();
    assert_eq!(ws, deserialized);
}

#[test]
fn test_workspace_serialization_with_connection_id() {
    let ws = Workspace {
        id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        name: "remote-project".to_string(),
        path: "/home/deploy/app".to_string(),
        order: 0,
        connection_id: Some("ssh-profile-123".to_string()),
        abbr: None,
        color: None,
    };
    let json = serde_json::to_string(&ws).unwrap();
    assert!(json.contains("connection_id"));
    let deserialized: Workspace = serde_json::from_str(&json).unwrap();
    assert_eq!(ws, deserialized);
}

#[test]
fn test_workspace_backward_compat_deserialize_without_connection_id() {
    // Existing workspaces.json files without connection_id should still parse
    let json = r#"{"id":"aaa","name":"test","path":"/tmp","order":0}"#;
    let ws: Workspace = serde_json::from_str(json).unwrap();
    assert_eq!(ws.connection_id, None);
}

#[test]
fn test_workspace_list_serialization() {
    let workspaces = vec![
        Workspace {
            id: "aaa".to_string(),
            name: "first".to_string(),
            path: "/tmp/first".to_string(),
            order: 0,
            connection_id: None,
            abbr: None,
            color: None,
        },
        Workspace {
            id: "bbb".to_string(),
            name: "second".to_string(),
            path: "/tmp/second".to_string(),
            order: 1,
            connection_id: None,
            abbr: None,
            color: None,
        },
    ];
    let json = serde_json::to_string(&workspaces).unwrap();
    let deserialized: Vec<Workspace> = serde_json::from_str(&json).unwrap();
    assert_eq!(workspaces, deserialized);
}

#[test]
fn test_derive_name_basic() {
    assert_eq!(derive_name("/Users/talentc/rust/dinotty"), "dinotty");
    assert_eq!(derive_name("/home/user/projects/my-app"), "my-app");
    assert_eq!(derive_name("/tmp"), "tmp");
}

#[test]
fn test_derive_name_trailing_slash() {
    assert_eq!(derive_name("/Users/talentc/rust/dinotty/"), "dinotty");
    assert_eq!(derive_name("/tmp/"), "tmp");
}

#[test]
fn test_derive_name_root() {
    assert_eq!(derive_name("/"), "root");
}

#[test]
fn test_validate_path_rejects_relative() {
    let result = validate_workspace_path("relative/path");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("absolute"));
}

#[test]
fn test_validate_path_rejects_empty() {
    let result = validate_workspace_path("");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("empty"));
}

#[test]
fn test_validate_path_rejects_whitespace_only() {
    let result = validate_workspace_path("   ");
    assert!(result.is_err());
}

#[test]
#[cfg(unix)]
fn test_validate_path_rejects_sensitive_dirs() {
    for dir in &["/", "/etc", "/sys", "/proc", "/dev", "/bin", "/sbin", "/usr"] {
        let result = validate_workspace_path(dir);
        assert!(result.is_err(), "should reject {dir}");
        assert!(
            result.unwrap_err().contains("sensitive"),
            "error for {dir} should mention sensitive"
        );
    }
}

#[test]
fn test_validate_path_rejects_nonexistent() {
    let missing = std::env::temp_dir().join("dinotty_nonexistent_path_that_does_not_exist");
    let result = validate_workspace_path(&missing.to_string_lossy());
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("invalid path"));
}

#[test]
fn test_validate_path_accepts_real_dir() {
    let temp_dir = std::env::temp_dir();
    let result = validate_workspace_path(&temp_dir.to_string_lossy());
    assert!(result.is_ok());
    // Should be canonicalized
    let canonical = result.unwrap();
    assert!(canonical.is_absolute());
    assert!(canonical.is_dir());
}

#[test]
#[cfg(windows)]
fn test_validate_path_simplifies_windows_verbatim_prefix() {
    let temp_dir = std::env::temp_dir();
    let canonical = validate_workspace_path(&temp_dir.to_string_lossy()).unwrap();

    assert!(!canonical.to_string_lossy().starts_with(r"\\?\"));
}

#[test]
fn test_simplify_local_workspace_paths_preserves_remote_paths() {
    let remote_path = r"\\?\C:\remote\project";
    let mut workspaces = vec![Workspace {
        id: "remote".to_string(),
        name: "remote".to_string(),
        path: remote_path.to_string(),
        order: 0,
        connection_id: Some("ssh-profile".to_string()),
        abbr: None,
        color: None,
    }];

    simplify_local_workspace_paths(&mut workspaces);

    assert_eq!(workspaces[0].path, remote_path);
}

#[test]
#[cfg(windows)]
fn test_simplify_local_workspace_paths_updates_legacy_windows_paths_in_memory() {
    let mut workspaces = vec![Workspace {
        id: "local".to_string(),
        name: "local".to_string(),
        path: r"\\?\C:\repo\dinotty".to_string(),
        order: 0,
        connection_id: None,
        abbr: None,
        color: None,
    }];

    simplify_local_workspace_paths(&mut workspaces);

    assert_eq!(workspaces[0].path, r"C:\repo\dinotty");
}

#[test]
fn test_derive_name_with_special_chars() {
    assert_eq!(derive_name("/home/user/my project"), "my project");
    assert_eq!(derive_name("/home/user/项目"), "项目");
}

#[test]
fn test_fnv1a32_vectors_and_palette_indices() {
    assert_eq!(fnv1a32("a"), 0xe40c_292c);
    assert_eq!(fnv1a32(""), 0x811c_9dc5);
    assert_eq!(fnv1a32("hello"), 0x4f9f_2cab);

    for (input, expected) in [
        ("a", 5),
        ("workspace", 3),
        ("dinotty", 3),
        ("00000000-0000-4000-8000-000000000000", 2),
        ("11111111-2222-4333-8444-555555555555", 4),
        ("ws-abc", 2),
        ("hello", 2),
        ("", 2),
        ("z", 0),
    ] {
        assert_eq!(fnv1a32(input) % 7, expected, "input: {input}");
    }
}

#[test]
fn test_palette_color_for_id() {
    assert_eq!(palette_color_for("dinotty"), "#98C379");
}

#[test]
fn test_normalize_abbr() {
    assert_eq!(normalize_abbr("\u{200B}\u{200B}"), None);
    assert_eq!(normalize_abbr("  "), None);
    assert_eq!(normalize_abbr("abcd"), Some("abc".to_string()));
    assert_eq!(normalize_abbr("工作区项目"), Some("工作区".to_string()));
    assert_eq!(normalize_abbr(""), None);
}

#[test]
fn test_normalize_color() {
    assert_eq!(normalize_color("#ff5d5d"), Some("#FF5D5D".to_string()));
    assert_eq!(normalize_color("#GGGGGG"), None);
    assert_eq!(normalize_color(""), None);
    assert_eq!(normalize_color("#FF5D5D80"), None);
    assert_eq!(normalize_color("FF5D5D"), None);
}

#[test]
fn test_migrate_colors_is_idempotent() {
    let id = "legacy-workspace".to_string();
    let mut workspaces = vec![Workspace {
        id: id.clone(),
        name: "legacy".to_string(),
        path: "/tmp/legacy".to_string(),
        order: 0,
        connection_id: None,
        abbr: None,
        color: None,
    }];

    assert!(migrate_colors(&mut workspaces));
    assert_eq!(workspaces[0].color, Some(palette_color_for(&id)));
    assert!(!migrate_colors(&mut workspaces));
}

#[test]
fn test_workspace_backward_compat_without_icon_fields() {
    let json = r#"[{"id":"aaa","name":"test","path":"/tmp","order":0}]"#;
    let workspaces: Vec<Workspace> = serde_json::from_str(json).unwrap();
    assert_eq!(workspaces[0].abbr, None);
    assert_eq!(workspaces[0].color, None);
}

#[test]
fn test_workspace_palette_is_pinned_uppercase_hex6() {
    assert_eq!(WORKSPACE_PALETTE.len(), 7);
    for color in WORKSPACE_PALETTE {
        assert!(is_valid_hex6(color), "invalid palette color: {color}");
        assert_eq!(color, color.to_uppercase(), "palette color is not uppercase: {color}");
    }
}

// ---------------------------------------------------------------------------
// tab_workspace_id
// ---------------------------------------------------------------------------

fn ws_local(id: &str, path: &str) -> Workspace {
    Workspace {
        id: id.to_string(),
        name: id.to_string(),
        path: path.to_string(),
        order: 0,
        connection_id: None,
        abbr: None,
        color: None,
    }
}

fn ws_remote(id: &str, path: &str, connection_id: &str) -> Workspace {
    Workspace {
        id: id.to_string(),
        name: id.to_string(),
        path: path.to_string(),
        order: 0,
        connection_id: Some(connection_id.to_string()),
        abbr: None,
        color: None,
    }
}

#[test]
fn tab_workspace_id_local_tab_longest_prefix_wins() {
    let workspaces = vec![ws_local("outer", "/Users/me"), ws_local("inner", "/Users/me/work")];
    assert_eq!(
        tab_workspace_id(&workspaces, Some("/Users/me/work/project"), None),
        Some("inner".to_string())
    );
    assert_eq!(
        tab_workspace_id(&workspaces, Some("/Users/me/other"), None),
        Some("outer".to_string())
    );
}

#[test]
fn tab_workspace_id_no_match_returns_none() {
    let workspaces = vec![ws_local("ws1", "/Users/me/work")];
    assert_eq!(tab_workspace_id(&workspaces, Some("/tmp"), None), None);
    assert_eq!(tab_workspace_id(&workspaces, None, None), None);
    assert_eq!(tab_workspace_id(&workspaces, Some(""), None), None);
}

#[test]
fn tab_workspace_id_sibling_prefix_not_match() {
    // `/etcfoo` should NOT match workspace at `/etc` (no path separator)
    let workspaces = vec![ws_local("etc", "/etc")];
    assert_eq!(tab_workspace_id(&workspaces, Some("/etcfoo"), None), None);
}

#[test]
fn tab_workspace_id_ssh_tab_matches_by_connection_id() {
    let workspaces = vec![
        ws_local("local", "/Users/me"),
        ws_remote("remote", "/home/deploy/app", "ssh-profile-1"),
    ];
    assert_eq!(
        tab_workspace_id(&workspaces, Some("/Users/me"), Some("ssh-profile-1")),
        Some("remote".to_string())
    );
    // SSH tab with connection_id that matches no workspace -> default (None)
    assert_eq!(tab_workspace_id(&workspaces, Some("/Users/me"), Some("unknown-profile")), None);
}

#[test]
fn tab_workspace_id_local_tab_skips_remote_workspaces() {
    // Local tab (no connection_id) should not match a remote workspace even
    // if its path happens to prefix-match.
    let workspaces = vec![ws_remote("remote", "/Users/me", "ssh-profile-1")];
    assert_eq!(tab_workspace_id(&workspaces, Some("/Users/me/project"), None), None);
}

#[test]
fn tab_workspace_id_trailing_slash_on_workspace_path_is_tolerated() {
    let workspaces = vec![ws_local("ws1", "/Users/me/work/")];
    assert_eq!(
        tab_workspace_id(&workspaces, Some("/Users/me/work/project"), None),
        Some("ws1".to_string())
    );
}

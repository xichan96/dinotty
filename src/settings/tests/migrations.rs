use super::super::types::KeyboardGuardMode;
use super::super::*;

#[test]
fn v7_migrates_all_legacy_keyboard_guard_values_idempotently_and_stably() {
    for (legacy_json, expected) in [
        (
            r#"{"settings_version":6,"keyboard_keep_on_scroll":true}"#,
            KeyboardGuardMode::CollapseOnly,
        ),
        (r#"{"settings_version":6,"keyboard_keep_on_scroll":false}"#, KeyboardGuardMode::Off),
        (r#"{"settings_version":6}"#, KeyboardGuardMode::Off),
    ] {
        let mut settings: Settings = serde_json::from_str(legacy_json).unwrap();

        assert!(migrate_settings(&mut settings));
        assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
        assert_eq!(settings.keyboard_guard_mode, expected);
        assert!(!migrate_settings(&mut settings));

        let first_save = serde_json::to_string(&settings).unwrap();
        assert!(!first_save.contains("keyboard_keep_on_scroll"));
        let mut loaded: Settings = serde_json::from_str(&first_save).unwrap();
        assert!(!migrate_settings(&mut loaded));
        let second_save = serde_json::to_string(&loaded).unwrap();

        assert_eq!(second_save.as_bytes(), first_save.as_bytes());
    }
}

#[test]
fn legacy_keyboard_bool_deserialization_is_field_local_and_tolerant() {
    for invalid in [serde_json::Value::Null, serde_json::json!("yes"), serde_json::json!(1)] {
        let json = serde_json::json!({
            "settings_version": 6,
            "keyboard_keep_on_scroll": invalid,
            "locale": "en"
        });
        let mut settings: Settings = serde_json::from_value(json).unwrap();

        assert!(!settings.keyboard_keep_on_scroll);
        assert_eq!(settings.locale, "en");
        assert!(migrate_settings(&mut settings));
        assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
        assert_eq!(settings.keyboard_guard_mode, KeyboardGuardMode::Off);
        assert_eq!(settings.locale, "en");
    }
}

#[test]
fn v8_clone_flows_into_v9_system_upper_once() {
    let mut settings: Settings = serde_json::from_str(
        r#"{"settings_version":7,"toolbar_quick_keys":[{"label":"Esc","send":"\\u001b"}]}"#,
    )
    .unwrap();

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert!(settings.system_toolbar_quick_keys.is_empty());
    let system = settings.system_keyboard.as_ref().unwrap();
    assert_eq!(system.upper.last(), settings.toolbar_quick_keys.last());

    settings.toolbar_quick_keys.clear();
    assert!(!migrate_settings(&mut settings));
    assert_eq!(settings.system_keyboard.as_ref().unwrap().upper.last().unwrap().label, "Esc");
}

#[test]
fn old_settings_migrate_legacy_upload_dir_once() {
    let mut settings = Settings {
        settings_version: 0,
        upload_dir: "~/.dinotty/uploads".into(),
        ..Settings::default()
    };

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert_eq!(settings.upload_dir, default_upload_dir());
}

#[test]
fn old_settings_migrate_resolved_temp_upload_dir_once() {
    let mut settings = Settings {
        settings_version: 1,
        upload_dir: std::env::temp_dir().join("dinotty").to_string_lossy().into_owned(),
        ..Settings::default()
    };

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert_eq!(settings.upload_dir, default_upload_dir());
}

#[test]
fn current_settings_keep_explicit_legacy_upload_dir() {
    let mut settings = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        upload_dir: "~/.dinotty/uploads".into(),
        ..Settings::default()
    };

    assert!(!migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert_eq!(settings.upload_dir, "~/.dinotty/uploads");
}

#[test]
fn v5_migrates_all_legacy_workspace_badge_values_idempotently() {
    for (legacy, expected) in [
        (Some(false), Some(WorkspaceBadgeMode::Off)),
        (Some(true), Some(WorkspaceBadgeMode::Tab)),
        (None, None),
    ] {
        let mut settings = Settings {
            settings_version: 4,
            show_workspace_badge_on_tab: legacy,
            workspace_badge_mode: None,
            ..Settings::default()
        };

        assert!(migrate_settings(&mut settings));
        assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
        assert_eq!(settings.workspace_badge_mode, expected);
        assert_eq!(settings.show_workspace_badge_on_tab, None);

        let migrated = serde_json::to_string(&settings).unwrap();
        assert!(!migrated.contains("show_workspace_badge_on_tab"));
        assert!(!migrate_settings(&mut settings));
        assert_eq!(serde_json::to_string(&settings).unwrap(), migrated);
    }
}

#[test]
fn v4_put_migrates_explicitly_hidden_workspace_badge_to_off() {
    let mut settings = Settings {
        settings_version: 4,
        show_workspace_badge_on_tab: Some(false),
        workspace_badge_mode: None,
        ..Settings::default()
    };

    migrate_settings(&mut settings);

    assert_eq!(settings.workspace_badge_mode, Some(WorkspaceBadgeMode::Off));
}

#[test]
fn v4_put_migrates_explicitly_shown_workspace_badge_to_tab() {
    let mut settings = Settings {
        settings_version: 4,
        show_workspace_badge_on_tab: Some(true),
        workspace_badge_mode: None,
        ..Settings::default()
    };

    migrate_settings(&mut settings);

    assert_eq!(settings.workspace_badge_mode, Some(WorkspaceBadgeMode::Tab));
}

#[test]
fn v3_put_keeps_historical_workspace_badge_default_device_aware() {
    let mut settings = Settings {
        settings_version: 3,
        show_workspace_badge_on_tab: Some(true),
        workspace_badge_mode: None,
        ..Settings::default()
    };

    migrate_settings(&mut settings);

    assert_eq!(settings.workspace_badge_mode, None);
}

#[test]
fn legacy_put_keeps_existing_workspace_badge_mode() {
    let mut settings = Settings {
        settings_version: 4,
        show_workspace_badge_on_tab: Some(false),
        workspace_badge_mode: Some(WorkspaceBadgeMode::Both),
        ..Settings::default()
    };

    migrate_settings(&mut settings);

    assert_eq!(settings.workspace_badge_mode, Some(WorkspaceBadgeMode::Both));
}

#[test]
fn v15_adds_an_empty_remote_server_roster_without_touching_anything_else() {
    let mut settings: Settings = serde_json::from_str(
        r#"{"settings_version":14,"locale":"zh","inherit_cwd_for_new_tab":true}"#,
    )
    .unwrap();

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert!(settings.remote_servers.is_empty());
    // v15 is a pure serde default: unrelated fields must survive it verbatim.
    assert_eq!(settings.locale, "zh");
    assert!(settings.inherit_cwd_for_new_tab);

    // Idempotent, and the roster round-trips through save/load unchanged.
    assert!(!migrate_settings(&mut settings));
    let saved = serde_json::to_string(&settings).unwrap();
    assert!(saved.contains(r#""remote_servers":[]"#));
    let mut reloaded: Settings = serde_json::from_str(&saved).unwrap();
    assert!(!migrate_settings(&mut reloaded));
    assert!(reloaded.remote_servers.is_empty());
}

#[test]
fn a_v15_roster_round_trips_through_save_and_load() {
    let mut settings = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        remote_servers: vec![RemoteServer {
            id: "lab".into(),
            name: "Lab box".into(),
            url: "http://192.168.1.20:58901".into(),
            token: Some(SensitiveString::new("s3cret".into())),
            group: Some("lab".into()),
            last_seen_version: Some("0.26.0".into()),
            has_token: true,
        }],
        ..Settings::default()
    };
    settings.remote_servers[0].refresh_has_token();

    let saved = serde_json::to_string(&settings).unwrap();
    // The token *must* be written: `settings.json` is the only place a hub
    // keeps it, so a token that is not persisted is one the user has to paste
    // again after every restart. Keeping it out of HTTP responses is a separate
    // step, `Settings::scrub_secrets`, done by the handlers.
    assert!(saved.contains("s3cret"), "the token must be persisted: {saved}");

    let reloaded: Settings = serde_json::from_str(&saved).unwrap();
    assert_eq!(reloaded.remote_servers.len(), 1);
    assert_eq!(reloaded.remote_servers[0].id, "lab");
    assert_eq!(reloaded.remote_servers[0].group.as_deref(), Some("lab"));
    assert!(reloaded.remote_servers[0].has_token);
    assert_eq!(
        reloaded.remote_servers[0].token.as_ref().map(SensitiveString::expose),
        Some("s3cret"),
        "a token that survives the write but not the read is still lost on restart"
    );
}

/// The three-state token contract, which is the whole reason `token` is an
/// `Option<SensitiveString>` rather than a bare `SensitiveString`. All three
/// rows of the design's table, asserted against the real merge helper.
mod token_tri_state {
    use crate::settings::{merge_remote_server_tokens, RemoteServer, SensitiveString, Settings};

    fn existing(token: Option<&str>) -> Settings {
        Settings {
            remote_servers: vec![RemoteServer {
                id: "a".into(),
                name: "A".into(),
                url: "http://h:1".into(),
                token: token.map(|t| SensitiveString::new(t.to_string())),
                ..RemoteServer::default()
            }],
            ..Settings::default()
        }
    }

    /// `None` omits the `token` key entirely; `Some(v)` puts `v` under it, so
    /// a `json!(null)` really is an explicit `null` on the wire.
    fn incoming(token: Option<serde_json::Value>) -> Settings {
        let mut srv = serde_json::json!({"id": "a", "name": "A", "url": "http://h:1"});
        if let Some(t) = token {
            srv["token"] = t;
        }
        serde_json::from_value(serde_json::json!({ "remote_servers": [srv] })).unwrap()
    }

    fn token_of(settings: &Settings) -> Option<&str> {
        settings.remote_servers[0].token.as_ref().map(SensitiveString::expose)
    }

    #[test]
    fn missing_token_key_keeps_the_stored_one() {
        let mut inc = incoming(None);
        merge_remote_server_tokens(&mut inc, &existing(Some("keepme")));
        assert_eq!(token_of(&inc), Some("keepme"));
        assert!(inc.remote_servers[0].has_token);
    }

    #[test]
    fn empty_string_clears_the_stored_token() {
        let mut inc = incoming(Some(serde_json::json!("")));
        merge_remote_server_tokens(&mut inc, &existing(Some("dropme")));
        assert_eq!(token_of(&inc), Some(""));
        assert!(!inc.remote_servers[0].has_token, "cleared token must not report has_token");
    }

    #[test]
    fn a_supplied_token_overwrites_the_stored_one() {
        let mut inc = incoming(Some(serde_json::json!("newone")));
        merge_remote_server_tokens(&mut inc, &existing(Some("old")));
        assert_eq!(token_of(&inc), Some("newone"));
        assert!(inc.remote_servers[0].has_token);
    }

    /// An explicit `null` is consumed by `Option` as `None`, i.e. "keep" - not
    /// the "clear" the design doc's table claims. This is the safe direction
    /// (a hand-written `null` preserves a working credential), and the real
    /// client never sends it because `skip_serializing` omits the key. Pinned
    /// here because the doc says otherwise and a well-meaning "fix" would turn
    /// it into silent credential loss.
    #[test]
    fn explicit_null_keeps_rather_than_clears() {
        let mut inc = incoming(Some(serde_json::Value::Null));
        merge_remote_server_tokens(&mut inc, &existing(Some("keepme")));
        assert_eq!(token_of(&inc), Some("keepme"));
        assert!(inc.remote_servers[0].has_token);
    }

    #[test]
    fn has_token_from_the_client_is_ignored_and_recomputed() {
        let mut inc: Settings = serde_json::from_value(serde_json::json!({
            "remote_servers": [
                {"id": "a", "name": "A", "url": "http://h:1", "has_token": true}
            ]
        }))
        .unwrap();
        // No token stored downstream either: the client's claim must not stick.
        merge_remote_server_tokens(&mut inc, &existing(None));
        assert!(inc.remote_servers[0].token.is_none());
        assert!(!inc.remote_servers[0].has_token);
    }

    #[test]
    fn tokens_are_inherited_per_id_not_by_position() {
        let mut stored = existing(Some("token-a"));
        stored.remote_servers.push(RemoteServer {
            id: "b".into(),
            name: "B".into(),
            url: "http://h:2".into(),
            token: Some(SensitiveString::new("token-b".into())),
            ..RemoteServer::default()
        });

        // Reordered and one entry dropped, which is what a full-table PUT does.
        let mut inc: Settings = serde_json::from_value(serde_json::json!({
            "remote_servers": [
                {"id": "b", "name": "B", "url": "http://h:2"},
                {"id": "c", "name": "C", "url": "http://h:3"}
            ]
        }))
        .unwrap();
        merge_remote_server_tokens(&mut inc, &stored);

        assert_eq!(inc.remote_servers.len(), 2, "the incoming list is authoritative");
        assert_eq!(token_of(&inc), Some("token-b"));
        assert!(inc.remote_servers[1].token.is_none(), "a new id has no token to inherit");
        assert!(!inc.remote_servers[1].has_token);
    }
}

#[test]
fn migrated_workspace_badge_mode_is_stable_across_save_load_save() {
    let mut settings = Settings {
        settings_version: 4,
        show_workspace_badge_on_tab: Some(true),
        workspace_badge_mode: None,
        ..Settings::default()
    };
    migrate_settings(&mut settings);

    let first_save = serde_json::to_string(&settings).unwrap();
    let mut loaded: Settings = serde_json::from_str(&first_save).unwrap();
    migrate_settings(&mut loaded);
    let second_save = serde_json::to_string(&loaded).unwrap();

    assert_eq!(loaded.workspace_badge_mode, Some(WorkspaceBadgeMode::Tab));
    assert_eq!(second_save, first_save);
}

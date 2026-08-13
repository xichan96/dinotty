use super::super::*;

fn parse_action_keyboard(json: &str) -> ActionKeyboardConfig {
    serde_json::from_str(json).expect("action keyboard config should deserialize")
}

#[test]
fn action_keyboard_serde_round_trips_old_and_new_shapes() {
    let old = parse_action_keyboard(r#"{"rows":[[{"label":"esc","send":"\u001b"}]]}"#);
    assert!(old.bottom.is_none());
    let old_round_trip: ActionKeyboardConfig =
        serde_json::from_str(&serde_json::to_string(&old).unwrap()).unwrap();
    assert_eq!(old_round_trip, old);

    let new = parse_action_keyboard(
        r#"{
            "rows":[[{"label":"New tab","kind":"action","action":"newTab"}]],
            "bottom":{
                "rows":[[{"label":"yes","send":"yes\r","grow":1.5}]],
                "enter":{"label":"Go","kind":"send","send":"\r"},
                "enter_width":0.28
            }
        }"#,
    );
    let new_round_trip: ActionKeyboardConfig =
        serde_json::from_str(&serde_json::to_string(&new).unwrap()).unwrap();
    assert_eq!(new_round_trip, new);

    let mut settings = Settings {
        action_keyboard: Some(new.clone()),
        action_keyboard_user_default: Some(new),
        ..Settings::default()
    };
    normalize_action_keyboards(&mut settings);
    let settings_round_trip: Settings =
        serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
    assert!(settings_round_trip.action_keyboard.is_some());
    assert!(settings_round_trip.action_keyboard_user_default.is_some());
}

#[test]
fn action_keyboard_plain_send_omits_absent_optional_fields() {
    let config = parse_action_keyboard(r#"{"rows":[[{"label":"esc","send":"\u001b"}]]}"#);
    let serialized = serde_json::to_value(&config).unwrap();
    let key = &serialized["rows"][0][0];

    assert!(key.get("kind").is_none());
    assert!(key.get("action").is_none());
    assert!(key.get("style").is_none());
    assert!(key.get("grow").is_none());
    assert!(key.get("auto_enter").is_none());

    let round_trip: ActionKeyboardConfig = serde_json::from_value(serialized).unwrap();
    assert_eq!(round_trip, config);
}

#[test]
fn action_keyboard_special_lock_and_display_round_trip_without_a_schema_field() {
    let config = parse_action_keyboard(
        r#"{"rows":[[{"label":"Ctrl","kind":"send","special":"ctrl:lock","display":"icon","send":""}]]}"#,
    );

    let serialized = serde_json::to_value(&config).unwrap();
    let key = &serialized["rows"][0][0];
    assert_eq!(key["special"], "ctrl:lock");
    assert_eq!(key["display"], "icon");

    let round_trip: ActionKeyboardConfig = serde_json::from_value(serialized).unwrap();
    assert_eq!(round_trip, config);
}

#[test]
fn action_keyboard_normalize_defaults_only_missing_paste_auto_enter() {
    let mut config = parse_action_keyboard(
        r#"{
            "rows":[[
                {"label":"paste-default","kind":"action","action":"pasteTerminal"},
                {"label":"paste-off","kind":"action","action":"pasteTerminal","auto_enter":false},
                {"label":"send-default","kind":"send","send":"echo ok"}
            ]]
        }"#,
    );

    config.normalize();

    let keys = &config.rows[0];
    assert_eq!(keys[0].auto_enter, Some(true));
    assert_eq!(keys[1].auto_enter, Some(false));
    assert_eq!(keys[2].auto_enter, None);
    assert!(!keys[2].auto_enter.unwrap_or(false));
    assert!(serde_json::to_value(&keys[2]).unwrap().get("auto_enter").is_none());
}

#[test]
fn action_keyboard_serde_ignores_unknown_fields_and_accepts_unknown_kind() {
    let config = parse_action_keyboard(
        r#"{
            "unknown_config_field":true,
            "rows":[[{
                "label":"future",
                "kind":"future-kind",
                "send":"kept",
                "unknown_key_field":{"future":true}
            }]],
            "bottom":{
                "rows":[],
                "enter":{"label":"Go","kind":"send","send":"\r"},
                "unknown_bottom_field":42
            }
        }"#,
    );
    assert_eq!(config.rows[0][0].kind.as_deref(), Some("future-kind"));
    assert_eq!(config.rows[0][0].send, "kept");

    let serialized = serde_json::to_string(&config).unwrap();
    assert!(!serialized.contains("unknown_config_field"));
    assert!(!serialized.contains("unknown_key_field"));
    assert!(!serialized.contains("unknown_bottom_field"));
    let round_trip: ActionKeyboardConfig = serde_json::from_str(&serialized).unwrap();
    assert_eq!(round_trip, config);
}

#[test]
fn action_keyboard_normalize_obeys_absence_and_empty_contract() {
    let mut settings = Settings::default();
    assert!(!normalize_action_keyboards(&mut settings));
    assert!(settings.action_keyboard.is_none());
    assert!(settings.action_keyboard_user_default.is_none());

    let mut legacy = parse_action_keyboard(r#"{"rows":[]}"#);
    legacy.normalize();
    assert!(legacy.bottom.is_none());

    let mut explicit_empty = parse_action_keyboard(
        r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"Go","kind":"send","send":"\r"}}}"#,
    );
    explicit_empty.normalize();
    assert!(explicit_empty.bottom.as_ref().unwrap().rows.is_empty());
}

#[test]
fn action_keyboard_normalize_repairs_every_invalid_enter_form() {
    let cases = [
        (r#"{"rows":[],"bottom":{"rows":[]}}"#, "↵"),
        (
            r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"Custom","kind":"action","action":"newTab"}}}"#,
            "Custom",
        ),
        (r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"No kind","send":"\r"}}}"#, "No kind"),
        (
            r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"Wrong bytes","kind":"send","send":"\n"}}}"#,
            "Wrong bytes",
        ),
        (r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"   ","kind":"send"}}}"#, "↵"),
    ];

    for (json, expected_label) in cases {
        let mut config = parse_action_keyboard(json);
        config.normalize();
        let enter = config.bottom.unwrap().enter.unwrap();
        assert_eq!(enter.label, expected_label);
        assert_eq!(enter.kind.as_deref(), Some("send"));
        assert_eq!(enter.send, "\r");
    }
}

#[test]
fn action_keyboard_normalize_clamps_width_and_grow_without_rounding() {
    for (input, expected) in [(-1.0, Some(0.15)), (0.3, Some(0.3)), (0.9, Some(0.5))] {
        let mut config = parse_action_keyboard(
            r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"Go","kind":"send","send":"\r"}}}"#,
        );
        config.bottom.as_mut().unwrap().enter_width = Some(input);
        config.normalize();
        assert_eq!(config.bottom.unwrap().enter_width, expected);
    }

    for input in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut config = parse_action_keyboard(
            r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"Go","kind":"send","send":"\r"}}}"#,
        );
        config.bottom.as_mut().unwrap().enter_width = Some(input);
        config.normalize();
        assert_eq!(config.bottom.unwrap().enter_width, None);
    }

    let mut config = parse_action_keyboard(
        r#"{
            "rows":[[
                {"label":"low","grow":-1},
                {"label":"fractional","grow":1.75},
                {"label":"high","grow":20},
                {"label":"nan"}
            ]],
            "bottom":{
                "rows":[[{"label":"infinite"}]],
                "enter":{"label":"Go","kind":"send","send":"\r","grow":20}
            }
        }"#,
    );
    config.rows[0][3].grow = Some(f64::NAN);
    config.bottom.as_mut().unwrap().rows[0][0].grow = Some(f64::NEG_INFINITY);
    config.normalize();
    assert_eq!(
        config.rows[0].iter().map(|key| key.grow).collect::<Vec<_>>(),
        vec![Some(0.5), Some(1.75), Some(12.0), None]
    );
    let bottom = config.bottom.unwrap();
    assert_eq!(bottom.rows[0][0].grow, None);
    assert_eq!(bottom.enter.unwrap().grow, Some(12.0));
}

#[test]
fn action_keyboard_normalize_applies_kind_contract() {
    let mut config = parse_action_keyboard(
        r#"{
            "rows":[[
                {"label":"future","kind":"future-kind","action":"newTab","send":"kept","special":"bookmarks"},
                {"label":"missing","kind":"action","send":"keep","repeat":true},
                {"label":"blank","kind":"action","action":"  ","send":"keep","auto_enter":true},
                {"label":"valid","kind":"action","action":"newTab","send":"remove","special":"bookmarks","repeat":true,"auto_enter":true,"grow":1.5},
                {"label":"paste-on","kind":"action","action":"pasteTerminal","auto_enter":true},
                {"label":"paste-off","kind":"action","action":"pasteTerminal","auto_enter":false},
                {"label":"bookmarks","special":"bookmarks"}
            ]]
        }"#,
    );
    config.normalize();

    let keys = &config.rows[0];
    assert_eq!(keys[0].kind.as_deref(), Some("send"));
    assert_eq!(keys[0].action.as_deref(), Some("newTab"));
    assert_eq!(keys[0].send, "kept");
    assert_eq!(keys[0].special.as_deref(), Some("bookmarks"));

    assert_eq!(keys[1].send, "keep");
    assert!(keys[1].repeat);
    assert_eq!(keys[2].send, "keep");
    assert_eq!(keys[2].auto_enter, Some(true));

    assert!(keys[3].send.is_empty());
    assert!(keys[3].special.is_none());
    assert!(keys[3].repeat);
    assert_eq!(keys[3].auto_enter, None);
    let valid_action_json = serde_json::to_value(&keys[3]).unwrap();
    for forbidden in ["send", "special", "auto_enter"] {
        assert!(valid_action_json.get(forbidden).is_none(), "{forbidden} survived");
    }
    assert_eq!(valid_action_json["repeat"], true);

    assert_eq!(keys[4].auto_enter, Some(true));
    assert_eq!(keys[5].auto_enter, Some(false));
    assert_eq!(serde_json::to_value(&keys[4]).unwrap()["auto_enter"], true);
    assert_eq!(serde_json::to_value(&keys[5]).unwrap()["auto_enter"], false);

    assert!(keys[6].send.is_empty());
    assert_eq!(keys[6].special.as_deref(), Some("bookmarks"));
}

#[test]
fn action_keyboard_normalize_is_idempotent_for_active_and_snapshot_slots() {
    let invalid = parse_action_keyboard(
        r#"{
            "rows":[[{"label":"Action","kind":"action","action":"newTab","send":"remove","grow":20}]],
            "bottom":{"rows":[],"enter":{"label":"Custom","kind":"action","action":"newTab"},"enter_width":0.9}
        }"#,
    );
    let mut settings = Settings {
        action_keyboard: Some(invalid.clone()),
        action_keyboard_user_default: Some(invalid),
        ..Settings::default()
    };

    assert!(normalize_action_keyboards(&mut settings));
    let once = serde_json::to_value((
        settings.action_keyboard.as_ref(),
        settings.action_keyboard_user_default.as_ref(),
    ))
    .unwrap();
    assert!(!normalize_action_keyboards(&mut settings));
    let twice = serde_json::to_value((
        settings.action_keyboard.as_ref(),
        settings.action_keyboard_user_default.as_ref(),
    ))
    .unwrap();
    assert_eq!(twice, once);
}

#[test]
fn action_keyboard_normalize_keeps_valid_shape_and_drops_bogus() {
    let mut config = parse_action_keyboard(
        r#"{
            "rows":[[
                {"label":"arrow","send":"up","shape":"arrow"},
                {"label":"button","send":"yes\r","shape":"button"},
                {"label":"bogus","send":"no\r","shape":"wide"}
            ]]
        }"#,
    );
    config.normalize();

    assert_eq!(config.rows[0][0].shape.as_deref(), Some("arrow"));
    assert_eq!(config.rows[0][1].shape.as_deref(), Some("button"));
    assert_eq!(config.rows[0][2].shape, None);

    let wire = serde_json::to_value(&config).unwrap();
    assert_eq!(wire["rows"][0][0]["shape"], "arrow");
    assert_eq!(wire["rows"][0][1]["shape"], "button");
    assert!(wire["rows"][0][2].get("shape").is_none());
}

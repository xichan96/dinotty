use super::super::types::PluginPrefsConfig;

#[test]
fn plugin_prefs_round_trips_hidden_overlays() {
    let prefs = PluginPrefsConfig {
        hidden_toolbar: vec!["p1".into()],
        hidden_overlays: vec!["overlay-demo:fab".into()],
        show_incompatible: true,
        ..Default::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    let back: PluginPrefsConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(back.hidden_overlays, vec!["overlay-demo:fab"]);
    assert_eq!(back.hidden_toolbar, vec!["p1"]);
    assert!(back.show_incompatible);
}

#[test]
fn plugin_prefs_without_hidden_overlays_deserializes_to_empty() {
    let prefs: PluginPrefsConfig =
        serde_json::from_str(r#"{"hidden_toolbar":["p1"],"show_incompatible":true}"#).unwrap();
    assert_eq!(prefs.hidden_overlays, Vec::<String>::new());
    assert_eq!(prefs.hidden_toolbar, vec!["p1"]);
}

#[test]
fn plugin_prefs_round_trips_open_modes() {
    let prefs = PluginPrefsConfig {
        hidden_toolbar: vec![],
        hidden_overlays: vec![],
        show_incompatible: false,
        open_modes: std::collections::HashMap::from([("json-formatter".into(), "floating".into())]),
    };
    let json = serde_json::to_string(&prefs).unwrap();
    let back: PluginPrefsConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(back.open_modes.get("json-formatter").map(String::as_str), Some("floating"));
}

#[test]
fn plugin_prefs_without_open_modes_deserializes_to_empty() {
    let prefs: PluginPrefsConfig = serde_json::from_str(r#"{"hidden_toolbar":["p1"]}"#).unwrap();
    assert!(prefs.open_modes.is_empty());
}

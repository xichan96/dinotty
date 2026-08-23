use super::super::types::PluginPrefsConfig;

#[test]
fn plugin_prefs_round_trips_hidden_overlays() {
    let prefs = PluginPrefsConfig {
        hidden_toolbar: vec!["p1".into()],
        hidden_overlays: vec!["overlay-demo:fab".into()],
        show_incompatible: true,
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

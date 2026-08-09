use super::super::*;

fn sample_theme(uuid: &str, name: &str) -> SavedTheme {
    SavedTheme {
        uuid: uuid.to_string(),
        name: name.to_string(),
        colors: ThemeColors {
            foreground: "#ffffff".to_string(),
            background: "#000000".to_string(),
            cursor: "#ffffff".to_string(),
            ansi: std::array::from_fn(|_| "#000000".to_string()),
        },
    }
}

#[test]
fn old_settings_without_theme_library_defaults_empty() {
    let settings: Settings = serde_json::from_str(r"{}").unwrap();

    assert!(settings.custom_themes.is_empty());
    assert!(settings.hidden_builtins.is_empty());
}

#[test]
fn settings_round_trips_custom_themes() {
    let theme = sample_theme("theme-1", "Nord");
    let mut settings = Settings::default();
    settings.custom_themes.push(theme);

    let serialized = serde_json::to_string(&settings).unwrap();
    let restored: Settings = serde_json::from_str(&serialized).unwrap();
    let restored_theme = &restored.custom_themes[0];

    assert_eq!(restored_theme.uuid, "theme-1");
    assert_eq!(restored_theme.name, "Nord");
    assert_eq!(restored_theme.colors.foreground, "#ffffff");
    assert_eq!(restored_theme.colors.background, "#000000");
    assert_eq!(restored_theme.colors.cursor, "#ffffff");
    assert_eq!(restored_theme.colors.ansi, std::array::from_fn(|_| "#000000".to_string()));
}

#[test]
fn clamp_theme_on_put_dedups_uuid_keeping_first() {
    let mut settings = Settings {
        custom_themes: vec![sample_theme("same", "First"), sample_theme("same", "Second")],
        ..Default::default()
    };

    assert!(clamp_theme_on_put(&mut settings));
    assert_eq!(settings.custom_themes.len(), 1);
    assert_eq!(settings.custom_themes[0].name, "First");
}

#[test]
fn clamp_theme_on_put_rejects_base_names_from_hidden() {
    let mut settings = Settings {
        hidden_builtins: ["dark", "nord", "light", "dracula", "nord"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ..Default::default()
    };

    assert!(clamp_theme_on_put(&mut settings));
    assert_eq!(settings.hidden_builtins, vec!["nord"]);
}

#[test]
fn clamp_theme_on_put_caps_custom_themes_at_15() {
    let mut settings = Settings {
        custom_themes: (0..17)
            .map(|i| sample_theme(&format!("uuid-{i}"), &format!("Theme {i}")))
            .collect(),
        ..Default::default()
    };

    assert!(clamp_theme_on_put(&mut settings));
    assert_eq!(settings.custom_themes.len(), 15);
}

#[test]
fn deserialize_preserves_over_cap_and_dup_uuid_custom_themes() {
    let mut settings = Settings {
        custom_themes: (0..17)
            .map(|i| sample_theme(&format!("uuid-{i}"), &format!("Theme {i}")))
            .collect(),
        ..Default::default()
    };
    settings.custom_themes.push(sample_theme("uuid-0", "Duplicate UUID"));

    let serialized = serde_json::to_string(&settings).unwrap();
    let restored: Settings = serde_json::from_str(&serialized).unwrap();

    assert_eq!(restored.custom_themes.len(), 18);
}

#[test]
fn clamp_theme_normalizes_short_hex() {
    let mut settings = Settings::default();
    let mut theme = sample_theme("theme-1", "Short Hex");
    theme.colors.foreground = "#FFF".to_string();
    settings.custom_themes.push(theme);

    assert!(clamp_theme_on_put(&mut settings));
    assert_eq!(settings.custom_themes[0].colors.foreground, "#ffffff");
}

#[test]
fn deserialize_does_not_normalize_theme_colors() {
    let mut settings = Settings::default();
    let mut theme = sample_theme("theme-1", "Malformed Color");
    theme.colors.foreground = "#ZZZ".to_string();
    settings.custom_themes.push(theme);

    let serialized = serde_json::to_string(&settings).unwrap();
    let restored: Settings = serde_json::from_str(&serialized).unwrap();

    assert_eq!(restored.custom_themes[0].colors.foreground, "#ZZZ");
}

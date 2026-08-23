use super::super::*;

#[test]
fn overlap_uses_null_only_for_uninitialized_and_preserves_explicit_zero() {
    let defaults = Settings::default();
    assert_eq!(defaults.ime_keyboard_overlap_px, None);

    let initialized = Settings { ime_keyboard_overlap_px: Some(0), ..Settings::default() };
    let wire = serde_json::to_value(initialized).unwrap();

    assert_eq!(wire["ime_keyboard_overlap_px"], 0);
}

#[test]
fn overlap_is_clamped_to_the_supported_range() {
    let mut settings = Settings { ime_keyboard_overlap_px: Some(999), ..Settings::default() };

    assert!(clamp_ime_keyboard_overlap_px(&mut settings));
    assert_eq!(settings.ime_keyboard_overlap_px, Some(300));
    assert!(!clamp_ime_keyboard_overlap_px(&mut settings));
}

#[test]
fn v12_put_preserves_initialized_overlap_but_can_update_v12_system_fields() {
    let existing = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        ime_keyboard_overlap_px: Some(72),
        system_toolbar_mode: SystemToolbarMode::FollowIme,
        ..Settings::default()
    };
    let mut incoming = Settings {
        settings_version: 12,
        ime_keyboard_overlap_px: None,
        system_toolbar_mode: SystemToolbarMode::PersistentMobile,
        ..Settings::default()
    };

    preserve_current_settings_on_legacy_put(Some(12), &mut incoming, &existing);

    assert_eq!(incoming.ime_keyboard_overlap_px, Some(72));
    assert_eq!(incoming.system_toolbar_mode, SystemToolbarMode::PersistentMobile);
}

#[test]
fn current_put_can_set_and_reset_initialized_overlap() {
    let existing = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        ime_keyboard_overlap_px: Some(72),
        ..Settings::default()
    };
    let mut incoming = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        ime_keyboard_overlap_px: Some(0),
        ..Settings::default()
    };

    preserve_current_settings_on_legacy_put(
        Some(CURRENT_SETTINGS_VERSION),
        &mut incoming,
        &existing,
    );

    assert_eq!(incoming.ime_keyboard_overlap_px, Some(0));
}

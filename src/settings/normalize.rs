use super::types::{
    default_scroll_acceleration, default_scroll_sensitivity, ActionKey, ActionKeyboardConfig,
    SavedTheme, Settings, TextConfig, ThemeColors,
};

pub(crate) const FONT_ANCHORS: [&str; 5] =
    ["Menlo", "Consolas", "Courier New", "DejaVu Sans Mono", "monospace"];

const BASE_THEME_NAMES: [&str; 3] = ["dark", "light", "dracula"];
const THEME_CUSTOM_CAP: usize = 15;

/// Trim ASCII/Unicode whitespace AND U+FEFF (BOM/ZWNBSP), matching JS `String.trim()` which
/// strips U+FEFF as ECMAScript `WhiteSpace`. Rust `str::trim()` does not remove U+FEFF.
pub(crate) fn trim_font(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

/// Extract the primary family from a plain name OR a CSS stack: first comma segment, strip one
/// matched outer quote pair (ASCII ' or "), trim. Mirrors the TS primaryFamily.
fn primary_family(value: &str) -> String {
    let first = trim_font(value.split(',').next().unwrap_or(""));
    let mut chars = first.chars();
    if let (Some(f), Some(l)) = (chars.next(), first.chars().last()) {
        if first.chars().count() >= 2 && (f == '"' || f == '\'') && f == l {
            // Use char-based indices to avoid panicking on multi-byte UTF-8 boundaries.
            let inner: String = first.chars().skip(1).take(first.chars().count() - 2).collect();
            return trim_font(&inner).to_string();
        }
    }
    first.to_string()
}

pub(crate) fn clamp_custom_fonts(v: &mut Vec<String>) -> bool {
    let anchor_identities: Vec<String> =
        FONT_ANCHORS.iter().map(|anchor| anchor.to_lowercase()).collect();
    let mut seen = Vec::new();
    let mut sanitized = Vec::new();

    for entry in v.iter() {
        let primary = primary_family(entry);
        let trimmed = trim_font(&primary);
        if trimmed.is_empty()
            || trimmed.chars().count() > 100
            || trimmed.chars().any(|c| {
                c == '"' || c == '\\' || c.is_control() || matches!(c, '<' | '>' | ';' | '{' | '}')
            })
        {
            continue;
        }

        let identity = trimmed.to_lowercase();
        if anchor_identities.contains(&identity) || seen.contains(&identity) {
            continue;
        }

        seen.push(identity);
        sanitized.push(trimmed.to_string());
        if sanitized.len() == 20 {
            break;
        }
    }

    let changed = sanitized.len() != v.len() || sanitized.iter().zip(v.iter()).any(|(a, b)| a != b);
    *v = sanitized;
    changed
}

/// Normalize a single hex color IN PLACE to lowercase `#rrggbb`.
/// Accepts `#rgb` (expands) and `#rrggbb` (case-normalizes). Unrepairable -> replace with `fallback`
/// (never errors, never deletes the owning theme). Returns true if the value changed.
pub(crate) fn normalize_hex_color(c: &mut String, fallback: &str) -> bool {
    let orig = c.clone();
    let s = c.trim();
    let normalized = if let Some(hex) = s.strip_prefix('#') {
        let hex_lower = hex.to_ascii_lowercase();
        let is_hex = |t: &str| t.chars().all(|ch| ch.is_ascii_hexdigit());
        if hex_lower.len() == 6 && is_hex(&hex_lower) {
            format!("#{hex_lower}")
        } else if hex_lower.len() == 3 && is_hex(&hex_lower) {
            let mut expanded = String::from("#");
            for ch in hex_lower.chars() {
                expanded.push(ch);
                expanded.push(ch);
            }
            expanded
        } else {
            fallback.to_string()
        }
    } else {
        fallback.to_string()
    };
    *c = normalized;
    *c != orig
}

pub(crate) fn normalize_theme_colors(colors: &mut ThemeColors) -> bool {
    let mut changed = false;
    changed |= normalize_hex_color(&mut colors.foreground, "#ffffff");
    changed |= normalize_hex_color(&mut colors.background, "#000000");
    changed |= normalize_hex_color(&mut colors.cursor, "#ffffff");
    for a in &mut colors.ansi {
        changed |= normalize_hex_color(a, "#000000");
    }
    changed
}

/// PUT-only theme-library clamp.
/// - normalize every theme's colors
/// - drop duplicate uuids keeping first (corruption cleanup)
/// - remove the 3 base names from `hidden_builtins` + dedup `hidden_builtins`
/// - truncate `custom_themes` to `THEME_CUSTOM_CAP` (frontend already blocks over-cap adds; this is the
///   backend-owned independent hard bound)
///
/// Returns true if anything changed.
pub(crate) fn clamp_theme_library(
    custom_themes: &mut Vec<SavedTheme>,
    hidden_builtins: &mut Vec<String>,
) -> bool {
    let mut changed = false;

    let mut seen_uuids: Vec<String> = Vec::new();
    let mut kept: Vec<SavedTheme> = Vec::new();
    for mut t in custom_themes.drain(..) {
        if seen_uuids.contains(&t.uuid) {
            changed = true;
            continue;
        }
        seen_uuids.push(t.uuid.clone());
        if normalize_theme_colors(&mut t.colors) {
            changed = true;
        }
        kept.push(t);
    }
    *custom_themes = kept;

    let mut seen_hidden: Vec<String> = Vec::new();
    let mut hidden_kept: Vec<String> = Vec::new();
    for name in hidden_builtins.drain(..) {
        if BASE_THEME_NAMES.contains(&name.as_str()) {
            changed = true;
            continue;
        }
        if seen_hidden.contains(&name) {
            changed = true;
            continue;
        }
        seen_hidden.push(name.clone());
        hidden_kept.push(name);
    }
    *hidden_builtins = hidden_kept;

    if custom_themes.len() > THEME_CUSTOM_CAP {
        custom_themes.truncate(THEME_CUSTOM_CAP);
        changed = true;
    }
    changed
}

pub(crate) fn clamp_theme_on_put(settings: &mut Settings) -> bool {
    clamp_theme_library(&mut settings.custom_themes, &mut settings.hidden_builtins)
}

pub(crate) fn clamp_quick_send_threshold(settings: &mut Settings) -> bool {
    let old = settings.quick_send_threshold;
    settings.quick_send_threshold = settings.quick_send_threshold.clamp(0, 5000);
    settings.quick_send_threshold != old
}

// Legit CSS font stacks contain only letters/digits/space/comma/quotes.
// Anything with control chars or < > ; { } is a CSS-injection vector -> neutralise.
fn font_family_is_unsafe(s: &str) -> bool {
    s.chars().any(|c| c.is_control() || matches!(c, '<' | '>' | ';' | '{' | '}'))
}

pub(crate) fn clamp_text_config(t: &mut TextConfig) -> bool {
    let old_scroll_sensitivity = t.scroll_sensitivity;
    let old_scroll_acceleration = t.scroll_acceleration;
    let old_scrollbar_width = t.scrollbar_width;

    t.scroll_sensitivity = if t.scroll_sensitivity.is_finite() {
        t.scroll_sensitivity.clamp(0.1, 2.0)
    } else {
        default_scroll_sensitivity()
    };
    t.scroll_acceleration = if t.scroll_acceleration.is_finite() {
        t.scroll_acceleration.clamp(0.0, 5.0)
    } else {
        default_scroll_acceleration()
    };
    t.scrollbar_width = t.scrollbar_width.clamp(4, 16);

    let mut changed = t.scroll_sensitivity.to_bits() != old_scroll_sensitivity.to_bits()
        || t.scroll_acceleration.to_bits() != old_scroll_acceleration.to_bits()
        || t.scrollbar_width != old_scrollbar_width;
    if let Some(v) = t.custom_fonts.as_mut() {
        if clamp_custom_fonts(v) {
            changed = true;
        }
    }
    if font_family_is_unsafe(&t.font_family) {
        t.font_family = "monospace".to_string();
        changed = true;
    }
    changed
}

pub(crate) fn clamp_text_on_load(t: &mut TextConfig) -> bool {
    clamp_text_config(t)
}

fn normalize_action_key(key: &mut ActionKey) {
    if let Some(grow) = key.grow {
        key.grow = grow.is_finite().then(|| grow.clamp(0.5, 12.0));
    }

    if key.kind.as_deref().is_some_and(|kind| kind != "send" && kind != "action") {
        key.kind = Some("send".to_string());
    }

    if !matches!(key.display.as_deref(), Some("icon" | "text")) {
        key.display = None;
    }

    if !matches!(key.shape.as_deref(), Some("arrow" | "button")) {
        key.shape = None;
    }

    let is_valid_action = key.kind.as_deref() == Some("action")
        && key.action.as_deref().is_some_and(|action| !action.trim().is_empty());
    if is_valid_action {
        key.send.clear();
        key.special = None;
        key.repeat = false;
        if key.action.as_deref() == Some("pasteTerminal") {
            key.auto_enter.get_or_insert(true);
        } else {
            key.auto_enter = None;
        }
    }
}

fn default_action_enter(label: String) -> ActionKey {
    ActionKey {
        label,
        kind: Some("send".to_string()),
        action: None,
        display: None,
        send: "\r".to_string(),
        style: None,
        shape: None,
        repeat: false,
        special: None,
        auto_enter: None,
        grow: None,
    }
}

pub(crate) fn normalize_action_keyboards(settings: &mut Settings) -> bool {
    let before = (settings.action_keyboard.clone(), settings.action_keyboard_user_default.clone());
    if let Some(config) = settings.action_keyboard.as_mut() {
        config.normalize();
    }
    if let Some(config) = settings.action_keyboard_user_default.as_mut() {
        config.normalize();
    }
    before != (settings.action_keyboard.clone(), settings.action_keyboard_user_default.clone())
}

impl ActionKeyboardConfig {
    pub fn normalize(&mut self) {
        for row in &mut self.rows {
            for key in row {
                normalize_action_key(key);
            }
        }

        let Some(bottom) = self.bottom.as_mut() else {
            return;
        };
        for row in &mut bottom.rows {
            for key in row {
                normalize_action_key(key);
            }
        }

        if let Some(enter) = bottom.enter.as_mut() {
            normalize_action_key(enter);
        }
        let enter_is_valid = bottom
            .enter
            .as_ref()
            .is_some_and(|enter| enter.kind.as_deref() == Some("send") && enter.send == "\r");
        if !enter_is_valid {
            let label = bottom
                .enter
                .as_ref()
                .map(|enter| enter.label.as_str())
                .filter(|label| !label.trim().is_empty())
                .unwrap_or("↵")
                .to_string();
            bottom.enter = Some(default_action_enter(label));
        }

        if let Some(width) = bottom.enter_width {
            bottom.enter_width = width.is_finite().then(|| width.clamp(0.15, 0.50));
        }
    }
}

impl Settings {
    /// Resolve `default_workspace_root`, returning `None` when unset, empty,
    /// whitespace-only, or not a directory.
    pub fn resolved_default_workspace_root(&self) -> Option<std::path::PathBuf> {
        self.default_workspace_root
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(std::path::PathBuf::from)
            .filter(|p| p.is_dir())
    }
}

use serde::{Deserialize, Serialize};

use super::default_true;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TextConfig {
    #[serde(default = "default_font_size")]
    pub font_size: u8,
    #[serde(default)]
    pub font_family: String,
    #[serde(default = "default_line_height")]
    pub line_height: f32,
    #[serde(default)]
    pub letter_spacing: f32,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default = "default_true")]
    pub cursor_blink: bool,
    #[serde(default = "default_scrollback")]
    pub scrollback: u32,
    #[serde(default = "default_scroll_sensitivity")]
    pub scroll_sensitivity: f32,
    #[serde(default = "default_scroll_acceleration")]
    pub scroll_acceleration: f32,
    #[serde(default = "default_scrollbar_width")]
    pub scrollbar_width: u8,
    #[serde(default)]
    pub custom_fonts: Option<Vec<String>>,
}

pub(crate) fn default_font_size() -> u8 {
    14
}
pub(crate) fn default_line_height() -> f32 {
    1.2
}
pub(crate) fn default_cursor_style() -> String {
    "block".into()
}
pub(crate) fn default_scrollback() -> u32 {
    10000
}
pub(crate) fn default_scroll_sensitivity() -> f32 {
    1.0
}
pub(crate) fn default_scroll_acceleration() -> f32 {
    0.0
}
pub(crate) fn default_scrollbar_width() -> u8 {
    8
}

impl Default for TextConfig {
    fn default() -> Self {
        Self {
            font_size: default_font_size(),
            font_family: String::new(),
            line_height: default_line_height(),
            letter_spacing: 0.0,
            cursor_style: default_cursor_style(),
            cursor_blink: true,
            scrollback: default_scrollback(),
            scroll_sensitivity: default_scroll_sensitivity(),
            scroll_acceleration: default_scroll_acceleration(),
            scrollbar_width: default_scrollbar_width(),
            custom_fonts: None,
        }
    }
}

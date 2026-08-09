use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThemeConfig {
    #[serde(default = "default_preset")]
    pub preset: String,
    #[serde(default)]
    pub custom: Option<CustomColors>,
}

pub(crate) fn default_preset() -> String {
    "dark".into()
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self { preset: default_preset(), custom: None }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CustomColors {
    pub foreground: Option<String>,
    pub background: Option<String>,
    pub cursor: Option<String>,
    pub ansi: Option<Vec<Option<String>>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThemeColors {
    pub foreground: String,
    pub background: String,
    pub cursor: String,
    pub ansi: [String; 16],
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SavedTheme {
    pub uuid: String,
    pub name: String,
    pub colors: ThemeColors,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackgroundConfig {
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(default)]
    pub has_image: bool,
}

pub(crate) fn default_mode() -> String {
    "solid".into()
}
pub(crate) fn default_opacity() -> f32 {
    1.0
}

impl Default for BackgroundConfig {
    fn default() -> Self {
        Self { mode: default_mode(), color: None, opacity: 1.0, has_image: false }
    }
}

use serde::{ser::SerializeMap, Deserialize, Serialize};

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct ActionKey {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub display: Option<String>,
    #[serde(default)]
    pub send: String,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub shape: Option<String>,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default)]
    pub special: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_enter: Option<bool>,
    #[serde(default)]
    pub grow: Option<f64>,
}

impl Serialize for ActionKey {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let is_valid_action = self.kind.as_deref() == Some("action")
            && self.action.as_deref().is_some_and(|action| !action.trim().is_empty());
        let is_paste_action = is_valid_action && self.action.as_deref() == Some("pasteTerminal");
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("label", &self.label)?;
        if let Some(kind) = &self.kind {
            map.serialize_entry("kind", kind)?;
        }
        if let Some(action) = &self.action {
            map.serialize_entry("action", action)?;
        }
        if let Some(display) = &self.display {
            map.serialize_entry("display", display)?;
        }
        if let Some(style) = &self.style {
            map.serialize_entry("style", style)?;
        }
        if let Some(shape) = &self.shape {
            map.serialize_entry("shape", shape)?;
        }
        if let Some(grow) = &self.grow {
            map.serialize_entry("grow", grow)?;
        }
        if !is_valid_action {
            map.serialize_entry("send", &self.send)?;
            map.serialize_entry("repeat", &self.repeat)?;
            map.serialize_entry("special", &self.special)?;
        } else if self.repeat {
            map.serialize_entry("repeat", &true)?;
        }
        if (!is_valid_action || is_paste_action) && self.auto_enter.is_some() {
            map.serialize_entry("auto_enter", &self.auto_enter)?;
        }
        map.end()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ActionBottomCluster {
    #[serde(default)]
    pub rows: Vec<Vec<ActionKey>>,
    #[serde(default)]
    pub enter: Option<ActionKey>,
    #[serde(default)]
    pub enter_width: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ActionKeyboardConfig {
    pub rows: Vec<Vec<ActionKey>>,
    #[serde(default)]
    pub bottom: Option<ActionBottomCluster>,
}

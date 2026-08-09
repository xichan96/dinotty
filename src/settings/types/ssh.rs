use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

/// 敏感字符串，Drop 时自动清零内存
#[derive(Clone, Debug, Zeroize)]
#[zeroize(drop)]
#[derive(Default)]
pub struct SensitiveString(String);

impl SensitiveString {
    #[must_use]
    pub fn new(s: String) -> Self {
        Self(s)
    }
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl Serialize for SensitiveString {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for SensitiveString {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(SensitiveString::new)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuthMethod {
    Password { password: SensitiveString },
    KeyFile { key_path: String, passphrase: Option<SensitiveString> },
    KeyInline { private_key: SensitiveString, passphrase: Option<SensitiveString> },
}

impl Default for SshAuthMethod {
    fn default() -> Self {
        Self::Password { password: SensitiveString::default() }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SshProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    #[serde(default = "default_ssh_username")]
    pub username: String,
    pub auth_method: SshAuthMethod,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub default_command: Option<String>,
}

pub(crate) fn default_ssh_port() -> u16 {
    22
}

pub(crate) fn default_ssh_username() -> String {
    "root".into()
}

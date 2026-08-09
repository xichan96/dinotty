use crate::session::SshSessionParams;
use crate::settings::SshAuthMethod;

/// SSH 连接参数（用于 API 请求）
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SshConnectRequest {
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    #[serde(default = "default_ssh_username")]
    pub username: String,
    pub auth: SshAuthMethod,
    #[serde(default)]
    pub default_command: Option<String>,
    /// Optional profile ID - set when connecting from a saved profile
    /// so the session can be linked back to the profile for workspace matching.
    #[serde(default)]
    pub profile_id: Option<String>,
    /// Optional initial remote directory. When set, the shell runs `cd` to this
    /// path after startup. Ignored if `default_command` is set.
    #[serde(default)]
    pub initial_cwd: Option<String>,
}

fn default_ssh_port() -> u16 {
    22
}

fn default_ssh_username() -> String {
    "root".into()
}

impl SshConnectRequest {
    #[must_use]
    pub fn to_params(&self) -> SshSessionParams {
        SshSessionParams {
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            auth_method: self.auth.clone(),
            default_command: self.default_command.clone(),
            profile_id: self.profile_id.clone(),
            workspace_id: None,
            initial_cwd: self.initial_cwd.clone(),
        }
    }
}

/// 从 Profile ID 创建 SSH 会话的请求
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SshProfileConnectRequest {
    pub profile_id: String,
    /// Workspace selected by the caller. This disambiguates workspaces that
    /// share one SSH profile but use different remote roots.
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// Optional initial remote directory. When set, the shell runs `cd` to this
    /// path after startup. Ignored if the profile has a `default_command`.
    #[serde(default)]
    pub initial_cwd: Option<String>,
}

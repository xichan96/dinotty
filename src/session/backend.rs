use crate::settings::SshAuthMethod;
use tokio::sync::mpsc;

/// SSH 会话参数，用于分屏时复用连接信息
#[derive(Clone, Debug)]
pub struct SshSessionParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SshAuthMethod,
    pub default_command: Option<String>,
    /// The `SshProfile.id` when created from a saved profile. `None` for quick-connect.
    pub profile_id: Option<String>,
    /// The workspace that initiated this SSH session, when explicitly selected.
    pub workspace_id: Option<String>,
    /// Initial remote directory to `cd` into after the shell starts.
    /// When `None` or empty, the shell starts in the remote `$HOME`.
    pub initial_cwd: Option<String>,
}

/// Session 的传输后端
pub enum SessionBackend {
    /// 本地 PTY
    Local {
        writer: Box<dyn std::io::Write + Send>,
        master: Box<dyn portable_pty::MasterPty + Send>,
        child: Box<dyn portable_pty::Child + Send + Sync>,
    },
    /// SSH 远程连接 - channel 已移至 reader task，此处仅保留标记
    Ssh,
    /// Backend resources were already dropped after the child exited.
    Exited,
}

/// Commands sent from Session methods to the SSH reader/writer task.
pub enum SshCmd {
    /// Write input data to the SSH channel
    Input(Vec<u8>),
    /// Resize the SSH channel
    Resize(u16, u16),
    /// Close the SSH channel
    Close,
}

/// SSH keyboard-interactive auth prompt
#[derive(Clone, Debug, serde::Serialize)]
pub struct SshAuthPrompt {
    pub prompt: String,
    pub echo: bool,
}

/// Pending SSH keyboard-interactive auth state
///
/// Channel flow:
/// - SSH handler -> `prompts_tx` -> `prompts_rx` -> sync WS -> frontend
/// - frontend -> sync WS -> `responses_tx` -> `responses_rx` -> SSH handler
pub struct PendingSshAuth {
    pub prompts_tx: mpsc::UnboundedSender<Vec<SshAuthPrompt>>,
    pub prompts_rx: tokio::sync::Mutex<mpsc::UnboundedReceiver<Vec<SshAuthPrompt>>>,
    pub responses_tx: mpsc::UnboundedSender<Vec<String>>,
    pub responses_rx: tokio::sync::Mutex<mpsc::UnboundedReceiver<Vec<String>>>,
}

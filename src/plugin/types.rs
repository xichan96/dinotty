use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex as TokioMutex};

// ─── Core Types ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(rename = "minAppVersion")]
    pub min_app_version: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub entry: Option<String>,
    pub bin: Option<BinConfig>,
    pub commands: Option<Vec<CommandDef>>,
    pub styles: Option<String>,
    pub permissions: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BinConfig {
    pub mode: String,
    #[serde(default)]
    pub entry: Option<String>,
    #[serde(default)]
    pub entries: HashMap<String, String>,
    #[serde(default)]
    pub lifecycle: Option<ProcessLifecycleConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessLifecycleConfig {
    #[serde(default)]
    pub scope: ProcessLifecycleScope,
    #[serde(default)]
    pub stdin_lease: bool,
    #[serde(default = "default_shutdown_deadline_ms")]
    pub shutdown_deadline_ms: u64,
    #[serde(default = "default_force_kill_after_ms")]
    pub force_kill_after_ms: u64,
}

impl Default for ProcessLifecycleConfig {
    fn default() -> Self {
        Self {
            scope: ProcessLifecycleScope::Ui,
            stdin_lease: false,
            shutdown_deadline_ms: default_shutdown_deadline_ms(),
            force_kill_after_ms: default_force_kill_after_ms(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProcessLifecycleScope {
    #[default]
    Ui,
    Host,
}

const fn default_shutdown_deadline_ms() -> u64 {
    10_000
}

const fn default_force_kill_after_ms() -> u64 {
    15_000
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum HostTarget {
    #[serde(rename = "windows-x86_64")]
    WindowsX86_64,
    #[serde(rename = "linux-x86_64")]
    LinuxX86_64,
    #[serde(rename = "linux-aarch64")]
    LinuxAarch64,
    #[serde(rename = "macos-x86_64")]
    MacosX86_64,
    #[serde(rename = "macos-aarch64")]
    MacosAarch64,
}

impl HostTarget {
    #[must_use]
    pub fn current() -> Option<Self> {
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("windows", "x86_64") => Some(Self::WindowsX86_64),
            ("linux", "x86_64") => Some(Self::LinuxX86_64),
            ("linux", "aarch64") => Some(Self::LinuxAarch64),
            ("macos", "x86_64") => Some(Self::MacosX86_64),
            ("macos", "aarch64") => Some(Self::MacosAarch64),
            _ => None,
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::WindowsX86_64 => "windows-x86_64",
            Self::LinuxX86_64 => "linux-x86_64",
            Self::LinuxAarch64 => "linux-aarch64",
            Self::MacosX86_64 => "macos-x86_64",
            Self::MacosAarch64 => "macos-aarch64",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandDef {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub install_date: Option<u64>,
    pub state: PluginStateValue,
    pub error: Option<String>,
    #[serde(rename = "isDevLink", default)]
    pub is_dev_link: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PluginStateValue {
    Active,
    Error,
}

// ─── Request / Response Types ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ExecRequest {
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub timeout: Option<u64>,
}

#[derive(Serialize)]
pub struct ExecResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Deserialize)]
pub struct CryptoHashRequest {
    pub algorithm: String,
    pub data: String,
}

#[derive(Serialize)]
pub struct CryptoHashResponse {
    pub bytes: String,
}

#[derive(Deserialize)]
pub struct CryptoHmacRequest {
    pub algorithm: String,
    pub key: String,
    pub data: String,
}

#[derive(Serialize)]
pub struct CryptoHmacResponse {
    pub bytes: String,
}

#[derive(Deserialize)]
pub struct DevLinkRequest {
    pub path: String,
    #[serde(default)]
    pub approve_native: bool,
}

#[derive(Deserialize)]
pub struct InstallDirRequest {
    pub path: String,
    #[serde(default)]
    pub dev_link: bool,
    #[serde(default)]
    pub approve_native: bool,
}

#[derive(Default, Deserialize)]
pub struct NativeApprovalQuery {
    #[serde(default)]
    pub approve_native: bool,
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    #[serde(default)]
    pub keep_data: bool,
}

#[derive(Deserialize)]
pub struct SpawnQuery {
    pub args: String,
    pub options: Option<String>,
}

#[derive(Default, Deserialize)]
pub struct SpawnOptions {
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Deserialize)]
pub struct ProcessStopAllQuery {
    pub scope: Option<ProcessLifecycleScope>,
}

#[derive(Deserialize)]
pub struct ProcessStartRequest {
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

// ─── Process Types ──────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProcessState {
    Running,
    Exited,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub command: String,
    pub args: Vec<String>,
    pub state: ProcessState,
    pub exit_code: Option<i32>,
}

pub struct ManagedProcess {
    pub info: ProcessInfo,
    pub scope: ProcessLifecycleScope,
    pub control: mpsc::Sender<ProcessControl>,
    pub stop_timeout: std::time::Duration,
    pub stdout: Arc<TokioMutex<std::collections::VecDeque<u8>>>,
    pub stderr: Arc<TokioMutex<std::collections::VecDeque<u8>>>,
}

pub enum ProcessControl {
    Stop { finished: tokio::sync::oneshot::Sender<()> },
}

// ─── Marketplace Types ──────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegistryPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub description_zh: Option<String>,
    pub version: String,
    #[serde(default)]
    pub icon: Option<String>,
    pub repo: String,
    #[serde(default = "default_branch")]
    pub branch: String,
    #[serde(default)]
    pub subdir: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
}

pub(super) fn default_branch() -> String {
    "main".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegistryIndex {
    pub plugins: Vec<RegistryPlugin>,
}

#[derive(Deserialize)]
pub struct InstallGitRequest {
    pub repo: String,
    #[serde(default = "default_branch")]
    pub branch: String,
    #[serde(default)]
    pub subdir: Option<String>,
    #[serde(default)]
    pub approve_native: bool,
}

#[derive(Serialize)]
pub struct MarketPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description_zh: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub repo: String,
    pub branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subdir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    pub has_update: bool,
}

#[cfg(windows)]
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

#[cfg(windows)]
use tokio::sync::{watch, Mutex};

#[cfg(windows)]
use super::process::CommandNoWindowExt;
use super::shell::{
    self, DetectedShell, ShellLaunchKind, ShellPreference, ShellResolveError, ShellSpec,
};

#[cfg(windows)]
const WSL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
#[cfg(windows)]
const WSL_OUTPUT_LIMIT: usize = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProbeAvailability {
    Available,
    Unavailable { reason: &'static str },
    Unknown { reason: &'static str },
}

#[derive(Clone, Debug)]
pub struct ShellProbeSnapshot {
    pub platform: &'static str,
    pub default_shell: DetectedShell,
    pub shells: Vec<DetectedShell>,
    pub warnings: Vec<String>,
    pub wsl_availability: ProbeAvailability,
}

#[derive(Clone, Debug)]
struct WslProbeResult {
    program: Option<String>,
    distributions: Vec<String>,
    warnings: Vec<String>,
    availability: ProbeAvailability,
}

impl WslProbeResult {
    fn unavailable(reason: &'static str) -> Self {
        Self {
            program: None,
            distributions: Vec::new(),
            warnings: Vec::new(),
            availability: ProbeAvailability::Unavailable { reason },
        }
    }

    #[cfg(windows)]
    fn unknown(reason: &'static str) -> Self {
        Self {
            program: None,
            distributions: Vec::new(),
            warnings: vec![reason.to_string()],
            availability: ProbeAvailability::Unknown { reason },
        }
    }
}

#[cfg(windows)]
#[derive(Clone)]
struct InFlightProbe {
    id: u64,
    receiver: watch::Receiver<Option<WslProbeResult>>,
}

#[derive(Clone, Default)]
pub struct ShellProbeService {
    #[cfg(windows)]
    in_flight: Arc<Mutex<Option<InFlightProbe>>>,
    #[cfg(windows)]
    next_probe_id: Arc<AtomicU64>,
}

impl ShellProbeService {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn probe(&self) -> ShellProbeSnapshot {
        let native_task = tokio::task::spawn_blocking(shell::available_native_shells);
        let wsl_task = self.probe_wsl();
        let (native_result, wsl) = tokio::join!(native_task, wsl_task);
        let mut shells = native_result.unwrap_or_else(|error| {
            tracing::warn!(%error, "Native shell probe task failed");
            Vec::new()
        });

        if let Some(program) = &wsl.program {
            shells.push(DetectedShell {
                kind: "wsl".to_string(),
                program: program.clone(),
                distro: None,
            });
            shells.extend(wsl.distributions.iter().map(|distro| DetectedShell {
                kind: "wsl".to_string(),
                program: program.clone(),
                distro: Some(distro.clone()),
            }));
        }

        let default = shell::default_shell();
        ShellProbeSnapshot {
            platform: platform_name(),
            default_shell: DetectedShell {
                kind: shell::default_shell_kind(&default),
                program: default.program,
                distro: None,
            },
            shells,
            warnings: wsl.warnings,
            wsl_availability: wsl.availability,
        }
    }

    /// Resolve a saved preference to an already validated launch specification.
    ///
    /// # Errors
    ///
    /// Returns a stable `ShellResolveError` code when the executable, WSL
    /// capability, or selected distribution cannot be confirmed.
    pub async fn resolve(
        &self,
        preference: &ShellPreference,
    ) -> Result<ShellSpec, ShellResolveError> {
        if preference.kind.trim() != "wsl" {
            let preference = preference.clone();
            return tokio::task::spawn_blocking(move || {
                shell::resolve_native_preference(&preference)
            })
            .await
            .map_err(|error| {
                ShellResolveError::new("shell_unavailable", format!("probe task failed: {error}"))
            })?;
        }

        let probe = self.probe_wsl().await;
        match probe.availability {
            ProbeAvailability::Available => {}
            ProbeAvailability::Unavailable { reason } | ProbeAvailability::Unknown { reason } => {
                return Err(ShellResolveError::new(reason, "WSL is not available"));
            }
        }

        let program = probe.program.ok_or_else(|| {
            ShellResolveError::new("shell_unavailable", "WSL launcher was not detected")
        })?;
        let distro = preference
            .wsl_distro
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string);
        if let Some(name) = &distro {
            if !probe.distributions.iter().any(|candidate| candidate == name) {
                return Err(ShellResolveError::new(
                    "wsl_distro_missing",
                    format!("WSL distribution is not registered: {name}"),
                ));
            }
        }

        Ok(wsl_shell_spec(program, distro))
    }

    #[cfg(not(windows))]
    fn probe_wsl(&self) -> std::future::Ready<WslProbeResult> {
        let _ = self;
        std::future::ready(WslProbeResult::unavailable("wsl_capability_unsupported"))
    }

    #[cfg(windows)]
    async fn probe_wsl(&self) -> WslProbeResult {
        let mut receiver = {
            let mut in_flight = self.in_flight.lock().await;
            let active_receiver = in_flight.as_ref().and_then(|flight| {
                flight.receiver.borrow().is_none().then(|| flight.receiver.clone())
            });
            if let Some(receiver) = active_receiver {
                receiver
            } else {
                let id = self.next_probe_id.fetch_add(1, Ordering::Relaxed);
                let (sender, receiver) = watch::channel(None);
                *in_flight = Some(InFlightProbe { id, receiver: receiver.clone() });

                let service = self.clone();
                tokio::spawn(async move {
                    let result = run_wsl_probe().await;
                    if sender.send(Some(result)).is_err() {
                        tracing::warn!("WSL probe result had no receiver");
                    }
                    let mut current = service.in_flight.lock().await;
                    if current.as_ref().is_some_and(|flight| flight.id == id) {
                        *current = None;
                    }
                });
                receiver
            }
        };

        loop {
            if let Some(result) = receiver.borrow().clone() {
                return result;
            }
            if receiver.changed().await.is_err() {
                return WslProbeResult::unknown("wsl_list_failed");
            }
        }
    }
}

fn wsl_shell_spec(program: String, distro: Option<String>) -> ShellSpec {
    let mut args = Vec::new();
    if let Some(name) = &distro {
        args.push("--distribution".to_string());
        args.push(name.clone());
    }
    ShellSpec {
        program,
        args,
        shell_type: "wsl".to_string(),
        launch_kind: ShellLaunchKind::Wsl { distro },
    }
}

#[cfg(windows)]
async fn run_wsl_probe() -> WslProbeResult {
    let Some(program_path) = system_wsl_path() else {
        return WslProbeResult::unavailable("shell_unavailable");
    };
    let program = program_path.to_string_lossy().into_owned();

    // Current Windows WSL builds can return 0xffffffff for --help even when
    // they emit a complete help document, so capability checks validate the
    // decoded output rather than requiring a successful exit code.
    let help = match run_wsl_command(&program_path, &["--help"], false).await {
        Ok(output) => output,
        Err(reason) => return WslProbeResult::unknown(reason),
    };
    let Ok(help) = decode_wsl_text(&help) else {
        return WslProbeResult::unknown("wsl_output_invalid");
    };
    let supports_distribution = help.contains("--distribution") || help.contains("-d,");
    if !supports_distribution || !help.contains("--cd") {
        return WslProbeResult {
            program: None,
            distributions: Vec::new(),
            warnings: vec!["wsl_capability_unsupported".to_string()],
            availability: ProbeAvailability::Unavailable { reason: "wsl_capability_unsupported" },
        };
    }

    let output = match run_wsl_command(&program_path, &["--list", "--quiet"], true).await {
        Ok(output) => output,
        Err(reason) => return WslProbeResult::unknown(reason),
    };
    let Ok(distributions) = parse_wsl_distributions(&output) else {
        return WslProbeResult::unknown("wsl_output_invalid");
    };
    if distributions.is_empty() {
        return WslProbeResult {
            program: None,
            distributions,
            warnings: vec!["wsl_no_distributions".to_string()],
            availability: ProbeAvailability::Unavailable { reason: "shell_unavailable" },
        };
    }

    WslProbeResult {
        program: Some(program),
        distributions,
        warnings: Vec::new(),
        availability: ProbeAvailability::Available,
    }
}

#[cfg(windows)]
fn system_wsl_path() -> Option<std::path::PathBuf> {
    let windows = std::env::var_os("WINDIR").map(std::path::PathBuf::from)?;
    #[cfg(target_pointer_width = "32")]
    {
        let sysnative = windows.join("Sysnative").join("wsl.exe");
        if sysnative.is_file() {
            return Some(sysnative);
        }
    }
    let system32 = windows.join("System32").join("wsl.exe");
    system32.is_file().then_some(system32)
}

#[cfg(windows)]
async fn run_wsl_command(
    program: &std::path::Path,
    args: &[&str],
    require_success: bool,
) -> Result<Vec<u8>, &'static str> {
    use std::process::Stdio;

    use tokio::io::AsyncReadExt;

    let mut command = tokio::process::Command::new(program);
    command
        .no_window_with_stdio()
        .args(args)
        .env("WSL_UTF8", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        tracing::warn!(?args, %error, "Failed to start WSL probe command");
        "wsl_list_failed"
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        tracing::warn!(?args, "WSL probe stdout pipe was unavailable");
        "wsl_list_failed"
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        tracing::warn!(?args, "WSL probe stderr pipe was unavailable");
        "wsl_list_failed"
    })?;

    let collect = async {
        let read_stdout = async {
            let mut bytes = Vec::new();
            stdout.take((WSL_OUTPUT_LIMIT + 1) as u64).read_to_end(&mut bytes).await.map(|_| bytes)
        };
        let read_stderr = async {
            let mut bytes = Vec::new();
            stderr.take((WSL_OUTPUT_LIMIT + 1) as u64).read_to_end(&mut bytes).await.map(|_| bytes)
        };
        let (stdout, stderr, status) = tokio::join!(read_stdout, read_stderr, child.wait());
        (stdout, stderr, status)
    };

    if let Ok((stdout, stderr, status)) = tokio::time::timeout(WSL_TIMEOUT, collect).await {
        let stdout = stdout.map_err(|error| {
            tracing::warn!(?args, %error, "Failed to read WSL probe stdout");
            "wsl_list_failed"
        })?;
        let stderr = stderr.map_err(|error| {
            tracing::warn!(?args, %error, "Failed to read WSL probe stderr");
            "wsl_list_failed"
        })?;
        let status = status.map_err(|error| {
            tracing::warn!(?args, %error, "Failed to wait for WSL probe command");
            "wsl_list_failed"
        })?;
        if stdout.len().saturating_add(stderr.len()) > WSL_OUTPUT_LIMIT {
            return Err("wsl_output_invalid");
        }
        if !wsl_command_output_is_usable(require_success, status.success(), stdout.is_empty()) {
            tracing::warn!(
                ?args,
                exit_code = status.code(),
                stderr_bytes = stderr.len(),
                "WSL probe command exited unsuccessfully"
            );
            return Err("wsl_list_failed");
        }
        Ok(stdout)
    } else {
        let _ = child.start_kill();
        let _ = child.wait().await;
        Err("wsl_timeout")
    }
}

#[cfg(windows)]
const fn wsl_command_output_is_usable(
    require_success: bool,
    status_success: bool,
    stdout_empty: bool,
) -> bool {
    status_success || (!require_success && !stdout_empty)
}

#[cfg(windows)]
fn parse_wsl_distributions(bytes: &[u8]) -> Result<Vec<String>, ()> {
    let decoded = decode_wsl_text(bytes)?;
    let mut distributions = Vec::new();
    for line in decoded.trim_start_matches('\u{feff}').lines() {
        let name = line.trim();
        if name.is_empty() {
            continue;
        }
        if name.chars().any(|character| character == '\u{fffd}' || character.is_control()) {
            return Err(());
        }
        if !distributions.iter().any(|existing| existing == name) {
            distributions.push(name.to_string());
        }
    }
    Ok(distributions)
}

#[cfg(windows)]
fn decode_wsl_text(bytes: &[u8]) -> Result<String, ()> {
    let has_bom = bytes.starts_with(&[0xff, 0xfe]);
    let body = if has_bom { &bytes[2..] } else { bytes };
    let odd_nuls = body.iter().skip(1).step_by(2).filter(|byte| **byte == 0).count();
    let looks_utf16 = has_bom || (!body.is_empty() && odd_nuls * 4 >= body.len());
    if looks_utf16 {
        if body.len() % 2 != 0 {
            return Err(());
        }
        let units = body.chunks_exact(2).map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]));
        return std::char::decode_utf16(units).collect::<Result<String, _>>().map_err(|_| ());
    }
    std::str::from_utf8(body).map(str::to_string).map_err(|_| ())
}

const fn platform_name() -> &'static str {
    #[cfg(windows)]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "linux"
    }
    #[cfg(not(any(unix, windows)))]
    {
        "unknown"
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{
        decode_wsl_text, parse_wsl_distributions, wsl_command_output_is_usable, wsl_shell_spec,
    };

    fn utf16le(value: &str, with_bom: bool) -> Vec<u8> {
        let mut bytes = if with_bom { vec![0xff, 0xfe] } else { Vec::new() };
        bytes.extend(value.encode_utf16().flat_map(u16::to_le_bytes));
        bytes
    }

    #[test]
    fn parses_utf16_with_or_without_bom_and_deduplicates() {
        for bytes in [
            utf16le("Ubuntu\r\nDebian\r\nUbuntu\r\n", true),
            utf16le("Ubuntu\r\nDebian\r\nUbuntu\r\n", false),
        ] {
            assert_eq!(parse_wsl_distributions(&bytes).unwrap(), ["Ubuntu", "Debian"]);
        }
    }

    #[test]
    fn parses_utf8_unicode_names() {
        assert_eq!(
            parse_wsl_distributions("Ubuntu\n开发环境\n".as_bytes()).unwrap(),
            ["Ubuntu", "开发环境"]
        );
    }

    #[test]
    fn rejects_invalid_encodings_and_control_characters() {
        assert!(decode_wsl_text(&[0xff, 0xfe, 0x00]).is_err());
        assert!(decode_wsl_text(&[0xff, 0xfe, 0x00, 0xd8]).is_err());
        assert!(parse_wsl_distributions(b"Ubuntu\0evil\n").is_err());
        assert!(parse_wsl_distributions(b"Ubuntu\tDev\n").is_err());
        assert!(decode_wsl_text(&[0xff]).is_err());
    }

    #[test]
    fn distribution_name_remains_one_launch_argument() {
        let spec = wsl_shell_spec(
            r"C:\Windows\System32\wsl.exe".to_string(),
            Some("Ubuntu Dev & Tools".to_string()),
        );

        assert_eq!(spec.args, ["--distribution", "Ubuntu Dev & Tools"]);
    }

    #[test]
    fn help_output_can_be_valid_despite_wsl_exit_code() {
        assert!(wsl_command_output_is_usable(false, false, false));
        assert!(!wsl_command_output_is_usable(false, false, true));
        assert!(!wsl_command_output_is_usable(true, false, false));
    }
}

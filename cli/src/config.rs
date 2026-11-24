//! Configuration resolution: base URL, pane id, and auth-token discovery.
//!
//! Precedence (highest first) is documented in `docs/dinotty-cli.md`:
//! CLI flag, environment variable, `/api/auto-token` (loopback only), then the
//! token file written by the desktop app.

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use crate::args::GlobalOptions;
use crate::error::CliError;

pub const DEFAULT_URL: &str = "http://127.0.0.1:8999";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub base_url: String,
    pub pane_id: Option<String>,
    /// Explicit token (flag or `DINOTTY_TOKEN`); file/auto discovery happens in
    /// the HTTP client so a failure there can still fall through.
    pub token: Option<String>,
}

impl Config {
    /// # Errors
    /// Returns a usage error when the URL is empty, malformed, or not HTTP(S).
    pub fn from_options(options: &GlobalOptions) -> Result<Self, CliError> {
        let raw_url = options
            .url
            .clone()
            .or_else(|| env_non_empty("DINOTTY_URL"))
            .unwrap_or_else(|| DEFAULT_URL.to_string());
        let base_url = normalize_base_url(&raw_url)?;
        let pane_id = options
            .pane
            .clone()
            .or_else(|| env_non_empty("DINOTTY_PANE_ID"))
            .filter(|pane| !pane.trim().is_empty());
        let token = options
            .token
            .clone()
            .or_else(|| env_non_empty("DINOTTY_TOKEN"))
            .filter(|token| !token.trim().is_empty());
        Ok(Self { base_url, pane_id, token })
    }

    /// # Errors
    /// Returns a usage error when no pane id was supplied.
    pub fn require_pane(&self) -> Result<&str, CliError> {
        self.pane_id.as_deref().ok_or_else(|| {
            CliError::usage(
                "pane id required: pass --pane, set DINOTTY_PANE_ID, or name it on the command line",
            )
        })
    }
}

fn env_non_empty(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.trim().is_empty())
}

/// Normalise a base URL and validate its scheme.
///
/// # Errors
/// Returns a usage error for empty, unparseable, or non-HTTP(S) URLs.
pub fn normalize_base_url(raw: &str) -> Result<String, CliError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(CliError::usage("base URL must not be empty"));
    }
    let with_scheme =
        if trimmed.contains("://") { trimmed.to_string() } else { format!("http://{trimmed}") };
    let url = reqwest::Url::parse(&with_scheme)
        .map_err(|error| CliError::usage(format!("invalid base URL {raw:?}: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(CliError::usage(format!(
            "unsupported URL scheme {:?}: use http or https",
            url.scheme()
        )));
    }
    Ok(url.to_string().trim_end_matches('/').to_string())
}

/// Whether `/api/auto-token` may be attempted for this URL.
#[must_use]
pub fn is_loopback_url(url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };
    match url.host_str() {
        Some("localhost") => true,
        Some(host) => {
            let bare = host.trim_start_matches('[').trim_end_matches(']');
            IpAddr::from_str(bare).is_ok_and(|ip| ip.is_loopback())
        }
        None => false,
    }
}

/// Token-file locations in priority order.
///
/// The desktop app stores the token in `config_dir()/dinotty<suffix>/token`.
/// `data_dir()` variants cover Linux `$XDG_DATA_HOME` installs and older
/// layouts; on macOS both resolve to `~/Library/Application Support`, and on
/// Windows `config_dir()` is `%APPDATA%`.
#[must_use]
pub fn token_file_candidates(
    config_dir: Option<&Path>,
    data_dir: Option<&Path>,
    suffix: &str,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut push = |base: Option<&Path>, suffix: &str| {
        if let Some(base) = base {
            let path = base.join(format!("dinotty{suffix}")).join("token");
            if !candidates.contains(&path) {
                candidates.push(path);
            }
        }
    };
    push(config_dir, suffix);
    push(data_dir, suffix);
    if !suffix.is_empty() {
        // The running build may not have compiled in the suffix the CLI sees.
        push(config_dir, "");
        push(data_dir, "");
    }
    candidates
}

/// First readable, non-empty token from the candidate files.
#[must_use]
pub fn read_token_file(candidates: &[PathBuf]) -> Option<String> {
    candidates.iter().find_map(|path| {
        std::fs::read_to_string(path)
            .ok()
            .map(|contents| contents.trim().to_string())
            .filter(|token| !token.is_empty())
    })
}

/// Candidate paths for this machine, honouring `DINOTTY_CONFIG_SUFFIX`.
#[must_use]
pub fn local_token_file_candidates() -> Vec<PathBuf> {
    let suffix = env_non_empty("DINOTTY_CONFIG_SUFFIX").unwrap_or_default();
    token_file_candidates(dirs::config_dir().as_deref(), dirs::data_dir().as_deref(), &suffix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_urls_and_adds_a_scheme() {
        assert_eq!(normalize_base_url("127.0.0.1:9000").unwrap(), "http://127.0.0.1:9000");
        assert_eq!(
            normalize_base_url("https://example.test/dinotty/").unwrap(),
            "https://example.test/dinotty"
        );
        assert!(normalize_base_url("   ").unwrap_err().message.contains("must not be empty"));
        assert!(normalize_base_url("ftp://example.test").unwrap_err().message.contains("scheme"));
    }

    #[test]
    fn detects_loopback_hosts_only() {
        assert!(is_loopback_url("http://127.0.0.1:8999"));
        assert!(is_loopback_url("http://127.1.2.3:8999"));
        assert!(is_loopback_url("http://localhost:8999"));
        assert!(is_loopback_url("http://[::1]:8999"));
        assert!(!is_loopback_url("http://192.168.1.2:8999"));
        assert!(!is_loopback_url("https://dinotty.example.test"));
    }

    #[test]
    fn token_candidates_prefer_the_config_directory() {
        let candidates =
            token_file_candidates(Some(Path::new("/cfg")), Some(Path::new("/data")), "-test");
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/cfg/dinotty-test/token"),
                PathBuf::from("/data/dinotty-test/token"),
                PathBuf::from("/cfg/dinotty/token"),
                PathBuf::from("/data/dinotty/token"),
            ]
        );
    }

    #[test]
    fn token_candidates_deduplicate_platform_paths() {
        let candidates =
            token_file_candidates(Some(Path::new("/same")), Some(Path::new("/same")), "");
        assert_eq!(candidates, vec![PathBuf::from("/same/dinotty/token")]);
    }

    #[test]
    fn reads_the_first_usable_token_file() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing");
        let empty = directory.path().join("empty");
        let valid = directory.path().join("valid");
        std::fs::write(&empty, "\n  \n").unwrap();
        std::fs::write(&valid, "  secret-token\n").unwrap();

        let candidates = vec![missing, empty, valid];
        assert_eq!(read_token_file(&candidates).as_deref(), Some("secret-token"));
        assert_eq!(read_token_file(&[]), None);
    }
}

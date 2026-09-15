use std::{sync::Arc, time::Duration as StdDuration};

use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use reqwest::header::{ACCEPT, ETAG, IF_NONE_MATCH, RETRY_AFTER, USER_AGENT};
use semver::Version;
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use tokio::{sync::Mutex, time::Instant};

use crate::plugin::HostTarget;

const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/xichan96/dinotty/releases/latest";
const RELEASE_PATH_PREFIX: &str = "/xichan96/dinotty/releases/tag/";
const DOWNLOAD_PATH_PREFIX: &str = "/xichan96/dinotty/releases/download/";
/// Every desktop bundle is named from `tauri.conf.json`'s `productName`. The
/// standalone server's releases are lowercase (`dinotty-server_0.26.0-1_amd64.deb`),
/// so requiring this exact prefix is what keeps `select_assets` from offering the
/// server package as a desktop update.
const ASSET_NAME_PREFIX: &str = "Dinotty_";
const GITHUB_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_API_VERSION: &str = "2022-11-28";
const SUCCESS_TTL: StdDuration = StdDuration::from_hours(6);
const FAILURE_BACKOFF: StdDuration = StdDuration::from_mins(10);
const MAX_FAILURE_BACKOFF: StdDuration = StdDuration::from_hours(6);

pub type UpdateCheckState = Arc<UpdateChecker>;

#[derive(Debug, Clone, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    published_at: String,
    draft: bool,
    prerelease: bool,
    /// Absent from a release with no uploaded artifacts, and from older
    /// mocked payloads, so this must default rather than fail the whole check.
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: Option<u64>,
    /// GitHub reports `"uploaded"` once the artifact is downloadable; anything
    /// else (e.g. `"new"`) means the release is mid-publish and the URL would 404.
    #[serde(default)]
    state: Option<String>,
}

/// Which desktop bundle an asset is, which decides both the file extension and
/// the architecture spelling inside the name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    Dmg,
    #[serde(rename = "appimage")]
    AppImage,
    Deb,
    Nsis,
    Portable,
}

impl AssetKind {
    const fn extension(self) -> &'static str {
        match self {
            Self::Dmg => ".dmg",
            Self::AppImage => ".appimage",
            Self::Deb => ".deb",
            Self::Nsis | Self::Portable => ".exe",
        }
    }

    /// The arch token this bundle kind uses. The four spellings are not
    /// interchangeable: `AppImage` says `aarch64` where deb says `arm64`, and
    /// Windows says `x64` where Linux says `amd64`.
    const fn arch_token(self, target: HostTarget) -> Option<&'static str> {
        match (self, target) {
            (Self::Dmg, HostTarget::MacosAarch64) | (Self::AppImage, HostTarget::LinuxAarch64) => {
                Some("aarch64")
            }
            (Self::Dmg, HostTarget::MacosX86_64)
            | (Self::Nsis | Self::Portable, HostTarget::WindowsX86_64) => Some("x64"),
            (Self::AppImage | Self::Deb, HostTarget::LinuxX86_64) => Some("amd64"),
            (Self::Deb, HostTarget::LinuxAarch64) => Some("arm64"),
            _ => None,
        }
    }

    /// The suffix Windows bundles carry between the arch token and `.exe`.
    const fn windows_suffix(self) -> Option<&'static str> {
        match self {
            Self::Nsis => Some("-setup"),
            Self::Portable => Some("-portable"),
            _ => None,
        }
    }
}

/// A downloadable installer, already vetted as an official release asset URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DownloadAsset {
    pub name: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    pub kind: AssetKind,
}

#[derive(Debug, Clone)]
struct ValidatedRelease {
    version: Version,
    release_url: String,
    /// The publication timestamp, echoed to clients exactly as GitHub sent it.
    published_at: String,
    download: Option<DownloadAsset>,
    alternates: Vec<DownloadAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum UpdateStatus {
    UpToDate {
        current_version: String,
        latest_version: String,
    },
    UpdateAvailable {
        current_version: String,
        latest_version: String,
        published_at: String,
        release_url: String,
        /// The installer for the platform the server is running on. Absent when
        /// the release ships nothing this platform can use (e.g. an Intel Mac,
        /// for which no `.dmg` is published), which is a graceful state the UI
        /// falls back from to the release page.
        #[serde(skip_serializing_if = "Option::is_none")]
        download: Option<DownloadAsset>,
        /// Lower-preference bundles for the same platform (Linux `.deb`
        /// alongside the preferred `.AppImage`).
        #[serde(skip_serializing_if = "Vec::is_empty")]
        alternates: Vec<DownloadAsset>,
    },
}

#[derive(Default)]
struct Cache {
    release: Option<ValidatedRelease>,
    etag: Option<String>,
    validated_at: Option<Instant>,
    backoff_until: Option<Instant>,
}

struct CheckerConfig {
    api_url: String,
    success_ttl: StdDuration,
    failure_backoff: StdDuration,
    max_failure_backoff: StdDuration,
}

pub struct UpdateChecker {
    client: reqwest::Client,
    current_version: Version,
    user_agent: String,
    config: CheckerConfig,
    cache: Mutex<Cache>,
}

impl UpdateChecker {
    /// Creates a checker for the official Dinotty release feed.
    ///
    /// # Panics
    ///
    /// Panics if the package version embedded by Cargo is not valid semantic versioning.
    #[must_use]
    pub fn new() -> UpdateCheckState {
        let client = reqwest::Client::builder()
            .connect_timeout(StdDuration::from_secs(3))
            .timeout(StdDuration::from_secs(8))
            .build()
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "failed to configure update-check HTTP client; using defaults");
                reqwest::Client::new()
            });
        let current_version = Version::parse(env!("CARGO_PKG_VERSION"))
            .unwrap_or_else(|error| panic!("CARGO_PKG_VERSION must be valid semver: {error}"));

        Arc::new(Self {
            client,
            user_agent: format!("dinotty/{current_version}"),
            current_version,
            config: CheckerConfig {
                api_url: GITHUB_LATEST_RELEASE_URL.to_string(),
                success_ttl: SUCCESS_TTL,
                failure_backoff: FAILURE_BACKOFF,
                max_failure_backoff: MAX_FAILURE_BACKOFF,
            },
            cache: Mutex::new(Cache::default()),
        })
    }

    async fn check(&self) -> Result<UpdateStatus, String> {
        self.check_at(OffsetDateTime::now_utc()).await
    }

    /// A user-initiated check. `force` skips only the success-TTL reuse below;
    /// the failure backoff still applies, so a manual button cannot be used to
    /// hammer the GitHub API. The request keeps sending `If-None-Match`, so an
    /// unchanged release still answers with a cheap 304 that costs no quota.
    async fn check_forced(&self) -> Result<UpdateStatus, String> {
        self.check_at_with(OffsetDateTime::now_utc(), true).await
    }

    async fn check_at(&self, now: OffsetDateTime) -> Result<UpdateStatus, String> {
        self.check_at_with(now, false).await
    }

    async fn check_at_with(
        &self,
        now: OffsetDateTime,
        force: bool,
    ) -> Result<UpdateStatus, String> {
        let monotonic_now = Instant::now();
        let mut cache = self.cache.lock().await;

        if !force && self.cache_is_usable(&cache, monotonic_now) {
            return cache
                .release
                .as_ref()
                .map(|release| classify_release(&self.current_version, release))
                .ok_or_else(|| "usable cache did not contain a release".to_string());
        }

        if cache.backoff_until.is_some_and(|until| monotonic_now < until) {
            return Err("update check is in failure backoff".to_string());
        }

        match self.refresh(&mut cache, monotonic_now, now).await {
            Ok(status) => Ok(status),
            Err(failure) => {
                let delay =
                    failure.retry_after.map_or(self.config.failure_backoff, |server_delay| {
                        server_delay.max(self.config.failure_backoff)
                    });
                cache.backoff_until =
                    Some(monotonic_now + delay.min(self.config.max_failure_backoff));
                tracing::warn!(reason = %failure.message, "GitHub update check unavailable");
                Err(failure.message)
            }
        }
    }

    fn cache_is_usable(&self, cache: &Cache, monotonic_now: Instant) -> bool {
        let Some(validated_at) = cache.validated_at else {
            return false;
        };
        monotonic_now.saturating_duration_since(validated_at) < self.config.success_ttl
    }

    async fn refresh(
        &self,
        cache: &mut Cache,
        monotonic_now: Instant,
        now: OffsetDateTime,
    ) -> Result<UpdateStatus, RefreshFailure> {
        let mut request = self
            .client
            .get(&self.config.api_url)
            .header(ACCEPT, GITHUB_ACCEPT)
            .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
            .header(USER_AGENT, &self.user_agent);
        if let Some(etag) = &cache.etag {
            request = request.header(IF_NONE_MATCH, etag);
        }

        let response = request.send().await.map_err(|error| RefreshFailure {
            message: format!("request failed: {error}"),
            retry_after: None,
        })?;
        let status = response.status();

        if status == reqwest::StatusCode::NOT_MODIFIED {
            let release = cache.release.as_ref().ok_or_else(|| RefreshFailure {
                message: "GitHub returned 304 without a cached release".to_string(),
                retry_after: None,
            })?;
            cache.validated_at = Some(monotonic_now);
            cache.backoff_until = None;
            return Ok(classify_release(&self.current_version, release));
        }

        if !status.is_success() {
            let retry_after = retry_delay(response.headers(), now);
            return Err(RefreshFailure {
                message: format!("GitHub returned HTTP {status}"),
                retry_after,
            });
        }

        let etag =
            response.headers().get(ETAG).and_then(|value| value.to_str().ok()).map(str::to_owned);
        let release: GitHubRelease = response.json().await.map_err(|error| RefreshFailure {
            message: format!("invalid GitHub response: {error}"),
            retry_after: None,
        })?;
        let release = validate_release(release)
            .map_err(|message| RefreshFailure { message, retry_after: None })?;

        cache.validated_at = Some(monotonic_now);
        cache.release = Some(release);
        cache.etag = etag;
        cache.backoff_until = None;

        cache
            .release
            .as_ref()
            .map(|release| classify_release(&self.current_version, release))
            .ok_or_else(|| RefreshFailure {
                message: "validated release was not cached".to_string(),
                retry_after: None,
            })
    }
}

struct RefreshFailure {
    message: String,
    retry_after: Option<StdDuration>,
}

fn validate_release(release: GitHubRelease) -> Result<ValidatedRelease, String> {
    if release.draft || release.prerelease {
        return Err("latest release was marked draft or prerelease".to_string());
    }

    let version_text = release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name);
    let version = Version::parse(version_text)
        .map_err(|error| format!("invalid release tag {}: {error}", release.tag_name))?;
    if !version.pre.is_empty() {
        return Err("latest release tag contains a prerelease version".to_string());
    }

    // The timestamp is echoed to clients verbatim, so reject a release whose
    // publication time is not a real RFC3339 instant rather than forwarding it.
    OffsetDateTime::parse(&release.published_at, &Rfc3339)
        .map_err(|error| format!("invalid published_at: {error}"))?;
    let release_url = validate_release_url(&release.html_url, &release.tag_name)?;
    let (download, alternates) =
        select_assets(&release.assets, &release.tag_name, &version, HostTarget::current());

    Ok(ValidatedRelease {
        version,
        release_url,
        published_at: release.published_at,
        download,
        alternates,
    })
}

/// Picks the installer(s) matching this platform, preferring the earlier entries
/// of [`asset_preferences`].
///
/// An asset that fails [`validate_release_asset_url`] is dropped rather than
/// failing the whole check: a release with one malformed asset should still be
/// announced, just without a download link.
fn select_assets(
    assets: &[GitHubAsset],
    tag: &str,
    version: &Version,
    target: Option<HostTarget>,
) -> (Option<DownloadAsset>, Vec<DownloadAsset>) {
    let Some(target) = target else {
        return (None, Vec::new());
    };
    let eligible: Vec<&GitHubAsset> = assets
        .iter()
        .filter(|asset| asset.state.as_deref().is_none_or(|state| state == "uploaded"))
        .collect();

    // One asset per preferred kind, best kind first, so `download` is the head
    // and the remaining kinds become `alternates`.
    let mut found: Vec<DownloadAsset> = asset_preferences(target)
        .iter()
        .filter_map(|kind| {
            // Try the expected name first so an unrelated similarly-named
            // bundle cannot displace the canonical one.
            let exact = format!(
                "{ASSET_NAME_PREFIX}{version}_{}{}{}",
                kind.arch_token(target).unwrap_or_default(),
                kind.windows_suffix().unwrap_or_default(),
                kind.extension()
            );
            let candidate =
                eligible
                    .iter()
                    .find(|asset| asset.name.eq_ignore_ascii_case(&exact))
                    .or_else(|| eligible.iter().find(|asset| asset.name_matches(*kind, target)))?;
            let url =
                validate_release_asset_url(&candidate.browser_download_url, tag, &candidate.name)
                    .ok()?;
            Some(DownloadAsset {
                name: candidate.name.clone(),
                url,
                size: candidate.size,
                kind: *kind,
            })
        })
        .collect();

    let download = if found.is_empty() { None } else { Some(found.remove(0)) };
    (download, found)
}

/// The bundles to offer this platform, best first.
fn asset_preferences(target: HostTarget) -> &'static [AssetKind] {
    match target {
        HostTarget::MacosAarch64 | HostTarget::MacosX86_64 => &[AssetKind::Dmg],
        HostTarget::WindowsX86_64 => &[AssetKind::Nsis, AssetKind::Portable],
        HostTarget::LinuxX86_64 | HostTarget::LinuxAarch64 => {
            &[AssetKind::AppImage, AssetKind::Deb]
        }
    }
}

impl GitHubAsset {
    /// Fallback matcher for a bundle whose version or arch spelling drifted from
    /// the expected name. Deliberately stricter than a substring test: the arch
    /// token must be its own `-`/`_`-delimited segment, so `amd64` cannot match
    /// inside `Dinotty_0.27.0_x86_64_amd64_extra.AppImage`-style names by luck.
    fn name_matches(&self, kind: AssetKind, target: HostTarget) -> bool {
        let Some(token) = kind.arch_token(target) else {
            return false;
        };
        let name = self.name.to_ascii_lowercase();
        if !name.starts_with(&ASSET_NAME_PREFIX.to_ascii_lowercase())
            || !name.ends_with(kind.extension())
        {
            return false;
        }
        let has_segment = name.split(['-', '_', '.']).any(|segment| segment == token);
        match kind.windows_suffix() {
            Some(suffix) => {
                // `-setup` must not be matched by the portable rule, or vice versa.
                let stem = &name[..name.len() - kind.extension().len()];
                stem.ends_with(suffix)
            }
            None => has_segment && !name.contains("-portable"),
        }
    }
}

/// Accepts only an official Dinotty release-asset URL, and only when its
/// filename and tag agree with the asset the caller believes it is fetching.
///
/// Public so the desktop download command can re-validate independently: the
/// URL crosses the webview IPC boundary, which is untrusted input.
///
/// # Errors
///
/// Returns an error when `raw_url` is not a well-formed URL, or when it is not
/// an `https://github.com/xichan96/dinotty/releases/download/{tag}/{name}` URL
/// matching `expected_tag` and `expected_name`.
pub fn validate_release_asset_url(
    raw_url: &str,
    expected_tag: &str,
    expected_name: &str,
) -> Result<String, String> {
    let url =
        reqwest::Url::parse(raw_url).map_err(|error| format!("invalid asset URL: {error}"))?;
    let path_is_exact = url
        .path()
        .strip_prefix(DOWNLOAD_PATH_PREFIX)
        .and_then(|rest| rest.split_once('/'))
        .is_some_and(|(tag, file)| tag == expected_tag && file == expected_name);
    let valid = url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && !expected_tag.is_empty()
        && !expected_name.is_empty()
        && !expected_name.contains('/')
        && !expected_name.contains("..")
        && path_is_exact;
    if !valid {
        return Err("asset URL is not an official Dinotty release asset URL".to_string());
    }
    Ok(url.into())
}

fn validate_release_url(raw_url: &str, expected_tag: &str) -> Result<String, String> {
    let url =
        reqwest::Url::parse(raw_url).map_err(|error| format!("invalid release URL: {error}"))?;
    let tag = url.path().strip_prefix(RELEASE_PATH_PREFIX);
    let valid = url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && tag == Some(expected_tag)
        && !expected_tag.is_empty();
    if !valid {
        return Err("release URL is not an official Dinotty release URL".to_string());
    }
    Ok(url.into())
}

/// A newer release is announced the moment GitHub publishes it: there is no
/// notification delay. A release whose bundles are still uploading is held back
/// by [`select_assets`] alone, which ignores assets that are not `uploaded` yet.
fn classify_release(current_version: &Version, release: &ValidatedRelease) -> UpdateStatus {
    let latest_version = release.version.to_string();
    let current_version_text = current_version.to_string();

    if release.version <= *current_version {
        return UpdateStatus::UpToDate { current_version: current_version_text, latest_version };
    }
    UpdateStatus::UpdateAvailable {
        current_version: current_version_text,
        latest_version,
        published_at: release.published_at.clone(),
        release_url: release.release_url.clone(),
        download: release.download.clone(),
        alternates: release.alternates.clone(),
    }
}

fn retry_delay(headers: &HeaderMap, now: OffsetDateTime) -> Option<StdDuration> {
    let retry_after = headers
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(StdDuration::from_secs);
    let rate_limit_reset = headers
        .get("x-ratelimit-reset")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
        .and_then(|reset| reset.checked_sub(now.unix_timestamp()))
        .and_then(|seconds| u64::try_from(seconds).ok())
        .map(StdDuration::from_secs);

    retry_after.into_iter().chain(rate_limit_reset).max()
}

/// Query for the update-check endpoint. `force` is matched by presence rather
/// than parsed as a `bool` so a hand-typed `?force=abc` reads as "no force"
/// instead of rejecting the request with a 400.
#[derive(Debug, Default, Deserialize)]
pub struct UpdateCheckQuery {
    #[serde(default)]
    force: Option<String>,
}

impl UpdateCheckQuery {
    fn is_forced(&self) -> bool {
        matches!(self.force.as_deref(), Some("1" | "true" | "yes"))
    }
}

pub async fn get_update_status(
    State(checker): State<UpdateCheckState>,
    Query(query): Query<UpdateCheckQuery>,
) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    let status =
        if query.is_forced() { checker.check_forced().await } else { checker.check().await };
    match status {
        Ok(status) => (StatusCode::OK, headers, Json(status)).into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            headers,
            Json(serde_json::json!({ "error": "update_check_unavailable" })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use time::Duration;

    use axum::{routing::get, Router};
    use tokio::task::JoinHandle;

    fn github_release(tag: &str, published_at: &str) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag.to_string(),
            html_url: format!("https://github.com/xichan96/dinotty/releases/tag/{tag}"),
            published_at: published_at.to_string(),
            draft: false,
            prerelease: false,
            assets: Vec::new(),
        }
    }

    /// A release published a moment ago — the case that must be announced
    /// immediately, with the bundles GitHub already reports as uploaded.
    fn validated_with_bundles(tag: &str) -> ValidatedRelease {
        let version = tag.strip_prefix('v').unwrap();
        let mut release = github_release(tag, &OffsetDateTime::now_utc().format(&Rfc3339).unwrap());
        release.assets = release_assets(tag, version);
        validate_release(release).unwrap()
    }

    #[derive(Clone)]
    struct MockState {
        calls: Arc<AtomicUsize>,
        saw_etag: Arc<AtomicBool>,
        published_at: String,
        delay: StdDuration,
        return_not_modified: bool,
        fail_after_first: bool,
    }

    async fn mock_latest_release(State(state): State<MockState>, headers: HeaderMap) -> Response {
        let call = state.calls.fetch_add(1, Ordering::SeqCst) + 1;
        if !state.delay.is_zero() {
            tokio::time::sleep(state.delay).await;
        }
        if state.fail_after_first && call > 1 {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        if headers.get(IF_NONE_MATCH).is_some() {
            state.saw_etag.store(true, Ordering::SeqCst);
            if state.return_not_modified {
                return StatusCode::NOT_MODIFIED.into_response();
            }
        }

        let mut response = Json(serde_json::json!({
            "tag_name": "v0.21.0",
            "html_url": "https://github.com/xichan96/dinotty/releases/tag/v0.21.0",
            "published_at": state.published_at,
            "draft": false,
            "prerelease": false,
        }))
        .into_response();
        response.headers_mut().insert(ETAG, HeaderValue::from_static("\"release-v1\""));
        response
    }

    async fn spawn_mock(state: MockState) -> (String, JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route("/latest", get(mock_latest_release)).with_state(state);
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}/latest"), task)
    }

    fn test_checker(api_url: String, success_ttl: StdDuration) -> UpdateCheckState {
        Arc::new(UpdateChecker {
            client: reqwest::Client::builder().timeout(StdDuration::from_secs(2)).build().unwrap(),
            current_version: Version::parse("0.20.0").unwrap(),
            user_agent: "dinotty/test".to_string(),
            config: CheckerConfig {
                api_url,
                success_ttl,
                failure_backoff: FAILURE_BACKOFF,
                max_failure_backoff: MAX_FAILURE_BACKOFF,
            },
            cache: Mutex::new(Cache::default()),
        })
    }

    #[test]
    fn classifies_versions() {
        let current = Version::parse("0.20.0").unwrap();

        assert!(matches!(
            classify_release(&current, &validated_with_bundles("v0.20.0")),
            UpdateStatus::UpToDate { .. }
        ));
        assert!(matches!(
            classify_release(&current, &validated_with_bundles("v0.19.0")),
            UpdateStatus::UpToDate { .. }
        ));
    }

    /// A release that went public seconds ago is announced immediately. This is
    /// the regression guard against reintroducing a notification delay: users
    /// must get the download for a version that already has its bundles uploaded.
    #[test]
    fn announces_a_just_published_release() {
        let current = Version::parse("0.26.0").unwrap();
        match classify_release(&current, &validated_with_bundles("v0.27.0")) {
            UpdateStatus::UpdateAvailable { latest_version, download, published_at, .. } => {
                assert_eq!(latest_version, "0.27.0");
                assert!(!published_at.is_empty());
                // The host running the tests may have no matching bundle (e.g. an
                // Intel Mac), so assert against the same selector the handler uses.
                let (expected, _) = select_assets(
                    &release_assets("v0.27.0", "0.27.0"),
                    "v0.27.0",
                    &Version::parse("0.27.0").unwrap(),
                    HostTarget::current(),
                );
                assert_eq!(download, expected);
            }
            other => panic!("expected an immediate update, got {other:?}"),
        }
    }

    #[test]
    fn rejects_untrusted_or_mismatched_release_data() {
        let published_at = OffsetDateTime::UNIX_EPOCH.format(&Rfc3339).unwrap();
        for url in [
            "http://github.com/xichan96/dinotty/releases/tag/v0.21.0",
            "https://example.com/xichan96/dinotty/releases/tag/v0.21.0",
            "https://github.com:444/xichan96/dinotty/releases/tag/v0.21.0",
            "https://github.com/xichan96/dinotty/releases/tag/v0.21.0/extra",
            "https://github.com/xichan96/dinotty/releases/tag/v9.9.9",
        ] {
            let mut release = github_release("v0.21.0", &published_at);
            release.html_url = url.to_string();
            assert!(validate_release(release).is_err(), "accepted {url}");
        }

        let mut prerelease = github_release("v0.21.0-beta.1", &published_at);
        prerelease.prerelease = false;
        assert!(validate_release(prerelease).is_err());
        assert!(validate_release(github_release("not-a-version", &published_at)).is_err());
    }

    /// The real v0.26.0 asset list, including the two `dinotty-server_*.deb`
    /// packages that must never be offered as a desktop update.
    fn release_assets(tag: &str, version: &str) -> Vec<GitHubAsset> {
        let asset = |name: &str| GitHubAsset {
            name: name.to_string(),
            browser_download_url: format!(
                "https://github.com/xichan96/dinotty/releases/download/{tag}/{name}"
            ),
            size: Some(1_000),
            state: Some("uploaded".to_string()),
        };
        vec![
            asset(&format!("dinotty-server_{version}-1_amd64.deb")),
            asset(&format!("dinotty-server_{version}-1_arm64.deb")),
            asset(&format!("Dinotty_{version}_aarch64.AppImage")),
            asset(&format!("Dinotty_{version}_aarch64.dmg")),
            asset(&format!("Dinotty_{version}_amd64.AppImage")),
            asset(&format!("Dinotty_{version}_amd64.deb")),
            asset(&format!("Dinotty_{version}_arm64.deb")),
            asset(&format!("Dinotty_{version}_x64-portable.exe")),
            asset(&format!("Dinotty_{version}_x64-setup.exe")),
        ]
    }

    fn selected_names(
        assets: &[GitHubAsset],
        tag: &str,
        version: &str,
        target: HostTarget,
    ) -> Vec<String> {
        let version = Version::parse(version).unwrap();
        let (download, alternates) = select_assets(assets, tag, &version, Some(target));
        download.into_iter().chain(alternates).map(|asset| asset.name).collect()
    }

    #[test]
    fn selects_the_expected_bundle_per_host_target() {
        let assets = release_assets("v0.26.0", "0.26.0");

        assert_eq!(
            selected_names(&assets, "v0.26.0", "0.26.0", HostTarget::MacosAarch64),
            ["Dinotty_0.26.0_aarch64.dmg"]
        );
        // No Intel dmg is published, so an Intel Mac gets nothing rather than a
        // link that would 404.
        assert!(selected_names(&assets, "v0.26.0", "0.26.0", HostTarget::MacosX86_64).is_empty());
        assert_eq!(
            selected_names(&assets, "v0.26.0", "0.26.0", HostTarget::LinuxX86_64),
            ["Dinotty_0.26.0_amd64.AppImage", "Dinotty_0.26.0_amd64.deb"]
        );
        // The arch token differs per bundle kind on arm: `aarch64` for the
        // AppImage, `arm64` for the deb.
        assert_eq!(
            selected_names(&assets, "v0.26.0", "0.26.0", HostTarget::LinuxAarch64),
            ["Dinotty_0.26.0_aarch64.AppImage", "Dinotty_0.26.0_arm64.deb"]
        );
        assert_eq!(
            selected_names(&assets, "v0.26.0", "0.26.0", HostTarget::WindowsX86_64),
            ["Dinotty_0.26.0_x64-setup.exe", "Dinotty_0.26.0_x64-portable.exe"]
        );
    }

    #[test]
    fn never_offers_the_server_package_as_a_desktop_update() {
        let assets = release_assets("v0.26.0", "0.26.0");
        for target in [
            HostTarget::MacosAarch64,
            HostTarget::MacosX86_64,
            HostTarget::LinuxX86_64,
            HostTarget::LinuxAarch64,
            HostTarget::WindowsX86_64,
        ] {
            for name in selected_names(&assets, "v0.26.0", "0.26.0", target) {
                assert!(name.starts_with("Dinotty_"), "picked {name} for {target:?}");
            }
        }
    }

    #[test]
    fn skips_assets_that_are_not_uploaded_yet() {
        let mut assets = release_assets("v0.26.0", "0.26.0");
        for asset in &mut assets {
            if asset.name.to_ascii_lowercase().ends_with(".dmg") {
                asset.state = Some("new".to_string());
            }
        }
        assert!(selected_names(&assets, "v0.26.0", "0.26.0", HostTarget::MacosAarch64).is_empty());
    }

    #[test]
    fn falls_back_to_extension_matching_when_the_exact_name_changes() {
        // A future rename to `_arm64.dmg`: pass 1 misses, the segment-aware
        // fallback still finds it.
        let assets = vec![GitHubAsset {
            name: "Dinotty_0.27.0_arm64.dmg".to_string(),
            browser_download_url:
                "https://github.com/xichan96/dinotty/releases/download/v0.27.0/Dinotty_0.27.0_arm64.dmg"
                    .to_string(),
            size: None,
            state: None,
        }];
        // `arm64` is not macOS's token, so this must NOT match by accident.
        assert!(selected_names(&assets, "v0.27.0", "0.27.0", HostTarget::MacosAarch64).is_empty());

        let renamed = vec![GitHubAsset {
            name: "Dinotty_0.27.0_aarch64.dmg".to_string(),
            browser_download_url:
                "https://github.com/xichan96/dinotty/releases/download/v0.27.0/Dinotty-0.27.0-aarch64.dmg"
                    .to_string(),
            size: None,
            state: None,
        }];
        // Filename in the URL disagrees with the asset name -> rejected, not
        // silently downgraded to a different asset.
        assert!(selected_names(&renamed, "v0.27.0", "0.27.0", HostTarget::MacosAarch64).is_empty());
    }

    #[test]
    fn rejects_untrusted_asset_urls() {
        let tag = "v0.26.0";
        let name = "Dinotty_0.26.0_aarch64.dmg";
        for url in [
            format!("http://github.com/xichan96/dinotty/releases/download/{tag}/{name}"),
            format!("https://example.com/xichan96/dinotty/releases/download/{tag}/{name}"),
            format!("https://github.com:444/xichan96/dinotty/releases/download/{tag}/{name}"),
            format!("https://github.com/xichan96/dinotty/releases/download/v9.9.9/{name}"),
            format!("https://github.com/xichan96/dinotty/releases/download/{tag}/other.dmg"),
            format!("https://github.com/xichan96/dinotty/releases/tag/{tag}"),
            format!("https://github.com/xichan96/dinotty/releases/download/{tag}/{name}?x=1"),
            format!("https://github.com/xichan96/dinotty/releases/download/{tag}/sub/{name}"),
            format!("https://github.com/xichan96/dinotty/releases/download/{tag}/..%2f{name}"),
        ] {
            assert!(validate_release_asset_url(&url, tag, name).is_err(), "accepted {url}");
        }

        let good = format!("https://github.com/xichan96/dinotty/releases/download/{tag}/{name}");
        assert_eq!(validate_release_asset_url(&good, tag, name).unwrap(), good);
        // A mismatched expected name must not be accepted just because the URL
        // is otherwise well-formed.
        assert!(validate_release_asset_url(&good, tag, "other.dmg").is_err());
        assert!(validate_release_asset_url(&good, tag, "").is_err());
    }

    #[test]
    fn chooses_longer_server_backoff() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, HeaderValue::from_static("30"));
        headers.insert("x-ratelimit-reset", HeaderValue::from_static("120"));
        assert_eq!(retry_delay(&headers, now), Some(StdDuration::from_mins(2)));
    }

    #[tokio::test]
    async fn caches_success_and_revalidates_with_etag() {
        let now = OffsetDateTime::now_utc();
        let state = MockState {
            calls: Arc::new(AtomicUsize::new(0)),
            saw_etag: Arc::new(AtomicBool::new(false)),
            published_at: (now - Duration::hours(48)).format(&Rfc3339).unwrap(),
            delay: StdDuration::ZERO,
            return_not_modified: true,
            fail_after_first: false,
        };
        let (api_url, task) = spawn_mock(state.clone()).await;
        let checker = test_checker(api_url, StdDuration::ZERO);

        assert!(matches!(
            checker.check_at(now).await.unwrap(),
            UpdateStatus::UpdateAvailable { .. }
        ));
        assert!(matches!(
            checker.check_at(now).await.unwrap(),
            UpdateStatus::UpdateAvailable { .. }
        ));
        assert_eq!(state.calls.load(Ordering::SeqCst), 2);
        assert!(state.saw_etag.load(Ordering::SeqCst));
        task.abort();
    }

    #[tokio::test]
    async fn concurrent_checks_share_one_upstream_request() {
        let now = OffsetDateTime::now_utc();
        let state = MockState {
            calls: Arc::new(AtomicUsize::new(0)),
            saw_etag: Arc::new(AtomicBool::new(false)),
            published_at: (now - Duration::hours(48)).format(&Rfc3339).unwrap(),
            delay: StdDuration::from_millis(30),
            return_not_modified: false,
            fail_after_first: false,
        };
        let (api_url, task) = spawn_mock(state.clone()).await;
        let checker = test_checker(api_url, StdDuration::from_mins(1));
        let checks = (0..8).map(|_| checker.check_at(now));
        let results = futures_util::future::join_all(checks).await;

        assert!(results.iter().all(Result::is_ok));
        assert_eq!(state.calls.load(Ordering::SeqCst), 1);
        task.abort();
    }

    #[tokio::test]
    async fn refresh_failure_does_not_serve_expired_update() {
        let now = OffsetDateTime::now_utc();
        let state = MockState {
            calls: Arc::new(AtomicUsize::new(0)),
            saw_etag: Arc::new(AtomicBool::new(false)),
            published_at: (now - Duration::hours(48)).format(&Rfc3339).unwrap(),
            delay: StdDuration::ZERO,
            return_not_modified: false,
            fail_after_first: true,
        };
        let (api_url, task) = spawn_mock(state.clone()).await;
        let checker = test_checker(api_url, StdDuration::ZERO);

        assert!(checker.check_at(now).await.is_ok());
        assert!(checker.check_at(now).await.is_err());
        assert!(checker.check_at(now).await.is_err());
        assert_eq!(state.calls.load(Ordering::SeqCst), 2);
        task.abort();
    }

    #[tokio::test]
    async fn forced_check_bypasses_the_success_ttl() {
        let now = OffsetDateTime::now_utc();
        let state = MockState {
            calls: Arc::new(AtomicUsize::new(0)),
            saw_etag: Arc::new(AtomicBool::new(false)),
            published_at: (now - Duration::hours(48)).format(&Rfc3339).unwrap(),
            delay: StdDuration::ZERO,
            return_not_modified: false,
            fail_after_first: false,
        };
        let (api_url, task) = spawn_mock(state.clone()).await;
        // A long TTL means the second unforced check is served from cache.
        let checker = test_checker(api_url, StdDuration::from_hours(6));

        assert!(checker.check_at(now).await.is_ok());
        assert!(checker.check_at(now).await.is_ok());
        assert_eq!(state.calls.load(Ordering::SeqCst), 1);

        // The manual path re-asks upstream despite the fresh success cache.
        assert!(checker.check_at_with(now, true).await.is_ok());
        assert_eq!(state.calls.load(Ordering::SeqCst), 2);
        task.abort();
    }

    #[tokio::test]
    async fn forced_check_still_revalidates_with_etag() {
        let now = OffsetDateTime::now_utc();
        let state = MockState {
            calls: Arc::new(AtomicUsize::new(0)),
            saw_etag: Arc::new(AtomicBool::new(false)),
            published_at: (now - Duration::hours(48)).format(&Rfc3339).unwrap(),
            delay: StdDuration::ZERO,
            return_not_modified: true,
            fail_after_first: false,
        };
        let (api_url, task) = spawn_mock(state.clone()).await;
        let checker = test_checker(api_url, StdDuration::from_hours(6));

        assert!(checker.check_at(now).await.is_ok());
        assert!(matches!(
            checker.check_at_with(now, true).await.unwrap(),
            UpdateStatus::UpdateAvailable { .. }
        ));
        // Still one upstream request, answered by a conditional 304 that costs
        // no rate-limit quota.
        assert_eq!(state.calls.load(Ordering::SeqCst), 2);
        assert!(state.saw_etag.load(Ordering::SeqCst));
        task.abort();
    }

    #[tokio::test]
    async fn forced_check_still_respects_failure_backoff() {
        let now = OffsetDateTime::now_utc();
        let state = MockState {
            calls: Arc::new(AtomicUsize::new(0)),
            saw_etag: Arc::new(AtomicBool::new(false)),
            published_at: (now - Duration::hours(48)).format(&Rfc3339).unwrap(),
            delay: StdDuration::ZERO,
            return_not_modified: false,
            fail_after_first: true,
        };
        let (api_url, task) = spawn_mock(state.clone()).await;
        let checker = test_checker(api_url, StdDuration::ZERO);

        assert!(checker.check_at(now).await.is_ok());
        assert!(checker.check_at(now).await.is_err());
        let calls_after_failure = state.calls.load(Ordering::SeqCst);

        // A user mashing the manual button must not reach GitHub while the
        // backoff armed by the failure is still in effect.
        for _ in 0..5 {
            assert!(checker.check_at_with(now, true).await.is_err());
        }
        assert_eq!(state.calls.load(Ordering::SeqCst), calls_after_failure);
        task.abort();
    }

    #[tokio::test]
    async fn handler_reports_the_platform_download_for_a_fresh_release() {
        // Published a moment ago: the handler must still answer with the
        // platform's own bundle rather than holding the release back.
        let published_at = OffsetDateTime::now_utc().format(&Rfc3339).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let assets = release_assets("v0.21.0", "0.21.0");
        let served_assets = assets.clone();
        let app = Router::new().route(
            "/latest",
            get(move || {
                let published_at = published_at.clone();
                let assets = served_assets.clone();
                async move {
                    let mut response = Json(serde_json::json!({
                        "tag_name": "v0.21.0",
                        "html_url": "https://github.com/xichan96/dinotty/releases/tag/v0.21.0",
                        "published_at": published_at,
                        "draft": false,
                        "prerelease": false,
                        "assets": assets.iter().map(|asset| serde_json::json!({
                            "name": asset.name,
                            "browser_download_url": asset.browser_download_url,
                            "size": asset.size,
                            "state": asset.state,
                        })).collect::<Vec<_>>(),
                    }))
                    .into_response();
                    response.headers_mut().insert(ETAG, HeaderValue::from_static("\"v1\""));
                    response
                }
            }),
        );
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let checker = test_checker(format!("http://{address}/latest"), SUCCESS_TTL);
        let response = get_update_status(
            State(checker),
            Query(UpdateCheckQuery { force: Some("1".to_string()) }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");

        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["status"], "update_available");

        // The download carries the platform's own bundle. The test host is
        // whatever CI runs on, so assert against the same selector rather than
        // hard-coding a filename.
        let (expected, _) = select_assets(
            &assets,
            "v0.21.0",
            &Version::parse("0.21.0").unwrap(),
            HostTarget::current(),
        );
        match expected {
            Some(expected) => {
                assert_eq!(value["download"]["name"], expected.name);
                assert_eq!(value["download"]["url"], expected.url);
            }
            // Hosts with no matching bundle (e.g. Intel Mac) must simply omit
            // the field rather than emit a null.
            None => assert!(value.get("download").is_none(), "unexpected download: {value}"),
        }
        task.abort();
    }

    #[tokio::test]
    async fn handler_sets_no_store_for_success_and_stable_failures() {
        let now = OffsetDateTime::now_utc();
        let success_state = MockState {
            calls: Arc::new(AtomicUsize::new(0)),
            saw_etag: Arc::new(AtomicBool::new(false)),
            published_at: (now - Duration::hours(48)).format(&Rfc3339).unwrap(),
            delay: StdDuration::ZERO,
            return_not_modified: false,
            fail_after_first: false,
        };
        let (success_url, success_task) = spawn_mock(success_state).await;
        let response = get_update_status(
            State(test_checker(success_url, SUCCESS_TTL)),
            Query(UpdateCheckQuery::default()),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
        success_task.abort();

        let failure_state = MockState {
            calls: Arc::new(AtomicUsize::new(1)),
            saw_etag: Arc::new(AtomicBool::new(false)),
            published_at: now.format(&Rfc3339).unwrap(),
            delay: StdDuration::ZERO,
            return_not_modified: false,
            fail_after_first: true,
        };
        let (failure_url, failure_task) = spawn_mock(failure_state).await;
        let response = get_update_status(
            State(test_checker(failure_url, SUCCESS_TTL)),
            Query(UpdateCheckQuery::default()),
        )
        .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(body, r#"{"error":"update_check_unavailable"}"#);
        failure_task.abort();
    }
}

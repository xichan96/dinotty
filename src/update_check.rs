use std::{sync::Arc, time::Duration as StdDuration};

use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use reqwest::header::{ACCEPT, ETAG, IF_NONE_MATCH, RETRY_AFTER, USER_AGENT};
use semver::Version;
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};
use tokio::{sync::Mutex, time::Instant};

const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/xichan96/dinotty/releases/latest";
const RELEASE_PATH_PREFIX: &str = "/xichan96/dinotty/releases/tag/";
const GITHUB_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_API_VERSION: &str = "2022-11-28";
const SUCCESS_TTL: StdDuration = StdDuration::from_hours(6);
const FAILURE_BACKOFF: StdDuration = StdDuration::from_mins(10);
const MAX_FAILURE_BACKOFF: StdDuration = StdDuration::from_hours(6);
const RELEASE_GRACE_PERIOD: Duration = Duration::hours(24);

pub type UpdateCheckState = Arc<UpdateChecker>;

#[derive(Debug, Clone, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    published_at: String,
    draft: bool,
    prerelease: bool,
}

#[derive(Debug, Clone)]
struct ValidatedRelease {
    version: Version,
    release_url: String,
    published_at: OffsetDateTime,
    published_at_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum UpdateStatus {
    UpToDate {
        current_version: String,
        latest_version: String,
    },
    GracePeriod {
        current_version: String,
        latest_version: String,
        published_at: String,
    },
    UpdateAvailable {
        current_version: String,
        latest_version: String,
        published_at: String,
        release_url: String,
    },
}

#[derive(Default)]
struct Cache {
    release: Option<ValidatedRelease>,
    etag: Option<String>,
    validated_at: Option<Instant>,
    validated_after_grace: bool,
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

    async fn check_at(&self, now: OffsetDateTime) -> Result<UpdateStatus, String> {
        let monotonic_now = Instant::now();
        let mut cache = self.cache.lock().await;

        if self.cache_is_usable(&cache, monotonic_now, now) {
            return cache
                .release
                .as_ref()
                .map(|release| classify_release(&self.current_version, release, now))
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

    fn cache_is_usable(&self, cache: &Cache, monotonic_now: Instant, now: OffsetDateTime) -> bool {
        let (Some(release), Some(validated_at)) = (&cache.release, cache.validated_at) else {
            return false;
        };
        if monotonic_now.saturating_duration_since(validated_at) >= self.config.success_ttl {
            return false;
        }

        let crossed_unvalidated_grace = release.version > self.current_version
            && now >= release.published_at + RELEASE_GRACE_PERIOD
            && !cache.validated_after_grace;
        !crossed_unvalidated_grace
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
            cache.validated_after_grace = now >= release.published_at + RELEASE_GRACE_PERIOD;
            cache.backoff_until = None;
            return Ok(classify_release(&self.current_version, release, now));
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

        cache.validated_after_grace = now >= release.published_at + RELEASE_GRACE_PERIOD;
        cache.validated_at = Some(monotonic_now);
        cache.release = Some(release);
        cache.etag = etag;
        cache.backoff_until = None;

        cache
            .release
            .as_ref()
            .map(|release| classify_release(&self.current_version, release, now))
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

    let published_at = OffsetDateTime::parse(&release.published_at, &Rfc3339)
        .map_err(|error| format!("invalid published_at: {error}"))?;
    if published_at.checked_add(RELEASE_GRACE_PERIOD).is_none() {
        return Err("published_at is outside the supported range".to_string());
    }
    let release_url = validate_release_url(&release.html_url, &release.tag_name)?;

    Ok(ValidatedRelease {
        version,
        release_url,
        published_at,
        published_at_text: release.published_at,
    })
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

fn classify_release(
    current_version: &Version,
    release: &ValidatedRelease,
    now: OffsetDateTime,
) -> UpdateStatus {
    let latest_version = release.version.to_string();

    if release.version <= *current_version {
        let current_version = current_version.to_string();
        return UpdateStatus::UpToDate { current_version, latest_version };
    }
    let current_version = current_version.to_string();
    if now < release.published_at + RELEASE_GRACE_PERIOD {
        return UpdateStatus::GracePeriod {
            current_version,
            latest_version,
            published_at: release.published_at_text.clone(),
        };
    }
    UpdateStatus::UpdateAvailable {
        current_version,
        latest_version,
        published_at: release.published_at_text.clone(),
        release_url: release.release_url.clone(),
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

pub async fn get_update_status(State(checker): State<UpdateCheckState>) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    match checker.check().await {
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

    use axum::{routing::get, Router};
    use tokio::task::JoinHandle;

    fn github_release(tag: &str, published_at: &str) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag.to_string(),
            html_url: format!("https://github.com/xichan96/dinotty/releases/tag/{tag}"),
            published_at: published_at.to_string(),
            draft: false,
            prerelease: false,
        }
    }

    fn validated(tag: &str, published_at: OffsetDateTime) -> ValidatedRelease {
        let published_at_text = published_at.format(&Rfc3339).unwrap();
        validate_release(github_release(tag, &published_at_text)).unwrap()
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
    fn classifies_versions_and_grace_boundary() {
        let current = Version::parse("0.20.0").unwrap();
        let published_at = OffsetDateTime::UNIX_EPOCH;

        assert!(matches!(
            classify_release(&current, &validated("v0.20.0", published_at), published_at),
            UpdateStatus::UpToDate { .. }
        ));
        assert!(matches!(
            classify_release(&current, &validated("v0.19.0", published_at), published_at),
            UpdateStatus::UpToDate { .. }
        ));
        assert!(matches!(
            classify_release(
                &current,
                &validated("v0.21.0", published_at),
                published_at + Duration::hours(24) - Duration::seconds(1),
            ),
            UpdateStatus::GracePeriod { .. }
        ));
        assert!(matches!(
            classify_release(
                &current,
                &validated("v0.21.0", published_at),
                published_at + Duration::hours(24),
            ),
            UpdateStatus::UpdateAvailable { .. }
        ));
        assert!(matches!(
            classify_release(
                &current,
                &validated("v0.21.0", published_at + Duration::hours(1)),
                published_at,
            ),
            UpdateStatus::GracePeriod { .. }
        ));
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
    async fn revalidates_after_grace_even_when_success_cache_is_fresh() {
        let published_at = OffsetDateTime::now_utc();
        let before_grace = published_at + Duration::hours(23);
        let after_grace = published_at + Duration::hours(25);
        let state = MockState {
            calls: Arc::new(AtomicUsize::new(0)),
            saw_etag: Arc::new(AtomicBool::new(false)),
            published_at: published_at.format(&Rfc3339).unwrap(),
            delay: StdDuration::ZERO,
            return_not_modified: true,
            fail_after_first: false,
        };
        let (api_url, task) = spawn_mock(state.clone()).await;
        let checker = test_checker(api_url, StdDuration::from_hours(6));

        assert!(matches!(
            checker.check_at(before_grace).await.unwrap(),
            UpdateStatus::GracePeriod { .. }
        ));
        assert!(matches!(
            checker.check_at(after_grace).await.unwrap(),
            UpdateStatus::UpdateAvailable { .. }
        ));
        assert_eq!(state.calls.load(Ordering::SeqCst), 2);
        assert!(state.saw_etag.load(Ordering::SeqCst));
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
        let response = get_update_status(State(test_checker(success_url, SUCCESS_TTL))).await;
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
        let response = get_update_status(State(test_checker(failure_url, SUCCESS_TTL))).await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(body, r#"{"error":"update_check_unavailable"}"#);
        failure_task.abort();
    }
}

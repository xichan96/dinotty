use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, Response, StatusCode, Uri},
};
use serde::Serialize;

use crate::auth::{constant_time_eq, session::SessionStore, session_cookie_name};

const MAX_CLIPBOARD_BYTES: usize = 256 * 1024;
const NO_STORE: HeaderValue = HeaderValue::from_static("no-store");

/// Clipboard read failed or is unavailable on this host.
#[derive(Debug, Clone, Copy)]
pub struct ClipboardError;

pub trait ClipboardProvider: Send + Sync {
    /// Read text from the host clipboard.
    ///
    /// # Errors
    ///
    /// Returns [`ClipboardError`] when the clipboard is unavailable or the read fails.
    fn read_text(&self) -> Result<String, ClipboardError>;
}

#[derive(Default)]
pub struct ArboardClipboardProvider;

impl ClipboardProvider for ArboardClipboardProvider {
    fn read_text(&self) -> Result<String, ClipboardError> {
        let mut clipboard = arboard::Clipboard::new().map_err(|_| ClipboardError)?;
        match clipboard.get_text() {
            Ok(text) => Ok(text),
            Err(arboard::Error::ContentNotAvailable) => Ok(String::new()),
            Err(_) => Err(ClipboardError),
        }
    }
}

#[derive(Clone)]
pub struct ClipboardState {
    pub auth_token: Arc<tokio::sync::RwLock<String>>,
    pub sessions: Arc<SessionStore>,
    pub port: u16,
    pub provider: Arc<dyn ClipboardProvider>,
}

impl ClipboardState {
    #[must_use]
    pub fn new(
        auth_token: Arc<tokio::sync::RwLock<String>>,
        sessions: Arc<SessionStore>,
        port: u16,
    ) -> Self {
        Self { auth_token, sessions, port, provider: Arc::new(ArboardClipboardProvider) }
    }

    #[must_use]
    pub fn with_provider(mut self, provider: Arc<dyn ClipboardProvider>) -> Self {
        self.provider = provider;
        self
    }
}

#[derive(Serialize)]
struct ClipboardResponse {
    text: String,
}

fn json_response(status: StatusCode, body: String) -> Response<Body> {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response.headers_mut().insert(header::CACHE_CONTROL, NO_STORE);
    response
}

fn error_response(status: StatusCode, error: &'static str) -> Response<Body> {
    json_response(status, format!(r#"{{"error":"{error}"}}"#))
}

fn bearer_is_valid(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|candidate| constant_time_eq(candidate.trim(), token))
}

fn valid_session_cookie(headers: &HeaderMap, sessions: &SessionStore, port: u16) -> bool {
    let Some(raw) = headers.get(header::COOKIE).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let prefix = format!("{}=", session_cookie_name(port));
    raw.split(';')
        .map(str::trim)
        .find_map(|pair| pair.strip_prefix(&prefix))
        .is_some_and(|session_id| sessions.validate(session_id))
}

fn request_scheme(headers: &HeaderMap, uri: &Uri) -> String {
    uri.scheme_str()
        .or_else(|| {
            headers
                .get("x-forwarded-proto")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.split(',').next())
                .map(str::trim)
        })
        .unwrap_or("http")
        .to_string()
}

fn cookie_request_has_same_origin(headers: &HeaderMap, uri: &Uri) -> bool {
    if let Some(site) = headers.get("sec-fetch-site") {
        return site.to_str().is_ok_and(|value| matches!(value.trim(), "same-origin" | "none"));
    }

    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .or_else(|| uri.authority().map(axum::http::uri::Authority::as_str));
    let Some(host) = host else {
        return false;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let expected = format!("{}://{}", request_scheme(headers, uri), host.trim());
    origin.trim_end_matches('/') == expected
}

/// Read host clipboard text after enforcing the sensitive-route authentication policy.
///
/// Clipboard contents and provider error details are intentionally never logged.
pub async fn get_clipboard(
    State(state): State<ClipboardState>,
    request: Request,
) -> Response<Body> {
    let token = state.auth_token.read().await.clone();
    if token.is_empty() {
        return error_response(StatusCode::FORBIDDEN, "forbidden");
    }

    let bearer = bearer_is_valid(request.headers(), &token);
    let cookie = valid_session_cookie(request.headers(), &state.sessions, state.port);
    if !bearer && !cookie {
        return error_response(StatusCode::FORBIDDEN, "forbidden");
    }
    if !bearer && !cookie_request_has_same_origin(request.headers(), request.uri()) {
        return error_response(StatusCode::FORBIDDEN, "forbidden");
    }

    let provider = state.provider.clone();
    let Ok(Ok(text)) = tokio::task::spawn_blocking(move || provider.read_text()).await else {
        return error_response(StatusCode::SERVICE_UNAVAILABLE, "clipboard unavailable");
    };

    if text.len() > MAX_CLIPBOARD_BYTES {
        return error_response(StatusCode::PAYLOAD_TOO_LARGE, "clipboard too large");
    }

    match serde_json::to_string(&ClipboardResponse { text }) {
        Ok(body) => json_response(StatusCode::OK, body),
        Err(_) => error_response(StatusCode::SERVICE_UNAVAILABLE, "clipboard unavailable"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::{middleware, routing::get, Router};
    use tower::ServiceExt;

    use crate::settings::{Settings, SettingsState};

    struct MockClipboard(Result<String, ClipboardError>);

    impl ClipboardProvider for MockClipboard {
        fn read_text(&self) -> Result<String, ClipboardError> {
            self.0.clone()
        }
    }

    fn state(token: &str, result: Result<String, ClipboardError>) -> ClipboardState {
        ClipboardState::new(
            Arc::new(tokio::sync::RwLock::new(token.to_string())),
            Arc::new(SessionStore::new(7)),
            8999,
        )
        .with_provider(Arc::new(MockClipboard(result)))
    }

    fn request(headers: &[(&str, &str)]) -> Request {
        let mut builder = Request::builder().uri("http://dinotty.test:8999/api/clipboard");
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        builder.body(Body::empty()).unwrap()
    }

    async fn response_body(response: Response<Body>) -> String {
        String::from_utf8(to_bytes(response.into_body(), usize::MAX).await.unwrap().to_vec())
            .unwrap()
    }

    fn assert_no_store(response: &Response<Body>) {
        assert_eq!(response.headers().get(header::CACHE_CONTROL), Some(&NO_STORE));
    }

    #[tokio::test]
    async fn empty_token_mode_is_forbidden_and_no_store() {
        let response = get_clipboard(State(state("", Ok("secret".into()))), request(&[])).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_no_store(&response);
        assert_eq!(response_body(response).await, r#"{"error":"forbidden"}"#);
    }

    #[tokio::test]
    async fn missing_credentials_are_unauthorized_before_the_sensitive_handler() {
        let clipboard_state = state("token", Ok("secret".into()));
        let sessions = clipboard_state.sessions.clone();
        let settings: SettingsState = Arc::new(tokio::sync::RwLock::new(Settings {
            ip_whitelist: vec![],
            ..Settings::default()
        }));
        let app = Router::new()
            .route("/api/clipboard", get(get_clipboard))
            .layer(middleware::from_fn(move |request, next| {
                let sessions = sessions.clone();
                let settings = settings.clone();
                async move {
                    crate::auth::auth_middleware(
                        request,
                        next,
                        "token",
                        &settings,
                        &sessions,
                        "203.0.113.9".parse().unwrap(),
                        8999,
                    )
                    .await
                }
            }))
            .with_state(clipboard_state);

        let response = app
            .oneshot(Request::builder().uri("/api/clipboard").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_no_store(&response);
        assert_eq!(response_body(response).await, r#"{"error":"unauthorized"}"#);
    }

    #[tokio::test]
    async fn whitelist_only_request_without_cookie_or_bearer_is_forbidden() {
        let response =
            get_clipboard(State(state("token", Ok("secret".into()))), request(&[])).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_no_store(&response);
    }

    #[tokio::test]
    async fn valid_bearer_round_trips_text_with_any_origin() {
        let response = get_clipboard(
            State(state("token", Ok("line one\nline two".into()))),
            request(&[("authorization", "Bearer token"), ("origin", "https://evil.test")]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_no_store(&response);
        assert_eq!(response_body(response).await, r#"{"text":"line one\nline two"}"#);
    }

    #[tokio::test]
    async fn empty_clipboard_round_trips_as_empty_text() {
        let response = get_clipboard(
            State(state("token", Ok(String::new()))),
            request(&[("authorization", "Bearer token")]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_no_store(&response);
        assert_eq!(response_body(response).await, r#"{"text":""}"#);
    }

    #[tokio::test]
    async fn cookie_cross_origin_and_cross_site_requests_are_forbidden_without_acao() {
        for headers in
            [vec![("origin", "http://other.test:8999")], vec![("sec-fetch-site", "cross-site")]]
        {
            let state = state("token", Ok("secret".into()));
            let session_id = state.sessions.create(None, None);
            let cookie = format!("{}={session_id}", session_cookie_name(8999));
            let mut owned = vec![("cookie", cookie.as_str())];
            owned.extend(headers);
            let response = get_clipboard(State(state), request(&owned)).await;
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            assert_no_store(&response);
            assert!(response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
        }
    }

    #[tokio::test]
    async fn same_origin_cookie_is_accepted() {
        for proof in [("sec-fetch-site", "same-origin"), ("origin", "http://dinotty.test:8999")] {
            let state = state("token", Ok("cookie text".into()));
            let session_id = state.sessions.create(None, None);
            let cookie = format!("{}={session_id}", session_cookie_name(8999));
            let response =
                get_clipboard(State(state), request(&[("cookie", cookie.as_str()), proof])).await;
            assert_eq!(response.status(), StatusCode::OK);
            assert_no_store(&response);
        }
    }

    #[tokio::test]
    async fn oversized_and_unavailable_clipboards_are_generic_and_no_store() {
        let oversized = "x".repeat(MAX_CLIPBOARD_BYTES + 1);
        let response = get_clipboard(
            State(state("token", Ok(oversized))),
            request(&[("authorization", "Bearer token")]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert_no_store(&response);
        assert_eq!(response_body(response).await, r#"{"error":"clipboard too large"}"#);

        let response = get_clipboard(
            State(state("token", Err(ClipboardError))),
            request(&[("authorization", "Bearer token")]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_no_store(&response);
        assert_eq!(response_body(response).await, r#"{"error":"clipboard unavailable"}"#);
    }
}

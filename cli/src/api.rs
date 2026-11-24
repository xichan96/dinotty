//! Blocking HTTP client for Dinotty's local API.

use std::time::Duration;

use serde_json::Value;

use crate::config::{is_loopback_url, local_token_file_candidates, read_token_file, Config};
use crate::error::CliError;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// A failed API call, optionally carrying the server's `error.code`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub status: Option<u16>,
    pub hint: Option<String>,
}

impl From<ApiError> for CliError {
    fn from(error: ApiError) -> Self {
        let cli = CliError::runtime(error.code, error.message);
        match error.hint {
            Some(hint) => cli.with_hint(hint),
            None => cli,
        }
    }
}

/// A connected Dinotty client. Authentication is resolved once, at connect
/// time, following the documented precedence.
pub struct HttpClient {
    base_url: String,
    token: Option<String>,
    client: reqwest::blocking::Client,
}

impl HttpClient {
    /// Build a client and resolve the auth token.
    ///
    /// # Errors
    /// Returns a runtime error if the HTTP client cannot be constructed.
    pub fn connect(config: &Config) -> Result<Self, CliError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .map_err(|error| {
                CliError::runtime("HTTP_CLIENT_ERROR", format!("cannot build HTTP client: {error}"))
            })?;
        let mut http =
            Self { base_url: config.base_url.clone(), token: config.token.clone(), client };

        if http.token.is_none() && is_loopback_url(&http.base_url) {
            http.token = http.fetch_auto_token();
        }
        if http.token.is_none() {
            http.token = read_token_file(&local_token_file_candidates());
        }
        Ok(http)
    }

    /// `GET /api/auto-token`. Failures are expected (the endpoint is disabled
    /// in server builds and on non-loopback hosts) and simply mean "no token
    /// from this source".
    fn fetch_auto_token(&self) -> Option<String> {
        let response = self.client.get(self.url("/api/auto-token")).send().ok()?;
        if !response.status().is_success() {
            return None;
        }
        let value: Value = response.json().ok()?;
        value
            .get("token")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .map(str::to_string)
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url.trim_end_matches('/'), path.trim_start_matches('/'))
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, ApiError> {
        let mut request = self.client.request(method, self.url(path));
        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().map_err(|error| ApiError {
            code: "REQUEST_FAILED".into(),
            message: error.to_string(),
            status: None,
            hint: Some(format!(
                "could not reach {} - is Dinotty running? Set DINOTTY_URL or --url to point at it",
                self.base_url
            )),
        })?;
        let status = response.status();
        let text = response.text().map_err(|error| ApiError {
            code: "INVALID_RESPONSE".into(),
            message: format!("cannot read response body: {error}"),
            status: Some(status.as_u16()),
            hint: None,
        })?;
        if !status.is_success() {
            return Err(parse_api_error(status.as_u16(), &text));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(|error| ApiError {
            code: "INVALID_RESPONSE".into(),
            message: format!("response is not valid JSON: {error}"),
            status: Some(status.as_u16()),
            hint: None,
        })
    }

    /// # Errors
    /// Returns the mapped API error or connection failure.
    pub fn get(&self, path: &str) -> Result<Value, CliError> {
        self.request(reqwest::Method::GET, path, None).map_err(Into::into)
    }

    /// # Errors
    /// Returns the mapped API error or connection failure.
    pub fn post(&self, path: &str, body: &Value) -> Result<Value, CliError> {
        self.request(reqwest::Method::POST, path, Some(body)).map_err(Into::into)
    }

    /// # Errors
    /// Returns the mapped API error or connection failure.
    pub fn put(&self, path: &str, body: &Value) -> Result<Value, CliError> {
        self.request(reqwest::Method::PUT, path, Some(body)).map_err(Into::into)
    }

    /// # Errors
    /// Returns the mapped API error or connection failure.
    pub fn delete(&self, path: &str) -> Result<Value, CliError> {
        self.request(reqwest::Method::DELETE, path, None).map_err(Into::into)
    }

    /// Stream a raw (non-JSON) response into `out`.
    ///
    /// `/api/workspace/raw` serves file bytes with a content type, so it does
    /// not fit [`Self::get`]. The size guard matches the server's download cap.
    ///
    /// # Errors
    /// Returns the mapped API error, a connection failure, or an I/O error
    /// while writing the response.
    pub fn download(
        &self,
        path: &str,
        out: &mut dyn std::io::Write,
    ) -> Result<RawResponse, CliError> {
        let mut request = self.client.get(self.url(path));
        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }
        let mut response = request.send().map_err(|error| {
            CliError::runtime("REQUEST_FAILED", error.to_string()).with_hint(format!(
                "could not reach {} - is Dinotty running? Set DINOTTY_URL or --url to point at it",
                self.base_url
            ))
        })?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            let error = parse_api_error(status.as_u16(), &body);
            return Err(error.into());
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        if let Some(length) = response.content_length() {
            if length > MAX_DOWNLOAD_BYTES {
                return Err(CliError::runtime(
                    "FILE_TOO_LARGE",
                    format!("response is {length} bytes; the limit is {MAX_DOWNLOAD_BYTES}"),
                ));
            }
        }
        let bytes = std::io::copy(&mut response, out).map_err(|error| {
            CliError::runtime("IO_ERROR", format!("cannot write the response: {error}"))
        })?;
        if bytes > MAX_DOWNLOAD_BYTES {
            return Err(CliError::runtime(
                "FILE_TOO_LARGE",
                format!("response exceeded the {MAX_DOWNLOAD_BYTES}-byte limit"),
            ));
        }
        Ok(RawResponse { content_type, bytes })
    }
}

/// Metadata for a streamed raw response.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawResponse {
    pub content_type: Option<String>,
    pub bytes: u64,
}

/// Matches the server's `MAX_DOWNLOAD` (500 MiB) plus a small margin.
const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;

/// Parse the server's `{"error": {"code", "message"}}` envelope, with fallbacks
/// for the older `{"error": "text"}` shape and non-JSON bodies.
#[must_use]
pub fn parse_api_error(status: u16, body: &str) -> ApiError {
    let value: Option<Value> = serde_json::from_str(body).ok();
    let (mut code, message) = match value.as_ref().and_then(|value| value.get("error")) {
        Some(Value::Object(error)) => (
            error.get("code").and_then(Value::as_str).map(str::to_string),
            error.get("message").and_then(Value::as_str).map(str::to_string),
        ),
        Some(Value::String(error)) => (None, Some(error.clone())),
        _ => (None, None),
    };

    let body_message = body.trim();
    let message = message
        .or_else(|| (!body_message.is_empty()).then(|| truncate(body_message, 300)))
        .unwrap_or_else(|| format!("HTTP {status}"));
    if code.as_deref().is_none_or(str::is_empty) {
        code = Some(infer_code(status, &message));
    }
    let code = code.unwrap_or_else(|| "HTTP_ERROR".into());
    let hint = hint_for(&code, status);
    ApiError { code, message, status: Some(status), hint }
}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        text.to_string()
    } else {
        let mut truncated: String = text.chars().take(limit).collect();
        truncated.push('…');
        truncated
    }
}

fn infer_code(status: u16, message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("open_api is disabled") || lower.contains("open api is disabled") {
        return "OPEN_API_DISABLED".into();
    }
    // `/api/workspace/cwd`, `/screen`, and `/input` answer unknown sessions with
    // a plain 404 "unknown pane"/"pane not found" rather than a code.
    if status == 404 && lower.contains("pane") {
        return "UNKNOWN_PANE".into();
    }
    // The workspace/tabs handlers answer with plain strings, so map the common
    // ones to stable codes for skills.
    let plain = match lower.as_str() {
        "invalid path" => Some("INVALID_PATH"),
        "outside workspace" => Some("OUTSIDE_WORKSPACE"),
        "not a file" => Some("NOT_A_FILE"),
        "not a directory" => Some("NOT_A_DIRECTORY"),
        "file too large" | "content too large" => Some("FILE_TOO_LARGE"),
        "cwd_unavailable_for_backend" => Some("CWD_UNAVAILABLE"),
        "git_unavailable_for_backend" => Some("GIT_UNAVAILABLE"),
        "sensitive system directory" => Some("SCOPE_DENIED"),
        "tab not found" => Some("TAB_NOT_FOUND"),
        "not found" => Some("NOT_FOUND"),
        "already exists" => Some("ALREADY_EXISTS"),
        _ => None,
    };
    if let Some(code) = plain {
        return code.into();
    }
    match status {
        401 => "UNAUTHORIZED".into(),
        403 => "FORBIDDEN".into(),
        404 => "NOT_FOUND".into(),
        409 => "CONFLICT".into(),
        _ => format!("HTTP_{status}"),
    }
}

/// Human hints for the documented viewer error codes plus common HTTP errors.
fn hint_for(code: &str, status: u16) -> Option<String> {
    let hint = match code {
        "NO_UI_CLIENT" => {
            "no Dinotty main window is connected - open the desktop app or a browser tab"
        }
        "UNKNOWN_PANE" => {
            "that pane id is not a live session - run `dinotty sessions list` to find one"
        }
        "CWD_UNAVAILABLE" | "SSH_UNSUPPORTED" => {
            "the pane has no local workspace (SSH/remote sessions are not supported)"
        }
        "OUTSIDE_WORKSPACE" => {
            "the path is outside the pane's workspace (viewer staging goes through .claude/artifacts)"
        }
        "INVALID_PATH" => "workspace paths are relative and must not contain `..`",
        "TAB_NOT_FOUND" => "run `dinotty tabs list` to see open tabs",
        "NOT_FOUND" => {
            "the requested tab, pane, or workspace path was not found - run `dinotty tabs list` or `dinotty workspace list` to check"
        }
        "PATH_NOT_FOUND" => "the file does not exist or is not readable",
        "NOT_A_FILE" => "the target is not a regular file",
        "NOT_A_DIRECTORY" => "the target is not a directory",
        "GIT_UNAVAILABLE" => {
            "git data is unavailable for this pane (SSH/remote backends do not expose it)"
        }
        "ALREADY_EXISTS" => "the target already exists; choose a different name",
        "FILE_TOO_LARGE" => "the file exceeds the viewer's size limit",
        "SCOPE_DENIED" => "the token lacks workspace:read or its path scope excludes the file",
        "OPEN_API_DISABLED" => {
            "enable Settings -> Open API in Dinotty, or use `dinotty viewer open` which does not need it"
        }
        "UNAUTHORIZED" | "FORBIDDEN" => {
            "check the token (--token / DINOTTY_TOKEN) or remove it to use /api/auto-token"
        }
        _ => {
            if status == 401 {
                "check the token (--token / DINOTTY_TOKEN)"
            } else {
                return None;
            }
        }
    };
    Some(hint.to_string())
}

/// Percent-encode one URL path/query component. Pane ids are normally UUIDs,
/// but this keeps arbitrary ids safe.
#[must_use]
pub fn encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_structured_error_envelope() {
        let error = parse_api_error(
            409,
            r#"{"error":{"code":"NO_UI_CLIENT","message":"no connected main UI client"}}"#,
        );
        assert_eq!(error.code, "NO_UI_CLIENT");
        assert_eq!(error.message, "no connected main UI client");
        assert!(error.hint.unwrap().contains("main window"));
    }

    #[test]
    fn falls_back_to_plain_error_strings_and_http_codes() {
        assert_eq!(parse_api_error(401, r#"{"error":"bad token"}"#).code, "UNAUTHORIZED");
        let error = parse_api_error(403, r#"{"error":"open_api is disabled"}"#);
        assert_eq!(error.code, "OPEN_API_DISABLED");
        assert_eq!(parse_api_error(500, "boom").code, "HTTP_500");
        assert_eq!(parse_api_error(404, "").code, "NOT_FOUND");
        assert_eq!(parse_api_error(404, "unknown pane").code, "UNKNOWN_PANE");
        assert_eq!(parse_api_error(404, "pane not found").code, "UNKNOWN_PANE");
    }

    #[test]
    fn maps_plain_workspace_and_tab_messages() {
        assert_eq!(parse_api_error(400, "invalid path").code, "INVALID_PATH");
        assert_eq!(parse_api_error(403, "outside workspace").code, "OUTSIDE_WORKSPACE");
        assert_eq!(parse_api_error(400, "not a file").code, "NOT_A_FILE");
        assert_eq!(parse_api_error(400, "not a directory").code, "NOT_A_DIRECTORY");
        assert_eq!(parse_api_error(400, "file too large").code, "FILE_TOO_LARGE");
        assert_eq!(parse_api_error(409, "cwd_unavailable_for_backend").code, "CWD_UNAVAILABLE");
        assert_eq!(parse_api_error(409, "git_unavailable_for_backend").code, "GIT_UNAVAILABLE");
        assert_eq!(parse_api_error(404, "tab not found").code, "TAB_NOT_FOUND");
        assert_eq!(parse_api_error(404, "not found").code, "NOT_FOUND");
        assert_eq!(parse_api_error(409, "already exists").code, "ALREADY_EXISTS");
        assert!(parse_api_error(400, "invalid path").hint.unwrap().contains("`..`"));
    }

    #[test]
    fn truncates_long_bodies() {
        let body = "x".repeat(400);
        let error = parse_api_error(400, &body);
        assert!(error.message.chars().count() <= 301);
        assert!(error.message.ends_with('…'));
    }

    #[test]
    fn encodes_path_components() {
        assert_eq!(encode_component("pane-1_a.b~c"), "pane-1_a.b~c");
        assert_eq!(encode_component("a b/c"), "a%20b%2Fc");
    }
}

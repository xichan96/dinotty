#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]

use std::net::{IpAddr, SocketAddr};

use axum::{
    extract::{ConnectInfo, Json, Path, State},
    http::{header, HeaderValue, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;

use crate::app_state::AppState;
use crate::auth;
use crate::auth::verification_code::VerifyOutcome;
use crate::event_bus::BusEvent;
use crate::settings;

#[derive(Deserialize)]
pub(crate) struct UpdateTokenRequest {
    token: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub(crate) enum LoginBody {
    Token { token: String },
    Code { request_id: String, code: String },
}

fn build_session_cookie(session_id: &str, ttl_days: u64, port: u16) -> String {
    let max_age = ttl_days * 86_400;
    format!(
        "{name}={value}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}",
        name = auth::session_cookie_name(port),
        value = session_id,
    )
}

fn clear_session_cookie(port: u16) -> String {
    format!(
        "{name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        name = auth::session_cookie_name(port)
    )
}

/// Login endpoint. Dispatches to either token login or verification-code login
/// based on the `login_method` setting. The two modes are mutually exclusive:
/// `login_method=token` rejects `{request_id, code}` bodies; `verification_code`
/// rejects `{token}`. Brute-force lockout is enforced here (the middleware
/// exempts /api/auth).
pub(crate) async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<LoginBody>,
) -> impl IntoResponse {
    let stored = state.auth_token.read().await.clone();
    if stored.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(serde_json::json!({"error": "no token configured"})),
        )
            .into_response();
    }

    let (
        real_ip,
        lockout_strategy,
        max_failures,
        lockout_secs,
        global_max_failures,
        global_lockout_secs,
        login_method,
    ) = {
        let s = state.settings.read().await;
        (
            auth::real_client_ip(&headers, addr.ip(), &s.auth.trusted_proxies),
            s.auth.lockout_strategy.clone(),
            s.auth.lockout_max_failures,
            s.auth.lockout_secs,
            s.auth.global_lockout_max_failures,
            s.auth.global_lockout_secs,
            s.auth.login_method.clone(),
        )
    };

    // Brute-force lockout check before credential validation. The login
    // endpoint is exempt from the middleware's check (so unauthenticated
    // users can reach it), so we must enforce it here.
    if let Some(retry_after) = auth::check_lockout(
        real_ip,
        &lockout_strategy,
        max_failures,
        lockout_secs,
        global_max_failures,
        global_lockout_secs,
    ) {
        let attempt_count = auth::get_fail_count(real_ip);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        state.manager.event_bus.publish(BusEvent::AuthLoginFailed {
            ip: real_ip.to_string(),
            reason: "locked_out".into(),
            attempt_count,
            locked_until: Some(now.saturating_add(retry_after)),
        });
        let () = state.audit.record(
            "anonymous",
            "login_failed",
            "auth",
            serde_json::json!({
                "ip": real_ip.to_string(),
                "reason": "locked_out",
                "attempt_count": attempt_count,
            }),
        );
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [
                (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
                (header::RETRY_AFTER, HeaderValue::from_str(&retry_after.to_string()).unwrap()),
            ],
            Json(serde_json::json!({"error": "too many failed attempts, please try again later"})),
        )
            .into_response();
    }

    // Reject empty payloads early so we return 400 (bad request) rather than
    // 401 (login method mismatch) for malformed submissions.
    match &body {
        LoginBody::Token { token } if token.trim().is_empty() => {
            return (
                StatusCode::BAD_REQUEST,
                [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
                Json(serde_json::json!({"error": "token cannot be empty"})),
            )
                .into_response();
        }
        LoginBody::Code { request_id, code }
            if request_id.trim().is_empty() || code.trim().is_empty() =>
        {
            return (
                StatusCode::BAD_REQUEST,
                [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
                Json(serde_json::json!({"error": "request_id and code are required"})),
            )
                .into_response();
        }
        _ => {}
    }

    match (login_method.as_str(), body) {
        ("token", LoginBody::Token { token }) => {
            handle_token_login(&state, real_ip, &headers, &token, &stored, global_lockout_secs)
                .await
        }
        ("verification_code", LoginBody::Code { request_id, code }) => {
            handle_code_login(&state, real_ip, &headers, request_id, code).await
        }
        (_, _) => {
            // Cross-case: login_method does not match the body shape. Account as
            // a brute-force attempt to discourage probing.
            let attempt_count = auth::record_auth_failure(real_ip, global_lockout_secs);
            state.manager.event_bus.publish(BusEvent::AuthLoginFailed {
                ip: real_ip.to_string(),
                reason: "wrong_login_method".into(),
                attempt_count,
                locked_until: None,
            });
            let () = state.audit.record(
                "anonymous",
                "login_failed",
                "auth",
                serde_json::json!({
                    "ip": real_ip.to_string(),
                    "reason": "wrong_login_method",
                    "attempt_count": attempt_count,
                }),
            );
            (
                StatusCode::UNAUTHORIZED,
                [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
                Json(serde_json::json!({"error": "login method mismatch"})),
            )
                .into_response()
        }
    }
}

/// Build the success response (session cookie + audit + 200 body) shared by
/// token and code login paths.
async fn create_session_response(
    state: &AppState,
    real_ip: IpAddr,
    headers: &axum::http::HeaderMap,
) -> axum::response::Response {
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(std::string::ToString::to_string);
    let session_id = state.sessions.create(Some(real_ip), ua);
    let ttl_days = {
        let s = state.settings.read().await;
        s.auth.session_ttl_days
    };
    let cookie = build_session_cookie(&session_id, ttl_days, state.port);
    let () = state.audit.record(
        &session_id,
        "login",
        "session",
        serde_json::json!({ "ip": real_ip.to_string() }),
    );
    (
        StatusCode::OK,
        [
            (header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap()),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
        ],
        Json(serde_json::json!({"ok": true})),
    )
        .into_response()
}

/// Token login: constant-time compare the posted token against the stored
/// master token. Records a brute-force attempt on mismatch.
async fn handle_token_login(
    state: &AppState,
    real_ip: IpAddr,
    headers: &axum::http::HeaderMap,
    token: &str,
    stored: &str,
    global_lockout_secs: u64,
) -> axum::response::Response {
    if !auth::constant_time_eq(token.trim(), stored) {
        let attempt_count = auth::record_auth_failure(real_ip, global_lockout_secs);
        state.manager.event_bus.publish(BusEvent::AuthLoginFailed {
            ip: real_ip.to_string(),
            reason: "token_mismatch".into(),
            attempt_count,
            locked_until: None,
        });
        let () = state.audit.record(
            "anonymous",
            "login_failed",
            "auth",
            serde_json::json!({
                "ip": real_ip.to_string(),
                "reason": "token_mismatch",
                "attempt_count": attempt_count,
            }),
        );
        return (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(serde_json::json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    create_session_response(state, real_ip, headers).await
}

/// Verification-code login: delegate to `CodeStore::verify`. Per-request
/// attempt counting is handled inside `CodeEntry`; we do NOT call
/// `record_auth_failure` here, since the rate limit / attempt cap on the code
/// itself is the relevant gate (code is bound to `request_id`, not IP).
async fn handle_code_login(
    state: &AppState,
    real_ip: IpAddr,
    headers: &axum::http::HeaderMap,
    request_id: String,
    code: String,
) -> axum::response::Response {
    let outcome = state.code_store.verify(&request_id, &code);
    match outcome {
        VerifyOutcome::Ok => {
            let ua = headers
                .get(header::USER_AGENT)
                .and_then(|v| v.to_str().ok())
                .map(std::string::ToString::to_string);
            let occurred_at: u64 = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .try_into()
                .unwrap_or_default();
            state.manager.event_bus.publish(BusEvent::VerificationCodeConsumed {
                request_id: request_id.clone(),
                ip: real_ip.to_string(),
                user_agent: ua,
                occurred_at,
            });
            let () = state.audit.record(
                "anonymous",
                "login",
                "verification_code",
                serde_json::json!({
                    "request_id": request_id,
                    "ip": real_ip.to_string(),
                }),
            );
            create_session_response(state, real_ip, headers).await
        }
        VerifyOutcome::NotFound => (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(serde_json::json!({"error": "code not found"})),
        )
            .into_response(),
        VerifyOutcome::Expired => (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(serde_json::json!({"error": "code expired"})),
        )
            .into_response(),
        VerifyOutcome::Consumed => (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(serde_json::json!({"error": "code already used"})),
        )
            .into_response(),
        VerifyOutcome::TooManyAttempts => (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(serde_json::json!({"error": "too many attempts"})),
        )
            .into_response(),
        VerifyOutcome::Mismatch => (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(serde_json::json!({"error": "code mismatch"})),
        )
            .into_response(),
    }
}

/// Request a verification code. Public endpoint (exempt from auth middleware
/// alongside /api/auth). Generates a 6-digit code, emits `auth.verification_code`
/// event so subscribers (e.g. feishu-notify) can push it to the user, and
/// returns only the `request_id` (never the code itself).
pub(crate) async fn request_code(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let real_ip = {
        let s = state.settings.read().await;
        auth::real_client_ip(&headers, addr.ip(), &s.auth.trusted_proxies)
    };

    let Ok((request_id, code)) = state.code_store.create(real_ip) else {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(serde_json::json!({"error": "rate limited, try again later"})),
        )
            .into_response();
    };

    let occurred_at: u64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or_default();

    state.manager.event_bus.publish(BusEvent::VerificationCode {
        request_id: request_id.clone(),
        code,
        occurred_at,
    });

    let () = state.audit.record(
        "anonymous",
        "request_verification_code",
        "auth",
        serde_json::json!({ "ip": real_ip.to_string() }),
    );

    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(serde_json::json!({"request_id": request_id})),
    )
        .into_response()
}

pub(crate) async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    // Best-effort: extract session id from Cookie header and revoke it.
    if let Some(cookie_hdr) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
        for pair in cookie_hdr.split(';') {
            let pair = pair.trim();
            let cookie_prefix = format!("{}=", auth::session_cookie_name(state.port));
            if let Some(rest) = pair.strip_prefix(&cookie_prefix) {
                let sid = rest.to_string();
                let () = state.audit.record(&sid, "logout", "session", serde_json::json!({}));
                let _ = state.sessions.revoke(&sid);
                break;
            }
        }
    }
    (
        StatusCode::OK,
        [
            (header::SET_COOKIE, HeaderValue::from_str(&clear_session_cookie(state.port)).unwrap()),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
        ],
        Json(serde_json::json!({"ok": true})),
    )
}

pub(crate) async fn put_settings_with_session_ttl(
    State(state): State<AppState>,
    body: axum::extract::Json<settings::Settings>,
) -> impl IntoResponse {
    let new_ttl = body.auth.session_ttl_days;
    let status =
        settings::put_settings(State((state.manager.clone(), state.settings.clone())), body).await;
    state.sessions.update_ttl_days(new_ttl);
    status
}

pub(crate) async fn list_sessions(State(state): State<AppState>) -> impl IntoResponse {
    let sessions = state.sessions.list();
    Json(serde_json::json!({ "sessions": sessions }))
}

#[derive(Deserialize)]
pub(crate) struct RevokeSessionPath {
    id: String,
}

pub(crate) async fn revoke_session(
    State(state): State<AppState>,
    Path(path): Path<RevokeSessionPath>,
) -> impl IntoResponse {
    let ok = state.sessions.revoke(&path.id);
    let () = state.audit.record(&path.id, "revoke", "session", serde_json::json!({ "by": "user" }));
    Json(serde_json::json!({ "ok": ok }))
}

pub(crate) async fn revoke_other_sessions(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    // Preserve the caller's session by extracting it from the cookie.
    let current = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()).and_then(|raw| {
        for pair in raw.split(';') {
            let pair = pair.trim();
            let cookie_prefix = format!("{}=", auth::session_cookie_name(state.port));
            if let Some(rest) = pair.strip_prefix(&cookie_prefix) {
                return Some(rest.to_string());
            }
        }
        None
    });
    match current {
        Some(ref sid) => state.sessions.revoke_all_except(sid),
        None => state.sessions.revoke_all(),
    }
    Json(serde_json::json!({ "ok": true }))
}

pub(crate) async fn check_auth(State(_state): State<AppState>) -> impl IntoResponse {
    // Legacy endpoint kept for backward compat - returns 200 if middleware passed.
    StatusCode::OK
}

pub(crate) async fn get_token(State(state): State<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    Json(serde_json::json!({ "token": *token }))
}

pub(crate) async fn token_configured(State(state): State<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    let login_method = {
        let s = state.settings.read().await;
        s.auth.login_method.clone()
    };
    Json(serde_json::json!({
        "configured": !token.is_empty(),
        "server_mode": cfg!(feature = "server"),
        "login_method": login_method,
    }))
}

pub(crate) async fn auto_token(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    if cfg!(feature = "server") {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "not available"})))
            .into_response();
    }
    if !addr.ip().is_loopback() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "auto-token is only available from localhost"})),
        )
            .into_response();
    }
    let token = state.auth_token.read().await;
    if token.is_empty() {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no token"})))
            .into_response();
    }
    Json(serde_json::json!({ "token": *token })).into_response()
}

pub(crate) async fn update_token(
    State(state): State<AppState>,
    Json(body): Json<UpdateTokenRequest>,
) -> impl IntoResponse {
    let new_token = body.token.trim().to_string();
    if new_token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "token cannot be empty"})),
        )
            .into_response();
    }
    // Update in-memory token
    *state.auth_token.write().await = new_token.clone();
    // Persist to dedicated token file
    if let Err(e) = settings::save_token(&new_token) {
        tracing::error!("Failed to persist token: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "failed to save"})),
        )
            .into_response();
    }
    // Revoke all existing sessions: they were authenticated against the old
    // token; if it was compromised, all sessions must be invalidated.
    state.sessions.revoke_all();
    StatusCode::OK.into_response()
}

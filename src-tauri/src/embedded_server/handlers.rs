use axum::Json;
use axum::{
    extract::{ConnectInfo, Path, State as AxumState},
    http::{header, HeaderValue, StatusCode},
    response::IntoResponse,
};
use std::net::{IpAddr, SocketAddr};

use dinotty_server::auth;
use dinotty_server::auth::verification_code::VerifyOutcome;
use dinotty_server::event_bus::BusEvent;
use dinotty_server::settings;

use super::state::AppState;

#[derive(serde::Deserialize)]
#[serde(untagged)]
pub enum LoginBody {
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

pub async fn check_auth(
    AxumState(state): AxumState<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<LoginBody>,
) -> axum::response::Response {
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

    if let Some(retry_after) = auth::check_lockout(
        real_ip,
        &lockout_strategy,
        max_failures,
        lockout_secs,
        global_max_failures,
        global_lockout_secs,
    ) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, HeaderValue::from_str(&retry_after.to_string()).unwrap())],
            Json(serde_json::json!({"error": "too many failed attempts, please try again later"})),
        )
            .into_response();
    }

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
            let attempt_count = auth::record_auth_failure(real_ip, global_lockout_secs);
            state.manager.event_bus.publish(BusEvent::AuthLoginFailed {
                ip: real_ip.to_string(),
                reason: "wrong_login_method".into(),
                attempt_count,
                locked_until: None,
            });
            (
                StatusCode::UNAUTHORIZED,
                [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
                Json(serde_json::json!({"error": "login method mismatch"})),
            )
                .into_response()
        }
    }
}

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
        return (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(serde_json::json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    create_session_response(state, real_ip, headers).await
}

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
            let occurred_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            state.manager.event_bus.publish(BusEvent::VerificationCodeConsumed {
                request_id: request_id.clone(),
                ip: real_ip.to_string(),
                user_agent: ua,
                occurred_at,
            });
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

pub async fn request_code(
    AxumState(state): AxumState<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let real_ip = {
        let s = state.settings.read().await;
        auth::real_client_ip(&headers, addr.ip(), &s.auth.trusted_proxies)
    };

    let (request_id, code) = match state.code_store.create(real_ip) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
                Json(serde_json::json!({"error": "rate limited, try again later"})),
            )
                .into_response();
        }
    };

    let occurred_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    state.manager.event_bus.publish(BusEvent::VerificationCode {
        request_id: request_id.clone(),
        code,
        occurred_at,
    });

    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(serde_json::json!({"request_id": request_id})),
    )
        .into_response()
}

pub async fn check_auth_session(AxumState(_state): AxumState<AppState>) -> StatusCode {
    // If we reach here, the auth middleware already validated the session.
    StatusCode::OK
}

pub async fn logout(
    AxumState(state): AxumState<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let cookie_name = auth::session_cookie_name(state.port);
    if let Some(cookie_header) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
        for pair in cookie_header.split(';') {
            let pair = pair.trim();
            if let Some(sid) = pair.strip_prefix(&format!("{cookie_name}=")) {
                let _ = state.sessions.revoke(sid);
                break;
            }
        }
    }
    let clear_cookie = format!("{cookie_name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    (
        [(header::SET_COOKIE, axum::http::HeaderValue::from_str(&clear_cookie).unwrap())],
        StatusCode::OK,
    )
}

pub async fn list_sessions_handler(
    AxumState(state): AxumState<AppState>,
) -> Json<serde_json::Value> {
    let sessions = state.sessions.list();
    Json(serde_json::json!({ "sessions": sessions }))
}

pub async fn revoke_session_handler(
    AxumState(state): AxumState<AppState>,
    Path(id): Path<String>,
) -> StatusCode {
    let _ = state.sessions.revoke(&id);
    StatusCode::NO_CONTENT
}

pub async fn revoke_other_sessions(AxumState(state): AxumState<AppState>) -> StatusCode {
    // Desktop mode: single user, revoke all sessions.
    state.sessions.revoke_all();
    StatusCode::NO_CONTENT
}

pub async fn get_token(AxumState(state): AxumState<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    Json(serde_json::json!({ "token": *token }))
}

pub async fn token_configured(AxumState(state): AxumState<AppState>) -> impl IntoResponse {
    let token = state.auth_token.read().await;
    let login_method = {
        let s = state.settings.read().await;
        s.auth.login_method.clone()
    };
    Json(serde_json::json!({
        "configured": !token.is_empty(),
        "server_mode": false,
        "login_method": login_method,
    }))
}

pub async fn auto_token(
    AxumState(state): AxumState<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
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

#[derive(serde::Deserialize)]
pub struct UpdateTokenRequest {
    token: String,
}

pub async fn update_token(
    AxumState(state): AxumState<AppState>,
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
    *state.auth_token.write().await = new_token.clone();
    if let Err(e) = settings::save_token(&new_token) {
        tracing::error!("Failed to persist token: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "failed to save"})),
        )
            .into_response();
    }
    StatusCode::OK.into_response()
}

#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Dedicated endpoints for the remote-server roster.
//!
//! The list is *also* reachable through `GET/PUT /api/settings`, but these
//! exist so the roster can be read and written without round-tripping the
//! whole settings object. `GET` recomputes `has_token` and never returns the
//! token itself; `PUT` is an atomic full replace with per-`id` token
//! inheritance (see [`crate::settings::merge_remote_server_tokens`]).
//!
//! `probe` runs hub-side, not from the browser: the hub has no `Origin` header
//! to trip the cross-site check and the browser would fail CORS against a
//! server that has not allowlisted this page, so a server-side probe is the
//! only form that behaves the same in Tauri and in a browser tab.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use tracing::error;

use super::handlers::inherit_remote_server_tokens;
use super::io::save_settings;
use super::types::CURRENT_SETTINGS_VERSION;
use crate::settings::{types::RemoteServer, SettingsState};

/// Budget for a single probe request.
///
/// The probe backs a "Test connection" button, so it has to fail visibly
/// rather than hang the dialog. Both probe steps get their own budget, so the
/// worst case for a black-holing target is twice this.
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);

/// Request body for [`probe_remote_server`].
///
/// The probe runs hub-side rather than from the browser, so the target carries
/// no CORS or origin problem in any client mode.
///
/// There are two shapes, and `id` selects between them:
///
/// - **`id` present** - probe an existing roster entry. `url` and `token` are
///   *ignored entirely* and both come from the stored roster, because this is
///   the only form that can work for an entry that has a token: `GET
///   /api/remote-servers` scrubs the token out of its response (by design, so
///   the secret never reaches JavaScript), so a client probing by URL cannot
///   send a credential it was never given. Without this shape every
///   token-protected server would probe as a 401 and the switch to it would
///   abort.
/// - **`id` absent** - probe an arbitrary `url` with an optional candidate
///   `token`. This is the "Test connection" button on the add/edit form, where
///   the credential is still in the user's hands and no roster entry exists yet.
///
/// Ignoring the supplied `url`/`token` when `id` is present is a security
/// property, not a convenience: it means a caller cannot use a roster id to
/// reach a *different* host, and cannot substitute its own credential for the
/// stored one. The relay's `authorized_target` takes the same line - see the
/// module docs on `crate::proxy::relay`.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProbeRemoteServerRequest {
    /// Roster id to probe. Takes precedence over `url`/`token` when set.
    #[serde(default)]
    pub id: Option<String>,
    /// Target for the id-less form.
    ///
    /// Falls back to the empty string rather than being a required field, so
    /// the by-id form can send `{"id": "…"}` alone - a caller probing a roster
    /// entry has no reason to name a URL and no way to know the stored one. An
    /// id-less request that omits it is still rejected, by
    /// [`normalize_origin`]'s "url is empty" rather than by a deserializer
    /// message that names a field the caller never meant to use.
    #[serde(default)]
    pub url: String,
    /// Candidate credential for the id-less form.
    ///
    /// `skip_serializing` keeps a candidate token out of anything that echoes a
    /// request back. It is safe here, unlike on [`RemoteServer::token`], because
    /// this type is never persisted - a request body has no disk round trip to
    /// lose. See that field's docs for the trap `skip_serializing` sets.
    #[serde(default, skip_serializing)]
    pub token: Option<String>,
}

/// Result of [`probe_remote_server`].
///
/// `token_configured` must drive a UI warning, not just a status dot: an
/// upstream with an empty token lets *anyone* who can reach it in as admin
/// (`auth_middleware` returns early when the token is empty), so "reachable"
/// must never be presented as "set up correctly".
///
/// # Three ways to end up with no usable version
///
/// `settings_version` staying `None` is not by itself an error. It is `None`
/// when the upstream answered but we learned nothing from `/api/info`, which
/// happens for three different reasons that the caller has to tell apart:
///
/// 1. no credential was supplied, so the authenticated step was skipped;
/// 2. a credential was supplied and the upstream *rejected* it - see
///    `token_valid`;
/// 3. the credential was accepted and the upstream simply does not carry the
///    field, i.e. it predates `settings_version` in `/api/info`.
///
/// `token_valid` and `token_configured` together separate the three. This is
/// why an upstream whose `/api/info` lacks the field is *not* reported as an
/// error: "you are talking to an older dinotty" is a successful probe that
/// wants a compatibility hint, not a failure.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProbeRemoteServerResponse {
    pub reachable: bool,
    pub token_configured: bool,
    /// "server" or "embedded" - which binary answered.
    pub server_mode: Option<String>,
    /// Upstream's `settings_version`, for the version-compat warning. `None`
    /// means "not learned" - see the type docs, not "incompatible".
    pub settings_version: Option<u32>,
    /// Upstream's own version string, e.g. `0.24.3`.
    ///
    /// This is what the picker shows so a user can see *why* a freshly switched
    /// server is missing something, and it is deliberately the human-facing
    /// string rather than a number to compare: the repo bumps the version per
    /// release, not per feature, so two builds that differ in what they
    /// understand routinely report the same one. Feature support is
    /// `capabilities` in the same payload, and is not inferable from this.
    ///
    /// `None` means "not learned" - absent on a build older than the field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Whether the credential the probe used was accepted.
    ///
    /// - `None` - no credential was supplied, so authentication was never
    ///   tested. The upstream may or may not require one.
    /// - `Some(true)` - `/api/info` accepted it.
    /// - `Some(false)` - the upstream answered the authenticated step with 401,
    ///   so the stored token is wrong (or was rotated upstream).
    ///
    /// Without this, a wrong token and a merely old upstream both look like
    /// `reachable: true, settings_version: None`, and the user is told to worry
    /// about versions when the real fix is to re-paste a token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_valid: Option<bool>,
    /// Human-readable failure reason, set only when `reachable` is false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Normalize a roster URL to a bare `http(s)` origin.
///
/// Returns the origin on success. The relay builds every upstream request from
/// the roster's `url`, so anything that could aim it somewhere other than the
/// server the user named is rejected rather than silently trimmed: embedded
/// credentials (`user:pass@`), a path that would swallow the relayed one, a
/// query/fragment, and every non-HTTP scheme (notably `ws://`, which is not a
/// page origin at all).
///
/// A trailing slash is *not* a path - `Url` yields `"/"` for every origin - so
/// `http://host:8999/` normalizes to `http://host:8999` instead of being
/// rejected.
///
/// # Errors
/// Returns a human-readable reason the string cannot serve as a roster origin.
pub(crate) fn normalize_origin(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("url is empty".into());
    }
    let parsed = reqwest::Url::parse(trimmed).map_err(|e| format!("invalid url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => {
            return Err(format!("unsupported scheme `{other}`, use http:// or https://"));
        }
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("url must not embed credentials".into());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("url must not carry a query string or fragment".into());
    }
    if !matches!(parsed.path(), "" | "/") {
        return Err("url must be an origin with no path".into());
    }
    let origin = parsed.origin().ascii_serialization();
    if origin == "null" {
        return Err("url must name a host".into());
    }
    Ok(origin)
}

/// `GET /api/remote-servers` - return the roster.
///
/// `scrub_secrets` both recomputes `has_token` from the stored token - the
/// persisted flag is only a cache and can lag behind a PUT that changed the
/// token - and drops the token itself, which otherwise serializes because
/// `settings.json` needs it. The flag is the only thing a client may learn.
pub async fn get_remote_servers(State(settings): State<SettingsState>) -> Response {
    let mut roster = settings.read().await.remote_servers.clone();
    for server in &mut roster {
        server.scrub_secrets();
    }
    Json(roster).into_response()
}

/// `PUT /api/remote-servers` - atomically replace the roster.
///
/// The submitted list is authoritative: an entry left out of it is gone, and
/// reordering is preserved. Only tokens are carried over, per `id`, by
/// [`inherit_remote_server_tokens`] - and only for entries that did not send a
/// `token` key at all, which is the normal case because `GET` scrubs the secret
/// out of its response and so never hands it back.
///
/// Everything else in `Settings` is preserved by cloning the stored object
/// rather than deserializing a fresh one, so this endpoint cannot clobber
/// server-owned fields such as `active_workspace_id`.
pub async fn put_remote_servers(
    State(settings): State<SettingsState>,
    Json(mut roster): Json<Vec<RemoteServer>>,
) -> Response {
    for server in &mut roster {
        match normalize_origin(&server.url) {
            Ok(origin) => server.url = origin,
            Err(reason) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": format!("remote server `{}`: {reason}", server.id) })),
                )
                    .into_response();
            }
        }
    }

    let mut new_settings = settings.read().await.clone();
    inherit_remote_server_tokens(&mut roster, &new_settings.remote_servers);
    new_settings.remote_servers = roster;
    new_settings.settings_version = CURRENT_SETTINGS_VERSION;

    match save_settings(&new_settings) {
        Ok(()) => {
            *settings.write().await = new_settings;
            StatusCode::OK.into_response()
        }
        Err(e) => {
            error!("save remote servers: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("could not save settings: {e}") })),
            )
                .into_response()
        }
    }
}

/// `POST /api/remote-servers/probe` - reachability and version check.
///
/// Two steps, because they answer different questions:
///
/// 1. `GET /api/token-configured` is public (see the early-return list in
///    `crate::auth::auth_middleware`), so it decides *reachability* and whether
///    the target demands a token - two states a single "connected" bit would
///    blur into one.
/// 2. `GET /api/info` is authenticated, so it is only attempted with a
///    candidate token and only ever refines the answer.
///
/// The target and the credential come from one of two places, decided by
/// [`ProbeRemoteServerRequest::id`]. When an `id` is given, both are read out of
/// the roster and the request's own `url`/`token` are ignored - the caller is a
/// frontend that was never shown the stored token, so there is nothing for it to
/// contribute, and accepting its `url` would let a roster id be aimed at a host
/// the roster does not name. See that type's docs.
pub async fn probe_remote_server(
    State(settings): State<SettingsState>,
    Json(req): Json<ProbeRemoteServerRequest>,
) -> Response {
    // `id` wins over the request's own url/token, both of which are then
    // deliberately never read.
    let (url, token) = match req.id.as_deref() {
        Some(id) => {
            let roster = settings.read().await;
            let Some(server) = roster.remote_servers.iter().find(|s| s.id == id) else {
                // Terse and roster-free on purpose: an unknown id and an id the
                // caller may not see are the same answer, so the roster cannot
                // be enumerated through this endpoint.
                return Json(unreachable(format!("no remote server with id `{id}`")))
                    .into_response();
            };
            // Clone the secret out rather than holding the read lock across the
            // two network round trips below.
            (server.url.clone(), server.token.as_ref().map(|t| t.expose().to_string()))
        }
        None => (req.url, req.token),
    };

    let origin = match normalize_origin(&url) {
        Ok(origin) => origin,
        Err(reason) => return Json(unreachable(reason)).into_response(),
    };

    let client = match reqwest::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            return Json(unreachable(format!("could not build probe client: {e}"))).into_response()
        }
    };

    let response = match client.get(format!("{origin}/api/token-configured")).send().await {
        Ok(response) => response,
        Err(e) => return Json(unreachable(classify_transport_error(&e, &origin))).into_response(),
    };
    if !response.status().is_success() {
        return Json(unreachable(format!(
            "{origin} answered HTTP {} for /api/token-configured, which is not a dinotty server",
            response.status().as_u16()
        )))
        .into_response();
    }
    // Something is listening and answering, but the roster drives the relay
    // with this origin, so an unrelated service on the same port must not be
    // reported as a usable server.
    let Ok(body) = response.json::<serde_json::Value>().await else {
        return Json(unreachable(format!(
            "{origin} did not return a dinotty /api/token-configured payload"
        )))
        .into_response();
    };
    let Some(configured) = body.get("configured").and_then(serde_json::Value::as_bool) else {
        return Json(unreachable(format!(
            "{origin} did not return a dinotty /api/token-configured payload"
        )))
        .into_response();
    };

    let mut probe = ProbeRemoteServerResponse {
        reachable: true,
        token_configured: configured,
        server_mode: Some(
            if body.get("server_mode").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                "server".to_string()
            } else {
                "embedded".to_string()
            },
        ),
        ..ProbeRemoteServerResponse::default()
    };

    // Without a candidate credential the authenticated step cannot succeed, so
    // it is skipped rather than burned on a guaranteed 401. `token_valid` stays
    // `None`: nothing was tested, so nothing is claimed.
    let Some(token) = token.filter(|t| !t.is_empty()) else {
        return Json(probe).into_response();
    };

    let Ok(response) = client.get(format!("{origin}/api/info")).bearer_auth(&token).send().await
    else {
        // Reachability was already established by step 1; a failed version
        // probe does not make the server unreachable, and it says nothing about
        // the credential either - so `token_valid` stays `None` rather than
        // claiming a rejection that was never observed.
        return Json(probe).into_response();
    };
    if response.status().is_success() {
        probe.token_valid = Some(true);
        if let Ok(body) = response.json::<serde_json::Value>().await {
            // Absent for an upstream older than this field; `None` then means
            // "that server cannot say", which the caller must not read as
            // "incompatible" - see the response type's docs.
            probe.settings_version = body
                .get("settings_version")
                .and_then(serde_json::Value::as_u64)
                .and_then(|v| u32::try_from(v).ok());
            probe.version =
                body.get("version").and_then(serde_json::Value::as_str).map(str::to_string);
            // The probe is the only thing that ever learns this, so it is also
            // the only place that can record it for the picker.
            if let (Some(id), Some(version)) = (req.id.as_deref(), probe.version.as_deref()) {
                remember_version(&settings, id, version).await;
            }
        }
    } else if response.status() == StatusCode::UNAUTHORIZED {
        // The upstream's `auth_middleware` answers a bad Bearer with exactly
        // this, so it is the one status that identifies a wrong token rather
        // than, say, a cross-site 403 from an IP-whitelist rule.
        probe.token_valid = Some(false);
    }
    Json(probe).into_response()
}

/// Record the upstream version a probe just learned.
///
/// `last_seen_version` is what the picker shows as "this server is older", and
/// the probe is the only thing that can ever learn it: the roster API is written
/// by the *client*, which has no way to know, and the relay never reads it. So
/// the write belongs here, on the one path that has the answer.
///
/// Unchanged versions are not rewritten: a server switch probes on every use,
/// and rewriting `settings.json` each time would turn a read-shaped operation
/// into a disk write.
async fn remember_version(settings: &SettingsState, id: &str, version: &str) {
    let mut current = settings.write().await;
    let Some(server) = current.remote_servers.iter_mut().find(|s| s.id == id) else {
        return;
    };
    if server.last_seen_version.as_deref() == Some(version) {
        return;
    }
    server.last_seen_version = Some(version.to_string());
    if let Err(e) = super::io::save_settings(&current) {
        tracing::warn!("could not persist last_seen_version for {id}: {e}");
    }
}

fn unreachable(reason: impl Into<String>) -> ProbeRemoteServerResponse {
    ProbeRemoteServerResponse { reachable: false, error: Some(reason.into()), ..Default::default() }
}

/// Turn a transport failure into something the user can act on.
///
/// "Timed out", "refused" and "cannot resolve" each point at a different fix
/// (firewall, wrong port, typo in the host), so they must not collapse into
/// one generic message.
fn classify_transport_error(e: &reqwest::Error, origin: &str) -> String {
    if e.is_timeout() {
        return format!("{origin} did not respond within {}s", PROBE_TIMEOUT.as_secs());
    }
    let mut chain = String::new();
    let mut source = Some(e as &(dyn std::error::Error + 'static));
    while let Some(current) = source {
        if let Some(io) = current.downcast_ref::<std::io::Error>() {
            match io.kind() {
                std::io::ErrorKind::ConnectionRefused => {
                    return format!("connection refused by {origin}");
                }
                std::io::ErrorKind::NotFound => return format!("DNS lookup failed for {origin}"),
                _ => {}
            }
        }
        chain.push_str(&current.to_string());
        chain.push(' ');
        source = current.source();
    }
    let chain = chain.to_lowercase();
    if chain.contains("dns") || chain.contains("lookup") || chain.contains("resolve") {
        return format!("DNS lookup failed for {origin}");
    }
    if chain.contains("refused") {
        return format!("connection refused by {origin}");
    }
    format!("could not reach {origin}: {e}")
}

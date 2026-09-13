//! Endpoint-level tests for the remote-server roster.
//!
//! The probe tests run a real upstream on `127.0.0.1:0`, so the OS picks a
//! free port and nothing can collide with a running dinotty instance.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde_json::json;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

use crate::session::SessionManager;
use crate::settings::io::save_settings;
use crate::settings::{
    get_remote_servers, get_settings, probe_remote_server, put_remote_servers,
    ProbeRemoteServerRequest, ProbeRemoteServerResponse, RemoteServer, SensitiveString, Settings,
    SettingsState,
};

/// Isolates any test that reaches `save_settings` from the user's real config
/// directory. Named after this change so a stray directory is obvious.
const TEST_SUFFIX: &str = "-rsrv-be-endpoints-tests";

fn settings_state(servers: Vec<RemoteServer>) -> SettingsState {
    Arc::new(RwLock::new(Settings { remote_servers: servers, ..Settings::default() }))
}

fn stored_server(id: &str, token: Option<&str>, has_token: bool) -> RemoteServer {
    RemoteServer {
        id: id.to_string(),
        name: id.to_uppercase(),
        url: "http://192.168.1.5:58901".to_string(),
        token: token.map(|t| SensitiveString::new(t.to_string())),
        has_token,
        ..RemoteServer::default()
    }
}

/// Build an incoming roster straight from JSON, so "no `token` key" is
/// genuinely absent rather than `None` produced by a Rust constructor.
fn roster_from_json(raw: &str) -> Vec<RemoteServer> {
    serde_json::from_str(raw).unwrap()
}

async fn read_json<T: DeserializeOwned>(response: axum::response::Response) -> T {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn token_of(state: &Settings, id: &str) -> Option<String> {
    state
        .remote_servers
        .iter()
        .find(|s| s.id == id)
        .and_then(|s| s.token.as_ref().map(|t| t.expose().to_string()))
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_recomputes_has_token_instead_of_echoing_the_stored_flag() {
    let state = settings_state(vec![
        // Stale in both directions: the flag is a cache that a PUT can leave
        // behind, so GET has to derive it from the token itself.
        stored_server("lab", Some("s3cret"), false),
        stored_server("nobody", Some(""), true),
        stored_server("missing", None, true),
    ]);

    let response = get_remote_servers(State(state)).await;

    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = read_json(response).await;
    assert_eq!(body[0]["has_token"], true, "a stored token must win over a false flag");
    assert_eq!(body[1]["has_token"], false, "an empty token is not a configured token");
    assert_eq!(body[2]["has_token"], false);
}

/// The regression this pair of tests guards, on the read side.
///
/// `RemoteServer::token` has to serialize normally or `save_settings` cannot
/// persist it, so *nothing* about the type keeps it out of a response any more.
/// `get_remote_servers` is what does, and the assertion is on the serialized
/// bytes rather than on the shape of a deserialized `Value`, so a future
/// `skip_serializing_if` or a nested wrapper cannot quietly reintroduce it.
#[tokio::test]
async fn get_never_returns_the_token_itself() {
    let state = settings_state(vec![stored_server("lab", Some("s3cret"), true)]);

    let response = get_remote_servers(State(state)).await;
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let raw = String::from_utf8(bytes.to_vec()).unwrap();

    assert!(!raw.contains("s3cret"), "the token leaked into {raw}");
    assert!(!raw.contains(r#""token""#), "the key must be omitted, not just nulled: {raw}");
    assert!(raw.contains(r#""has_token":true"#), "the scrub must not erase the flag: {raw}");
    // The rest of the entry still has to come through.
    assert!(raw.contains(r#""id":"lab""#), "{raw}");
}

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

#[tokio::test]
async fn put_keeps_clears_and_overwrites_tokens_per_id() {
    let _env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
    std::env::set_var("DINOTTY_CONFIG_SUFFIX", TEST_SUFFIX);

    let state = settings_state(vec![stored_server("lab", Some("stored"), true)]);

    // (a) The `token` key is absent - which is what a GET -> edit -> PUT round
    // trip produces, because GET scrubs the secret before answering. Keep the
    // stored one.
    let response = put_remote_servers(
        State(Arc::clone(&state)),
        Json(roster_from_json(r#"[{"id":"lab","name":"Lab","url":"http://192.168.1.5:58901"}]"#)),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    {
        let current = state.read().await;
        assert_eq!(token_of(&current, "lab").as_deref(), Some("stored"));
        assert!(current.remote_servers[0].has_token);
    }

    // (b) An explicit empty string is the "clear this token" instruction.
    let response = put_remote_servers(
        State(Arc::clone(&state)),
        Json(roster_from_json(
            r#"[{"id":"lab","name":"Lab","url":"http://192.168.1.5:58901","token":""}]"#,
        )),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    {
        let current = state.read().await;
        assert_eq!(token_of(&current, "lab").as_deref(), Some(""));
        assert!(!current.remote_servers[0].has_token, "a cleared token must not report has_token");
    }

    // (c) A supplied value overwrites.
    let response = put_remote_servers(
        State(Arc::clone(&state)),
        Json(roster_from_json(
            r#"[{"id":"lab","name":"Lab","url":"http://192.168.1.5:58901","token":"fresh"}]"#,
        )),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let current = state.read().await;
    assert_eq!(token_of(&current, "lab").as_deref(), Some("fresh"));
    assert!(current.remote_servers[0].has_token);
}

#[tokio::test]
async fn put_replaces_the_whole_list_and_only_inherits_per_id() {
    let _env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
    std::env::set_var("DINOTTY_CONFIG_SUFFIX", TEST_SUFFIX);

    let state = settings_state(vec![
        stored_server("lab", Some("token-lab"), true),
        stored_server("attic", Some("token-attic"), true),
    ]);

    let response = put_remote_servers(
        State(Arc::clone(&state)),
        Json(roster_from_json(
            r#"[{"id":"lab","name":"Lab","url":"http://192.168.1.5:58901"},
                {"id":"new","name":"New","url":"http://192.168.1.6:58902"}]"#,
        )),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let current = state.read().await;
    assert_eq!(current.remote_servers.len(), 2, "an omitted entry is deleted, not retained");
    assert!(current.remote_servers.iter().all(|s| s.id != "attic"));
    assert_eq!(token_of(&current, "lab").as_deref(), Some("token-lab"));
    assert!(token_of(&current, "new").is_none(), "a new id has no token to inherit");
    assert!(!current.remote_servers[1].has_token);
}

#[tokio::test]
async fn put_rejects_a_url_that_is_not_a_plain_http_origin() {
    let state = settings_state(vec![]);

    for (url, expected) in [
        ("ws://192.168.1.5:58901", "scheme"),
        ("http://192.168.1.5:58901/ws", "path"),
        ("http://user:pass@192.168.1.5:58901", "credentials"),
        ("", "empty"),
    ] {
        let incoming = serde_json::json!([{ "id": "lab", "name": "Lab", "url": url }]);
        let response = put_remote_servers(
            State(Arc::clone(&state)),
            Json(serde_json::from_value(incoming).unwrap()),
        )
        .await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{url}");
        let body: serde_json::Value = read_json(response).await;
        let message = body["error"].as_str().unwrap().to_string();
        assert!(message.contains(expected), "{url} produced {message}");
        assert!(state.read().await.remote_servers.is_empty(), "{url} was stored anyway");
    }
}

#[tokio::test]
async fn put_normalizes_a_trailing_slash_to_the_bare_origin() {
    let _env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
    std::env::set_var("DINOTTY_CONFIG_SUFFIX", TEST_SUFFIX);

    let state = settings_state(vec![]);

    let response = put_remote_servers(
        State(Arc::clone(&state)),
        Json(roster_from_json(r#"[{"id":"lab","name":"Lab","url":"http://192.168.1.5:58901/"}]"#)),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(state.read().await.remote_servers[0].url, "http://192.168.1.5:58901");
}

// ---------------------------------------------------------------------------
// probe
// ---------------------------------------------------------------------------

struct Upstream {
    origin: String,
    info_hits: Arc<AtomicUsize>,
    info_auth: Arc<Mutex<Vec<String>>>,
    task: JoinHandle<()>,
}

impl Drop for Upstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn serve(app: Router) -> Upstream {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Upstream {
        origin: format!("http://{addr}"),
        info_hits: Arc::new(AtomicUsize::new(0)),
        info_auth: Arc::new(Mutex::new(Vec::new())),
        task,
    }
}

/// A stand-in for a real dinotty server: the public `/api/token-configured`
/// answered from `configured`/`is_server_binary`, and an authenticated
/// `/api/info` that records whether it was called and with what credential.
async fn spawn_dinotty(
    configured: bool,
    is_server_binary: bool,
    info: serde_json::Value,
) -> Upstream {
    spawn_dinotty_guarded(configured, is_server_binary, info, None).await
}

/// The same upstream, but `/api/info` demands `required` and answers `401` when
/// the Bearer header does not match - which is what the real
/// `auth_middleware` does for a token it does not accept.
///
/// The guard is what makes the by-id tests meaningful: without it the fake
/// upstream ignored the credential entirely, so a probe that sent the *wrong*
/// token would still have "succeeded" and the security assertion would pass for
/// the wrong reason.
async fn spawn_dinotty_guarded(
    configured: bool,
    is_server_binary: bool,
    info: serde_json::Value,
    required: Option<&str>,
) -> Upstream {
    let info_hits = Arc::new(AtomicUsize::new(0));
    let info_auth = Arc::new(Mutex::new(Vec::new()));

    let recorded_hits = Arc::clone(&info_hits);
    let recorded_auth = Arc::clone(&info_auth);
    let required = required.map(str::to_string);
    let app = Router::new()
        .route(
            "/api/token-configured",
            get(move || async move {
                Json(json!({
                    "configured": configured,
                    "server_mode": is_server_binary,
                    "login_method": "token",
                }))
            }),
        )
        .route(
            "/api/info",
            get(move |headers: HeaderMap| {
                let hits = Arc::clone(&recorded_hits);
                let auth = Arc::clone(&recorded_auth);
                let info = info.clone();
                let required = required.clone();
                async move {
                    hits.fetch_add(1, Ordering::SeqCst);
                    let seen = headers
                        .get(header::AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or_default()
                        .to_string();
                    auth.lock().unwrap().push(seen.clone());
                    if let Some(required) = required {
                        if seen != format!("Bearer {required}") {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(json!({"error": "unauthorized"})),
                            )
                                .into_response();
                        }
                    }
                    Json(info).into_response()
                }
            }),
        );

    let mut upstream = serve(app).await;
    upstream.info_hits = info_hits;
    upstream.info_auth = info_auth;
    upstream
}

async fn probe(url: &str, token: Option<&str>) -> ProbeRemoteServerResponse {
    probe_with(&settings_state(vec![]), url, token).await
}

/// The id-less form, against a caller-supplied roster.
///
/// The roster is only passed in so a test can prove it is *not* consulted on
/// this path; the URL probe must not depend on what is stored.
async fn probe_with(
    state: &SettingsState,
    url: &str,
    token: Option<&str>,
) -> ProbeRemoteServerResponse {
    let request = ProbeRemoteServerRequest {
        id: None,
        url: url.to_string(),
        token: token.map(str::to_string),
    };
    read_json(probe_remote_server(State(Arc::clone(state)), Json(request)).await).await
}

async fn probe_by_id(state: &SettingsState, id: Option<&str>) -> ProbeRemoteServerResponse {
    probe_by_id_request(state, id, "", None).await
}

/// Probe an existing roster entry.
///
/// `url` and `token` are the *forged* values a hostile or confused client would
/// send alongside the id; the tests pass a real one where they want that
/// proven ignored.
async fn probe_by_id_request(
    state: &SettingsState,
    id: Option<&str>,
    url: &str,
    token: Option<&str>,
) -> ProbeRemoteServerResponse {
    let request = ProbeRemoteServerRequest {
        id: id.map(str::to_string),
        url: url.to_string(),
        token: token.map(str::to_string),
    };
    read_json(probe_remote_server(State(Arc::clone(state)), Json(request)).await).await
}

/// A probe that must fail before any socket is opened. The URLs below are
/// either unparseable or point at TEST-NET-1, which never answers - so an
/// implementation that reached the network would time out, not return the
/// validation message.
#[tokio::test]
async fn probe_rejects_a_bad_url_without_touching_the_network() {
    for (url, expected) in [
        ("ws://192.168.1.5:58901", "scheme"),
        ("http://192.0.2.1:80/some/path", "path"),
        ("http://user:pass@192.0.2.1", "credentials"),
        ("http://192.0.2.1/?token=x", "query"),
        ("not a url", "invalid url"),
        ("", "empty"),
    ] {
        let result = probe(url, None).await;

        assert!(!result.reachable, "{url} must not be reported reachable");
        let error = result.error.unwrap_or_default();
        assert!(error.contains(expected), "{url} produced {error}");
    }
}

#[tokio::test]
async fn probe_skips_the_authenticated_step_when_no_token_is_supplied() {
    let upstream = spawn_dinotty(true, false, json!({"version": "0.26.0"})).await;

    let result = probe(&upstream.origin, Some("")).await;

    assert!(result.reachable, "reachability is decided by the public step");
    assert!(result.token_configured);
    assert_eq!(result.server_mode.as_deref(), Some("embedded"));
    assert!(result.error.is_none(), "a reachable server has no error: {:?}", result.error);
    assert_eq!(result.settings_version, None);
    assert_eq!(
        upstream.info_hits.load(Ordering::SeqCst),
        0,
        "/api/info cannot succeed without a credential, so it must not be attempted"
    );
}

#[tokio::test]
async fn probe_authenticates_the_version_step_with_the_candidate_token() {
    let upstream = spawn_dinotty(
        true,
        true,
        json!({"lan_ip": "127.0.0.1", "port": 8999, "version": "0.26.0", "settings_version": 15}),
    )
    .await;

    let result = probe(&upstream.origin, Some("candidate")).await;

    assert!(result.reachable);
    assert!(result.token_configured);
    assert_eq!(result.server_mode.as_deref(), Some("server"));
    assert_eq!(result.settings_version, Some(15));
    assert_eq!(upstream.info_hits.load(Ordering::SeqCst), 1);
    assert_eq!(upstream.info_auth.lock().unwrap().as_slice(), ["Bearer candidate"]);
}

/// `token_configured: false` is the security-relevant answer: an upstream with
/// no token lets anyone who can reach it in as admin, so the probe has to
/// report it rather than let "reachable" imply "set up".
#[tokio::test]
async fn probe_reports_an_upstream_that_demands_no_token() {
    let upstream = spawn_dinotty(false, true, json!({"version": "0.26.0"})).await;

    let result = probe(&upstream.origin, Some("candidate")).await;

    assert!(result.reachable);
    assert!(!result.token_configured, "an unprotected upstream must be reported as such");
}

/// An upstream that accepts the token but does not carry `settings_version`
/// answers `Some(true)` for the credential and `None` for the version - it is
/// simply too old to say, which is a successful probe, not a failure.
#[tokio::test]
async fn probe_reports_no_settings_version_when_the_upstream_does_not_expose_one() {
    let upstream = spawn_dinotty(
        true,
        true,
        json!({"lan_ip": "127.0.0.1", "port": 8999, "version": "0.26.0", "repo_url": "x"}),
    )
    .await;

    let result = probe(&upstream.origin, Some("candidate")).await;

    assert!(result.reachable);
    assert!(result.token_configured);
    assert_eq!(result.settings_version, None);
    assert_eq!(
        result.token_valid,
        Some(true),
        "an old upstream that accepted the token must not be blamed for the missing field"
    );
    assert!(result.error.is_none(), "an old upstream is not an error");
}

/// The counterpart to the test above, and the reason `token_valid` exists: a
/// *rejected* credential and an *old* upstream both leave `settings_version`
/// as `None` while `reachable` stays true, so without this flag the user would
/// be told to check versions when the real fix is to re-paste a token.
#[tokio::test]
async fn probe_reports_a_rejected_token_apart_from_a_missing_version_field() {
    let upstream =
        spawn_dinotty_guarded(false, true, json!({"version": "0.26.0"}), Some("right")).await;

    let result = probe(&upstream.origin, Some("wrong")).await;

    assert!(result.reachable, "a 401 from /api/info does not make the server unreachable");
    assert_eq!(result.token_valid, Some(false), "a 401 must be reported as a bad token");
    assert_eq!(result.settings_version, None);
}

/// The third of the three ways to get no version: nothing was tested, so
/// nothing is claimed. `None` must not be read as a rejection.
#[tokio::test]
async fn probe_leaves_token_valid_unset_when_it_had_no_credential_to_test() {
    let upstream = spawn_dinotty(true, true, json!({"version": "0.26.0"})).await;

    let result = probe(&upstream.origin, Some("")).await;

    assert!(result.reachable);
    assert_eq!(result.token_valid, None, "an untested credential is not a rejected one");
}

#[tokio::test]
async fn probe_reports_a_connection_refused_target_without_a_traceback() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);

    let result = probe(&origin, None).await;

    assert!(!result.reachable);
    let error = result.error.unwrap_or_default();
    assert!(error.contains("refused"), "expected a refused-connection message, got {error}");
}

#[tokio::test]
async fn probe_refuses_to_call_a_stranger_a_dinotty_server() {
    // Port 0 gives a live listener that answers 404 for every dinotty path.
    // Reporting that as "reachable, no token configured" would tell the user
    // their unauthenticated server is fine when it is not a server at all.
    let upstream = serve(Router::new()).await;

    let result = probe(&upstream.origin, None).await;

    assert!(!result.reachable);
    let error = result.error.unwrap_or_default();
    assert!(error.contains("not a dinotty server"), "got {error}");
    assert_eq!(upstream.info_hits.load(Ordering::SeqCst), 0);
}

// ---------------------------------------------------------------------------
// probe by roster id
// ---------------------------------------------------------------------------

/// The defect this whole shape exists for.
///
/// `GET /api/remote-servers` never returns a token, so a frontend switching to
/// an existing entry has no credential to send. Probing by URL therefore cannot
/// authenticate against a token-protected server at all - it would come back
/// `reachable: true` off the public step with the authenticated step 401ing,
/// and the switch would abort. Resolving both the URL and the token hub-side is
/// what makes "switch to a server that has a token" possible.
#[tokio::test]
async fn probe_by_id_uses_the_stored_token_to_reach_the_version_step() {
    let upstream =
        spawn_dinotty_guarded(true, true, json!({"settings_version": 15}), Some("stored")).await;
    let state = settings_state(vec![RemoteServer {
        id: "lab".to_string(),
        name: "Lab".to_string(),
        url: upstream.origin.clone(),
        token: Some(SensitiveString::new("stored".to_string())),
        has_token: true,
        ..RemoteServer::default()
    }]);

    let result = probe_by_id(&state, Some("lab")).await;

    assert!(result.reachable, "{:?}", result.error);
    assert_eq!(result.token_valid, Some(true), "the stored token must have been used");
    assert_eq!(result.settings_version, Some(15), "the version step must have been reached");
    assert_eq!(upstream.info_hits.load(Ordering::SeqCst), 1);
    assert_eq!(
        upstream.info_auth.lock().unwrap().as_slice(),
        ["Bearer stored"],
        "the roster token is the only credential the upstream may see"
    );
}

/// The security assertion for the by-id shape: a request that names a roster id
/// gets *that* entry's origin and *that* entry's token, whatever it puts in its
/// own `url` and `token` fields.
///
/// Both halves are load-bearing. The forged URL is pointed at a second live
/// upstream, so "the request url was ignored" is proved by *which server
/// answered* rather than by reading the code; the forged token is what that
/// second server would have accepted, so a probe that let it through would
/// still have to explain `token_valid: Some(true)` here. Accepting either field
/// would turn a roster id into a way to aim the hub's probe at an arbitrary
/// host with an arbitrary credential.
#[tokio::test]
async fn probe_by_id_ignores_a_supplied_url_and_token() {
    let roster_upstream =
        spawn_dinotty_guarded(true, true, json!({"settings_version": 15}), Some("stored")).await;
    // The decoy accepts a *different* token, so the two candidate credentials
    // are distinguishable by outcome and not just by the recorded header.
    let forged_upstream =
        spawn_dinotty_guarded(true, true, json!({"settings_version": 15}), Some("forged")).await;

    let state = settings_state(vec![RemoteServer {
        id: "lab".to_string(),
        name: "Lab".to_string(),
        url: roster_upstream.origin.clone(),
        token: Some(SensitiveString::new("stored".to_string())),
        has_token: true,
        ..RemoteServer::default()
    }]);

    let result =
        probe_by_id_request(&state, Some("lab"), &forged_upstream.origin, Some("forged")).await;

    assert!(result.reachable, "{:?}", result.error);
    assert_eq!(
        forged_upstream.info_hits.load(Ordering::SeqCst),
        0,
        "the probe must not have contacted the url supplied alongside the id"
    );
    assert_eq!(
        roster_upstream.info_hits.load(Ordering::SeqCst),
        1,
        "the probe must have contacted the roster entry's own url"
    );
    assert_eq!(
        roster_upstream.info_auth.lock().unwrap().as_slice(),
        ["Bearer stored"],
        "the roster token must have been used, not the supplied one"
    );
    assert_eq!(result.token_valid, Some(true));
}

/// An id that is not in the roster is an error, and the error must not describe
/// the roster - not the ids it does hold, not how many, and not any URL. The
/// answer has to be the same shape as any other unknown id, so the endpoint
/// cannot be used to enumerate what the hub is configured to reach.
#[tokio::test]
async fn probe_by_id_rejects_an_unknown_id_without_describing_the_roster() {
    let upstream = spawn_dinotty(true, true, json!({"settings_version": 15})).await;
    let state = settings_state(vec![RemoteServer {
        id: "lab".to_string(),
        name: "Lab".to_string(),
        url: upstream.origin.clone(),
        token: Some(SensitiveString::new("stored".to_string())),
        has_token: true,
        ..RemoteServer::default()
    }]);

    let result = probe_by_id_request(&state, Some("attic"), &upstream.origin, Some("stored")).await;

    assert!(!result.reachable, "an unknown id must not be probed");
    let error = result.error.clone().unwrap_or_default();
    assert!(error.contains("attic"), "the unknown id should be named: {error}");
    assert!(
        !error.contains("lab") && !error.contains(&upstream.origin),
        "the error must not leak the roster: {error}"
    );
    assert_eq!(
        upstream.info_hits.load(Ordering::SeqCst),
        0,
        "an unknown id must fail before any network call"
    );
}

/// Regression guard for the id-less form, which the add/edit "Test connection"
/// button still uses: the stored roster must play no part in it.
#[tokio::test]
async fn probe_without_an_id_still_uses_the_supplied_url_and_token() {
    let target =
        spawn_dinotty_guarded(true, true, json!({"settings_version": 15}), Some("typed")).await;
    // A roster that names a *different* server, to prove the id-less path does
    // not fall back to the roster when its own url is present.
    let state = settings_state(vec![stored_server("lab", Some("stored"), true)]);

    let result = probe_with(&state, &target.origin, Some("typed")).await;

    assert!(result.reachable, "{:?}", result.error);
    assert_eq!(result.token_valid, Some(true));
    assert_eq!(result.settings_version, Some(15));
    assert_eq!(target.info_auth.lock().unwrap().as_slice(), ["Bearer typed"]);
}

/// The id-less form still validates its own url rather than trusting it.
#[tokio::test]
async fn probe_without_an_id_still_rejects_a_bad_url() {
    let state = settings_state(vec![]);

    let result = probe_with(&state, "ws://192.168.1.5:58901", Some("typed")).await;

    assert!(!result.reachable);
    assert!(
        result.error.unwrap_or_default().contains("scheme"),
        "the url validation must still run on the id-less path"
    );
}

/// The wire shapes the frontend actually sends, pinned as raw JSON.
///
/// `{"id": "…"}` is the one that matters: a caller probing a roster entry has
/// no URL to send and no way to learn the stored one, so the endpoint has to
/// accept the id on its own. Building the request through the Rust struct would
/// not catch a `url` that went back to being a required field, because the
/// struct's `Default` always supplies one.
#[test]
fn probe_request_accepts_the_shapes_clients_send() {
    // By id alone - the switch path.
    let by_id: ProbeRemoteServerRequest = serde_json::from_str(r#"{"id":"lab"}"#).unwrap();
    assert_eq!(by_id.id.as_deref(), Some("lab"));
    assert!(by_id.url.is_empty());
    assert!(by_id.token.is_none());

    // By url, with and without a candidate token - the add/edit "Test
    // connection" button.
    let by_url: ProbeRemoteServerRequest =
        serde_json::from_str(r#"{"url":"http://192.168.1.5:58901"}"#).unwrap();
    assert!(by_url.id.is_none());
    assert_eq!(by_url.url, "http://192.168.1.5:58901");
    assert!(by_url.token.is_none());

    let with_token: ProbeRemoteServerRequest =
        serde_json::from_str(r#"{"url":"http://192.168.1.5:58901","token":"candidate"}"#).unwrap();
    assert_eq!(with_token.token.as_deref(), Some("candidate"));

    // A request that names neither still deserializes, so the failure is the
    // actionable "url is empty" rather than a field-name complaint.
    let neither: ProbeRemoteServerRequest = serde_json::from_str("{}").unwrap();
    assert!(neither.id.is_none());
    assert!(neither.url.is_empty());
}

// ---------------------------------------------------------------------------
// persistence and the /api/settings response
// ---------------------------------------------------------------------------

/// The secret both of the tests below plant, named once so an assertion that
/// accidentally stops matching the fixture is obvious rather than passing.
const PERSISTED: &str = "a-real-looking-persisted-token";

/// The raw body of a response, so the assertions below run against the bytes a
/// client actually receives rather than a re-deserialized `Value`.
async fn read_raw(response: axum::response::Response) -> String {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn state_with_persisted_token() -> SettingsState {
    settings_state(vec![stored_server("lab", Some(PERSISTED), true)])
}

/// The bug this change exists for: a token that never reaches `settings.json`
/// makes the user re-paste it after every restart.
///
/// Asserted through `load_settings` and not merely by inspecting the file, so
/// the whole round trip is covered. Making the token survive
/// `to_string_pretty` without making it survive `from_str` would still lose it.
#[tokio::test]
async fn save_settings_writes_the_token_and_load_settings_reads_it_back() {
    // The config dir is process-global state, so this test has to own the
    // suffix for as long as it reads it - `EnvGuard` also serializes it against
    // every other test that touches the same variable.
    let _env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
    std::env::set_var("DINOTTY_CONFIG_SUFFIX", "-rsrv-fix-secrets-save");

    let stored = state_with_persisted_token().read().await.clone();
    save_settings(&stored).unwrap();

    let on_disk =
        std::fs::read_to_string(crate::settings::config_dir().join("settings.json")).unwrap();
    assert!(
        on_disk.contains(PERSISTED),
        "the token must be written to settings.json, got: {on_disk}"
    );

    let reloaded = crate::settings::load_settings();
    assert_eq!(token_of(&reloaded, "lab").as_deref(), Some(PERSISTED));
    assert!(reloaded.remote_servers[0].has_token);
}

/// The other half of the same fix: the token is on disk *and* nowhere in the
/// settings response. `get_settings` is the only handler that returns a whole
/// `Settings`, and it is the one that has to scrub.
#[tokio::test]
async fn get_settings_response_never_contains_the_token() {
    let _env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
    std::env::set_var("DINOTTY_CONFIG_SUFFIX", "-rsrv-fix-secrets-get");

    // `get_settings` extracts the manager alongside the settings state.
    let manager = Arc::new(SessionManager::new());
    let response = get_settings(State((manager, state_with_persisted_token()))).await;

    let raw = read_raw(response.into_response()).await;
    assert!(!raw.contains(PERSISTED), "the token leaked into {raw}");

    // The key check has to be scoped to the roster entry: the rest of this body
    // legitimately contains the *word* token (`"login_method":"token"`), so a
    // whole-body substring test would fail for reasons that have nothing to do
    // with the secret.
    let body: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let entry = &body["remote_servers"][0];
    assert_eq!(entry["id"], "lab");
    assert!(entry.get("token").is_none(), "the key must be omitted, not just nulled: {entry}");
    assert_eq!(entry["has_token"], true, "the flag must survive the scrub: {entry}");
}

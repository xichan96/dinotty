//! Guards the routes that must exist in *both* routers.
//!
//! There is no shared route builder. `src/main.rs` (server mode) and
//! `src-tauri/src/embedded_server/router.rs` (desktop) each build their own
//! `Router` by hand, and `router.rs` carries a comment admitting it is a copy.
//! Nothing else in CI compares them, and they have already drifted: `main.rs`
//! mounts 128 routes, the embedded router 121.
//!
//! That drift is *partly legitimate* — `/api/history`, the plugin marketplace,
//! `/api/audit` and the agent/MCP group are server-only by design. So this test
//! does not demand the tables be equal; it pins a named list of routes that a
//! desktop user and a browser user must both reach. Adding a route to one table
//! and forgetting the other has no symptom until someone uses the missing
//! client, which is exactly the kind of failure a test is for.
//!
//! When you mount a new route in both routers, add it to `SHARED`. When you
//! mount one deliberately in a single router, do not.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Routes that must be reachable from the server, the desktop app, and (through
/// the hub relay) any client addressed to either.
const SHARED: &[&str] = &[
    // Feature added alongside this test: user-installed language packs live in
    // the server's config dir, so a client can only see them if the *server*
    // resolves them. A desktop-only or server-only copy is a silent loss of the
    // feature for the other client.
    "/api/locales",
    // Install and remove a pack. The upload is the *only* way to add a language
    // from a phone, so a server-only copy means the feature is invisible in the
    // desktop app, and vice versa.
    "/api/locales/:tag",
    // Settings and the background image are the precedent this route follows.
    "/api/settings",
    "/api/settings/background",
    "/api/log",
    "/api/info",
    "/api/shells",
    "/api/clipboard",
];

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

/// Every `"/api/..."` string literal in a router source file.
///
/// A textual scan rather than a parse: the point is to catch a route that is
/// absent, and a route that is absent is absent from the text too. Scanning
/// keeps this working if the surrounding builder style changes.
fn routes_in(path: &Path) -> HashSet<String> {
    let source = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("could not read {}: {e}", path.display()));
    let mut found = HashSet::new();
    let mut rest = source.as_str();
    while let Some(start) = rest.find("\"/api/") {
        rest = &rest[start + 1..];
        let Some(end) = rest[1..].find('"') else { break };
        found.insert(rest[..=end].to_string());
        rest = &rest[end + 1..];
    }
    found
}

fn both_routers() -> (HashSet<String>, HashSet<String>) {
    let root = repo_root();
    (
        routes_in(&root.join("src/main.rs")),
        routes_in(&root.join("src-tauri/src/embedded_server/router.rs")),
    )
}

/// Guard against the scanner silently matching nothing, which would make every
/// assertion below vacuous.
#[test]
fn finds_routes_in_both_router_tables() {
    let (server, embedded) = both_routers();
    assert!(server.len() > 50, "server router scan found only {}", server.len());
    assert!(embedded.len() > 50, "embedded router scan found only {}", embedded.len());
}

#[test]
fn shared_routes_are_mounted_in_the_server() {
    let (server, _) = both_routers();
    let missing: Vec<_> = SHARED.iter().filter(|r| !server.contains(**r)).collect();
    assert!(missing.is_empty(), "missing from src/main.rs: {missing:?}");
}

#[test]
fn shared_routes_are_mounted_in_the_desktop_app() {
    let (_, embedded) = both_routers();
    let missing: Vec<_> = SHARED.iter().filter(|r| !embedded.contains(**r)).collect();
    assert!(
        missing.is_empty(),
        "missing from src-tauri/src/embedded_server/router.rs: {missing:?}"
    );
}

/// The embedded router is the one that gets forgotten: adding a route to
/// `main.rs` is what a server-mode feature naturally does, and the desktop is
/// only noticed when someone opens the app. Report the drift so it is a number
/// someone can decide about rather than a surprise.
#[test]
fn reports_how_far_the_two_tables_have_drifted() {
    let (server, embedded) = both_routers();
    let only_server = server.difference(&embedded).count();
    let only_embedded = embedded.difference(&server).count();
    // Deliberately generous: this is a tripwire on a large step change, not an
    // assertion that the tables match. Equal tables would fail this too, which
    // is fine — it would mean the invariant above needs rethinking.
    assert!(
        only_server < 40 && only_embedded < 40,
        "router tables have diverged further: {only_server} only in server, \
         {only_embedded} only in embedded — check whether a shared route was \
         mounted on one side only"
    );
}

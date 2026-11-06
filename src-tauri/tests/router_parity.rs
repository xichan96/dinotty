//! The desktop app serves its own router (`embedded_server/router.rs`), while
//! the standalone server uses `src/main.rs`. The two tables are separate
//! copies, so a new route added to one silently 404s in the other. This test
//! pins the route paths against each other.

use std::collections::BTreeSet;

const STANDALONE_ROUTER: &str = include_str!("../../src/main.rs");
const EMBEDDED_ROUTER: &str = include_str!("../src/embedded_server/router.rs");

/// Collect every path passed as the first argument of `.route("...")`.
fn route_paths(source: &str) -> BTreeSet<String> {
    const MARKER: &str = ".route(";
    let mut paths = BTreeSet::new();
    let mut rest = source;
    while let Some(start) = rest.find(MARKER) {
        rest = &rest[start + MARKER.len()..];
        let Some(quote) = rest.find('"') else { break };
        // Only accept a string literal as the first argument; anything else
        // (e.g. a constant) would not be a route path we can compare.
        if !rest[..quote].trim().is_empty() {
            continue;
        }
        let after_quote = &rest[quote + 1..];
        let Some(end) = after_quote.find('"') else { break };
        paths.insert(after_quote[..end].to_string());
        rest = &after_quote[end + 1..];
    }
    paths
}

#[test]
fn embedded_router_paths_match_the_standalone_router() {
    let standalone = route_paths(STANDALONE_ROUTER);
    let embedded = route_paths(EMBEDDED_ROUTER);

    let missing: Vec<_> = standalone.difference(&embedded).collect();
    let extra: Vec<_> = embedded.difference(&standalone).collect();

    assert!(
        missing.is_empty() && extra.is_empty(),
        "route tables drifted.\nmissing from embedded_server/router.rs: {missing:?}\n\
         present only in embedded_server/router.rs: {extra:?}"
    );
}

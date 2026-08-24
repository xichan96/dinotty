//! Guards the compression invariants that `main.rs`'s `CompressionLayer` relies on.
//!
//! The layer is added with `DefaultPredicate`, and the comment at the call site
//! claims that predicate leaves Server-Sent Events alone. That claim is
//! load-bearing: terminal output and event streams travel over SSE, and
//! compressing them would buffer bytes until the encoder's block fills, turning
//! live streaming into stuttering batches.
//!
//! Nothing in dinotty's own code enforces this — it is a property of
//! tower-http's `DefaultPredicate`. A dependency bump could silently change it,
//! so these tests pin the behaviour rather than trusting the comment.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use tower::ServiceExt;
use tower_http::compression::CompressionLayer;

/// Long enough to clear the predicate's 32-byte `SizeAbove` floor by a wide margin.
fn payload() -> String {
    "data: hello\n\n".repeat(200)
}

fn app() -> Router {
    Router::new()
        .route(
            "/sse",
            get(|| async {
                ([(header::CONTENT_TYPE, "text/event-stream")], payload()).into_response()
            }),
        )
        .route(
            "/json",
            get(|| async {
                ([(header::CONTENT_TYPE, "application/json")], payload()).into_response()
            }),
        )
        .route(
            "/png",
            get(|| async { ([(header::CONTENT_TYPE, "image/png")], payload()).into_response() }),
        )
        .route(
            "/tiny",
            get(|| async { ([(header::CONTENT_TYPE, "text/plain")], "ok").into_response() }),
        )
        .layer(CompressionLayer::new().gzip(true).br(true))
}

async fn content_encoding_of(path: &str) -> Option<String> {
    let resp = app()
        .oneshot(
            Request::builder()
                .uri(path)
                .header(header::ACCEPT_ENCODING, "gzip, br")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "{path} should be reachable");
    resp.headers().get(header::CONTENT_ENCODING).map(|v| v.to_str().unwrap().to_string())
}

#[tokio::test]
async fn sse_is_never_compressed() {
    assert_eq!(
        content_encoding_of("/sse").await,
        None,
        "SSE must stay uncompressed or live streaming buffers into batches"
    );
}

#[tokio::test]
async fn images_are_not_recompressed() {
    assert_eq!(
        content_encoding_of("/png").await,
        None,
        "already-compressed image bytes should not be run through the encoder again"
    );
}

#[tokio::test]
async fn tiny_bodies_are_not_compressed() {
    assert_eq!(
        content_encoding_of("/tiny").await,
        None,
        "bodies under the 32-byte floor cost more compressed than raw"
    );
}

#[tokio::test]
async fn text_payloads_are_compressed() {
    // The counterpart to the exemptions above: proves the layer is actually
    // active, so the assertions of `None` mean "exempted" and not "layer off".
    assert_eq!(content_encoding_of("/json").await.as_deref(), Some("br"));
}

#[tokio::test]
async fn compression_shrinks_the_body_and_sets_vary() {
    let resp = app()
        .oneshot(
            Request::builder()
                .uri("/json")
                .header(header::ACCEPT_ENCODING, "gzip, br")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let vary = resp.headers().get(header::VARY).map(|v| v.to_str().unwrap().to_lowercase());
    assert_eq!(
        vary.as_deref(),
        Some("accept-encoding"),
        "without Vary, a shared cache can serve encoded bytes to a client that cannot decode them"
    );
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    assert!(
        body.len() < payload().len(),
        "compressed body ({}) should be smaller than raw ({})",
        body.len(),
        payload().len()
    );
}

#[tokio::test]
async fn identity_request_gets_raw_bytes() {
    let resp = app()
        .oneshot(
            Request::builder()
                .uri("/json")
                .header(header::ACCEPT_ENCODING, "identity")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.headers().get(header::CONTENT_ENCODING), None);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    assert_eq!(body.len(), payload().len(), "client that cannot decode must get raw bytes");
}

#![allow(clippy::unwrap_used, clippy::expect_used)]
use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocketUpgrade},
        FromRequest, Request,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite;
use tungstenite::client::IntoClientRequest;

#[allow(clippy::too_many_lines)]
pub async fn proxy_websocket(
    req: Request,
    upstream_url: String,
    allowed_origins: &[String],
    trusted_proxies: &[String],
) -> Response {
    // WS Origin check (prevents cross-site WebSocket hijacking).
    let conn_ip = req
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map_or_else(|| "127.0.0.1".parse().unwrap(), |ci| ci.ip());
    let real_ip = crate::auth::real_client_ip(req.headers(), conn_ip, trusted_proxies);
    if !crate::auth::check_ws_origin(req.headers(), allowed_origins, real_ip, trusted_proxies) {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Body::from("origin not allowed"))
            .unwrap();
    }

    let protocols: Vec<String> = req
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').map(|p| p.trim().to_string()).collect())
        .unwrap_or_default();

    let mut forward_headers = Vec::new();
    for (name, value) in req.headers() {
        let n = name.as_str();
        // `origin` is deliberately excluded: like the HTTP path, it describes
        // the browser→dinotty hop. `into_client_request` sets `Host` from the
        // upstream URL, so forwarding the browser's Origin leaves the pair
        // mismatched and an upstream same-origin fence rejects the upgrade.
        // It is re-added below, aligned with that Host.
        if (n == "cookie"
            || n == "authorization"
            || n.starts_with("x-")
            || n.starts_with("sec-websocket-"))
            && n != "sec-websocket-key"
            && n != "sec-websocket-version"
            && n != "sec-websocket-extensions"
        {
            if let Ok(v) = value.to_str() {
                forward_headers.push((n.to_string(), v.to_string()));
            }
        }
    }

    let ws = match WebSocketUpgrade::from_request(req, &()).await {
        Ok(ws) => ws,
        Err(e) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from(format!("WebSocket upgrade failed: {e}")))
                .unwrap();
        }
    };

    let ws = if protocols.is_empty() { ws } else { ws.protocols(protocols.clone()) };

    ws.on_upgrade(move |client_ws| async move {
        let mut request = match upstream_url.as_str().into_client_request() {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("WebSocket proxy: invalid request for {}: {}", upstream_url, e);
                return;
            }
        };
        for (name, value) in &forward_headers {
            if let Ok(v) = value.parse() {
                request.headers_mut().insert(
                    axum::http::header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                    v,
                );
            }
        }
        if !protocols.is_empty() {
            request
                .headers_mut()
                .insert("Sec-WebSocket-Protocol", protocols.join(", ").parse().unwrap());
        }
        // Same-origin `Origin` for the upstream, derived from the `Host` that
        // `into_client_request` set from `upstream_url` — so the two always
        // agree even for an IPv6 or non-default-port authority. This mirrors
        // `same_origin_headers` on the HTTP path; see `should_forward_header`
        // for why the browser's own `Origin` must not survive.
        if let Some(host) = request.headers().get(axum::http::header::HOST).cloned() {
            if let Ok(h) = host.to_str() {
                if let Ok(v) = format!("http://{h}").parse() {
                    request.headers_mut().insert(axum::http::header::ORIGIN, v);
                }
            }
        }
        let connect_result = tokio_tungstenite::connect_async(request).await;

        let upstream = match connect_result {
            Ok((stream, _)) => stream,
            Err(e) => {
                tracing::error!("WebSocket proxy: cannot connect to {}: {}", upstream_url, e);
                return;
            }
        };

        let (mut client_tx, mut client_rx) = client_ws.split();
        let (mut upstream_tx, mut upstream_rx) = upstream.split();

        let client_to_upstream = async {
            while let Some(Ok(msg)) = client_rx.next().await {
                let tung_msg = match msg {
                    Message::Text(t) => tungstenite::Message::Text(t),
                    Message::Binary(b) => tungstenite::Message::Binary(b),
                    Message::Ping(p) => tungstenite::Message::Ping(p),
                    Message::Pong(p) => tungstenite::Message::Pong(p),
                    Message::Close(_) => {
                        let _ = upstream_tx.close().await;
                        return;
                    }
                };
                if upstream_tx.send(tung_msg).await.is_err() {
                    return;
                }
            }
        };

        let upstream_to_client = async {
            while let Some(Ok(msg)) = upstream_rx.next().await {
                let axum_msg = match msg {
                    tungstenite::Message::Text(t) => Message::Text(t),
                    tungstenite::Message::Binary(b) => Message::Binary(b),
                    tungstenite::Message::Ping(p) => Message::Ping(p),
                    tungstenite::Message::Pong(p) => Message::Pong(p),
                    tungstenite::Message::Close(_) => {
                        let _ = client_tx.close().await;
                        return;
                    }
                    tungstenite::Message::Frame(_) => continue,
                };
                if client_tx.send(axum_msg).await.is_err() {
                    return;
                }
            }
        };

        tokio::select! {
            () = client_to_upstream => {},
            () = upstream_to_client => {},
        }
    })
    .into_response()
}

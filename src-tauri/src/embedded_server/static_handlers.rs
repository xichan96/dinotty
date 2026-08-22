use axum::Json;
use axum::{
    body::Body,
    extract::{Path, State as AxumState},
    http::{header, Response, StatusCode},
    response::IntoResponse,
};

use dinotty_server::platform::process::CommandNoWindowExt;

use super::state::{AppState, GitInfo};
use super::StaticFiles;

pub async fn static_handler(Path(path): Path<String>) -> impl IntoResponse {
    let lookup = format!("assets/{}", path);
    match StaticFiles::get(&lookup) {
        Some(content) => {
            let mime = mime_guess::from_path(&lookup).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => {
            Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("not found")).unwrap()
        }
    }
}

pub async fn index() -> impl IntoResponse {
    let content = StaticFiles::get("index.html").expect("index.html must exist in frontend/dist/");
    let html = String::from_utf8_lossy(&content.data);
    (
        [(header::CACHE_CONTROL, axum::http::HeaderValue::from_static("no-store"))],
        axum::response::Html(html.to_string()),
    )
}

pub async fn icon_handler(Path(path): Path<String>) -> impl IntoResponse {
    let lookup = format!("icons/{}", path);
    match StaticFiles::get(&lookup) {
        Some(content) => {
            let mime = mime_guess::from_path(&lookup).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .header(header::CACHE_CONTROL, "public, max-age=86400")
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => {
            Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("not found")).unwrap()
        }
    }
}

pub async fn manifest_handler() -> impl IntoResponse {
    match StaticFiles::get("manifest.json") {
        Some(content) => Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(content.data.into_owned()))
            .unwrap(),
        None => {
            Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("not found")).unwrap()
        }
    }
}

pub fn generate_random_token() -> String {
    use rand::RngExt;
    let mut rng = rand::rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.random::<u8>()).collect();
    bytes.iter().fold(String::with_capacity(64), |mut s, b| {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
        s
    })
}

pub fn read_git_info() -> GitInfo {
    let version = env!("CARGO_PKG_VERSION").to_string();

    let mut command = std::process::Command::new("git");
    let repo_url = command
        .no_window()
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            let url = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if url.starts_with("git@") {
                url.replace(":", "/")
                    .replace("git@", "https://")
                    .trim_end_matches(".git")
                    .to_string()
            } else {
                url.trim_end_matches(".git").to_string()
            }
        })
        .unwrap_or_default();

    GitInfo { version, repo_url }
}

pub async fn server_info(AxumState(state): AxumState<AppState>) -> Json<serde_json::Value> {
    let lan_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());
    Json(serde_json::json!({
        "lan_ip": lan_ip,
        "port": state.port,
        "version": state.git_info.version,
        "repo_url": state.git_info.repo_url,
    }))
}

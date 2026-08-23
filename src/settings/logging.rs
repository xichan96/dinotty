use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{header, Response, StatusCode},
    response::IntoResponse,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::session::SessionManager;

use super::io::load_settings;
use super::{config_dir, SettingsState};

#[must_use]
pub fn log_dir() -> PathBuf {
    config_dir().join("logs")
}

#[must_use]
pub fn log_file_path() -> PathBuf {
    log_dir().join("dinotty.log")
}

/// Initialize the global tracing subscriber based on `settings.log`.
///
/// When `log.enabled` is true, mounts both a stderr layer and a non-blocking
/// file appender writing to `log.path` (or `log_file_path()` if unset), and
/// returns a `WorkerGuard` the caller must keep alive for the process
/// lifetime to ensure buffered writes are flushed. When disabled, mounts a
/// stderr-only subscriber and returns `None`.
///
/// Shared by the `dinotty serve` CLI (`src/main.rs`) and the Tauri desktop /
/// embedded server (`src-tauri/src/main.rs`) so every entry point honors
/// `settings.log.*` uniformly.
///
/// # Panics
///
/// Panics on failure to create the log directory or open the log file,
/// matching prior inline behavior - a misconfigured `log.path` should
/// surface loudly rather than silently swallow logs.
#[must_use]
pub fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let settings = load_settings();

    let env_filter = || {
        tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        )
    };

    if !settings.log.enabled {
        tracing_subscriber::registry()
            .with(env_filter())
            .with(tracing_subscriber::fmt::layer())
            .init();
        return None;
    }

    let log_path = if settings.log.path.is_empty() {
        let dir = log_dir();
        std::fs::create_dir_all(&dir).expect("failed to create log directory");
        log_file_path()
    } else {
        let path = PathBuf::from(&settings.log.path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("failed to create log directory");
        }
        path
    };

    let max_bytes = settings.log.max_size_mb * 1024 * 1024;
    if log_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&log_path) {
            if metadata.len() > max_bytes {
                let backup_path = log_path.with_extension("log.1");
                let _ = std::fs::rename(&log_path, &backup_path);
            }
        }
    }

    let file = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&log_path)
        .expect("failed to create log file");

    let (non_blocking, guard) = tracing_appender::non_blocking(file);

    tracing_subscriber::registry()
        .with(env_filter())
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
        .init();

    tracing::info!("File logging enabled: {:?}", log_path);
    Some(guard)
}

/// Stderr-only tracing subscriber for the MCP stdio proxy. Stdout is the
/// JSON-RPC channel there, so `fmt::layer()`'s default stdout writer must
/// never be used (the file-disabled branch of [`init_logging`] would corrupt
/// the protocol).
#[must_use]
pub fn init_stderr_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .init();
    None
}

#[allow(clippy::unused_async, clippy::missing_panics_doc)]
pub async fn get_log(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
) -> impl IntoResponse {
    let settings = state.1.read().await;
    if !settings.log.enabled {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from("日志保存未启用"))
            .unwrap();
    }

    let path = if settings.log.path.is_empty() {
        log_file_path()
    } else {
        PathBuf::from(&settings.log.path)
    };

    if !path.exists() {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from("暂无日志"))
            .unwrap();
    }

    // Read last 1MB of log to avoid overwhelming the browser
    let read_size: usize = 1024 * 1024; // 1MB

    match std::fs::read(&path) {
        Ok(data) => {
            let content = if data.len() > read_size {
                let start = data.len() - read_size;
                String::from_utf8_lossy(&data[start..]).into_owned()
            } else {
                String::from_utf8_lossy(&data).into_owned()
            };
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .body(Body::from(content))
                .unwrap()
        }
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("读取日志失败"))
            .unwrap(),
    }
}

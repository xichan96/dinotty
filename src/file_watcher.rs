#![allow(clippy::unwrap_used, clippy::expect_used)]
use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures_util::StreamExt;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{error, info};

use crate::event_bus::{BusEvent, EventBus};
use crate::session::SessionManager;

#[derive(Debug, Clone, Serialize)]
pub struct FileEvent {
    pub path: String,
    pub kind: FileEventKind,
}

#[derive(Debug, Clone, Serialize, Copy)]
#[serde(rename_all = "lowercase")]
pub enum FileEventKind {
    Changed,
    Created,
    Deleted,
}

impl FileEventKind {
    /// Lowercase tag matching the serde serialization. Used when bridging to
    /// `BusEvent::FileChanged.change_type` without round-tripping through serde.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Changed => "changed",
            Self::Created => "created",
            Self::Deleted => "deleted",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum WatchMessage {
    #[serde(rename = "file_event")]
    FileEvent(FileEvent),
    #[serde(rename = "error")]
    Error { message: String },
}

pub struct FileWatcherState {
    watchers: Arc<RwLock<HashMap<String, broadcast::Sender<WatchMessage>>>>,
    event_bus: EventBus,
}

impl FileWatcherState {
    #[must_use]
    pub fn new(event_bus: EventBus) -> Self {
        Self { watchers: Arc::new(RwLock::new(HashMap::new())), event_bus }
    }

    pub async fn subscribe(&self, key: &str) -> broadcast::Receiver<WatchMessage> {
        let mut watchers = self.watchers.write().await;
        if let Some(tx) = watchers.get(key) {
            return tx.subscribe();
        }

        let (tx, rx) = broadcast::channel(100);
        watchers.insert(key.to_string(), tx.clone());

        let key_owned = key.to_string();
        let watchers_clone = self.watchers.clone();
        let event_bus = self.event_bus.clone();

        tokio::spawn(async move {
            if let Err(e) = Self::run_watcher(key_owned, tx, watchers_clone, event_bus).await {
                error!("File watcher error: {}", e);
            }
        });

        rx
    }

    pub async fn unsubscribe(&self, key: &str) {
        let removed = self.watchers.write().await.remove(key).is_some();
        if removed {
            info!("Watcher removed: {}", key);
        }
    }

    async fn run_watcher(
        key: String,
        tx: broadcast::Sender<WatchMessage>,
        watchers: Arc<RwLock<HashMap<String, broadcast::Sender<WatchMessage>>>>,
        event_bus: EventBus,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let (tx_notify, mut rx_notify) = mpsc::unbounded_channel();

        let mut watcher = RecommendedWatcher::new(
            move |res| {
                let _ = tx_notify.send(res);
            },
            Config::default().with_poll_interval(Duration::from_secs(1)),
        )?;

        let watch_path = PathBuf::from(&key);
        if watch_path.exists() {
            watcher.watch(&watch_path, RecursiveMode::Recursive)?;
            info!("Watching path: {}", key);
        }

        while let Some(event_result) = rx_notify.recv().await {
            if watchers.read().await.get(&key).is_none() {
                break;
            }
            match event_result {
                Ok(event) => {
                    let kind = match event.kind {
                        EventKind::Create(_) => Some(FileEventKind::Created),
                        EventKind::Modify(_) => Some(FileEventKind::Changed),
                        EventKind::Remove(_) => Some(FileEventKind::Deleted),
                        _ => None,
                    };
                    let events: Vec<WatchMessage> = match kind {
                        Some(k) => event
                            .paths
                            .into_iter()
                            .map(|p| {
                                WatchMessage::FileEvent(FileEvent {
                                    path: p.to_string_lossy().to_string(),
                                    kind: k,
                                })
                            })
                            .collect(),
                        None => vec![],
                    };

                    for msg in events {
                        if let WatchMessage::FileEvent(ref fe) = msg {
                            event_bus.publish(BusEvent::FileChanged {
                                path: fe.path.clone(),
                                change_type: fe.kind.as_str().into(),
                            });
                        }
                        if tx.send(msg).is_err() {
                            return Ok(());
                        }
                    }
                }
                Err(e) => {
                    error!("Watch error: {}", e);
                    let _ = tx.send(WatchMessage::Error { message: e.to_string() });
                }
            }
        }

        watchers.write().await.remove(&key);
        info!("Watcher stopped: {}", key);
        Ok(())
    }
}

#[derive(Deserialize)]
pub struct WatchQuery {
    pub pane_id: String,
    pub path: String,
}

#[allow(clippy::unused_async)]
pub async fn watch_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WatchQuery>,
    State((manager, watcher_state)): State<(Arc<SessionManager>, Arc<FileWatcherState>)>,
    State(settings): State<crate::settings::SettingsState>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let s = settings.read().await;
    let allowed_origins = s.auth.allowed_origins.clone();
    let trusted_proxies = s.auth.trusted_proxies.clone();
    drop(s);
    let real_ip = crate::auth::real_client_ip(&headers, addr.ip(), &trusted_proxies);
    if !crate::auth::check_ws_origin(&headers, &allowed_origins, real_ip, &trusted_proxies) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| {
        handle_watch_socket(socket, q.pane_id, q.path, manager, watcher_state)
    })
    .into_response()
}

async fn handle_watch_socket(
    mut socket: WebSocket,
    pane_id: String,
    path: String,
    manager: Arc<SessionManager>,
    watcher_state: Arc<FileWatcherState>,
) {
    let session = if let Some(s) = manager.sessions.get(&pane_id) {
        s.clone()
    } else {
        let _ = socket
            .send(Message::Text(
                serde_json::to_string(&WatchMessage::Error { message: "unknown pane".to_string() })
                    .unwrap(),
            ))
            .await;
        return;
    };

    let Some(cwd) = session.cwd_for_workspace() else {
        let _ = socket
            .send(Message::Text(
                serde_json::to_string(&WatchMessage::Error {
                    message: "cwd_unavailable_for_backend".to_string(),
                })
                .unwrap(),
            ))
            .await;
        return;
    };
    let root = cwd.canonicalize().unwrap_or(cwd);

    let watch_path = if Path::new(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        let rel = path.trim().trim_start_matches('/');
        let mut out = root.clone();
        for seg in rel.split('/').filter(|s| !s.is_empty() && *s != ".") {
            out.push(seg);
        }
        out
    };

    if !watch_path.exists() {
        let _ = socket
            .send(Message::Text(
                serde_json::to_string(&WatchMessage::Error {
                    message: "path not found".to_string(),
                })
                .unwrap(),
            ))
            .await;
        return;
    }

    let watch_key = watch_path.to_string_lossy().to_string();
    let mut rx = watcher_state.subscribe(&watch_key).await;

    info!("WebSocket watch connected: pane={}, path={}", pane_id, path);

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(event) => {
                        if let Ok(json) = serde_json::to_string(&event) {
                            if socket.send(Message::Text(json)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {},
                    Err(_) => break,
                }
            }
            result = socket.next() => {
                match result {
                    Some(Ok(msg)) => {
                        if let Message::Close(_) = msg {
                            break;
                        }
                    }
                    Some(Err(_)) | None => break,
                }
            }
        }
    }

    watcher_state.unsubscribe(&watch_key).await;
    info!("WebSocket watch disconnected: pane={}, path={}", pane_id, path);
}

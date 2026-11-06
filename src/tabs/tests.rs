use super::types::{validate_create_tab_request, CreateTabRequest};

fn request(argv: Vec<&str>) -> CreateTabRequest {
    CreateTabRequest {
        cwd: None,
        source_pane_id: None,
        argv: Some(argv.into_iter().map(str::to_string).collect()),
        title: None,
    }
}

#[test]
fn create_tab_argv_requires_non_empty_program() {
    assert!(validate_create_tab_request(&request(vec![])).is_err());
    assert!(validate_create_tab_request(&request(vec![""])).is_err());
    assert!(validate_create_tab_request(&request(vec!["claude", ""])).is_ok());
    assert!(validate_create_tab_request(&request(vec!["claude", "--resume"])).is_ok());
}

#[test]
fn create_tab_argv_rejects_nul_bytes() {
    assert!(validate_create_tab_request(&request(vec!["claude\0", "--resume"])).is_err());
    assert!(validate_create_tab_request(&request(vec!["claude", "--resume\0"])).is_err());
}

// ---------------------------------------------------------------------------
// POST /api/tabs/extract
// ---------------------------------------------------------------------------

mod extract_pane_route {
    use std::sync::Arc;

    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::post,
        Router,
    };
    use tower::ServiceExt;

    use crate::session::SessionManager;

    fn source_manager() -> Arc<SessionManager> {
        let manager = Arc::new(SessionManager::new());
        manager.insert_tab(
            "src".to_string(),
            serde_json::json!({
                "layout": {
                    "type": "split",
                    "id": "split-1",
                    "direction": "horizontal",
                    "children": [
                        {"type": "leaf", "paneId": "p1", "title": "Terminal", "ratio": 1, "zoomed": false},
                        {"type": "leaf", "paneId": "p2", "title": "Terminal", "ratio": 1, "zoomed": false},
                    ],
                    "ratios": [0.5, 0.5],
                },
                "active_pane_id": "p1",
            }),
        );
        manager
    }

    async fn extract(
        manager: Arc<SessionManager>,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let app = Router::new()
            .route("/api/tabs/extract", post(crate::tabs::extract_pane))
            .with_state(manager);
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tabs/extract")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
    }

    #[tokio::test]
    async fn transfers_the_source_tabs_explicit_workspace_to_the_new_tab() {
        let manager = source_manager();
        manager.set_tab_workspace("src", Some("workspace-a".into()));

        let (status, body) = extract(
            Arc::clone(&manager),
            serde_json::json!({"source_tab_id": "src", "pane_id": "p2"}),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let new_tab_id = body["new_tab_id"].as_str().expect("new tab id");
        assert_eq!(body["workspace_id"], "workspace-a");
        assert_eq!(manager.explicit_tab_workspace(new_tab_id).as_deref(), Some("workspace-a"));
        // The source tab keeps its assignment.
        assert_eq!(manager.explicit_tab_workspace("src").as_deref(), Some("workspace-a"));
    }

    #[tokio::test]
    async fn extracted_tab_has_no_workspace_when_the_source_has_none() {
        let manager = source_manager();

        let (status, body) = extract(
            Arc::clone(&manager),
            serde_json::json!({"source_tab_id": "src", "pane_id": "p2"}),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert!(body["workspace_id"].is_null());
        let new_tab_id = body["new_tab_id"].as_str().expect("new tab id");
        assert_eq!(manager.explicit_tab_workspace(new_tab_id), None);
    }
}

// ---------------------------------------------------------------------------
// PUT /api/tabs/:tab_id/workspace
// ---------------------------------------------------------------------------

mod tab_workspace_route {
    use std::sync::Arc;

    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::put,
        Router,
    };
    use tower::ServiceExt;

    use crate::session::SessionManager;
    use crate::workspace_mgmt::{Workspace, WorkspacesState};

    fn workspace(id: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            name: id.to_string(),
            path: format!("/tmp/{id}"),
            order: 0,
            connection_id: None,
            abbr: None,
            color: None,
        }
    }

    fn manager_with_tab(tab_id: &str) -> Arc<SessionManager> {
        let manager = Arc::new(SessionManager::new());
        manager.insert_tab(
            tab_id.to_string(),
            serde_json::json!({
                "layout": {"type": "leaf", "kind": "plugin", "paneId": "p1"},
                "active_pane_id": "p1",
            }),
        );
        manager
    }

    fn app(manager: Arc<SessionManager>) -> Router {
        let workspaces: WorkspacesState =
            Arc::new(tokio::sync::RwLock::new(vec![workspace("ws-a")]));
        Router::new()
            .route("/api/tabs/:tab_id/workspace", put(crate::tabs::set_tab_workspace))
            .with_state((workspaces, manager))
    }

    async fn put_workspace(
        manager: Arc<SessionManager>,
        tab_id: &str,
        body: &str,
    ) -> (StatusCode, serde_json::Value) {
        let response = app(manager)
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/tabs/{tab_id}/workspace"))
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, value)
    }

    #[tokio::test]
    async fn assigns_and_clears_a_known_workspace() {
        let manager = manager_with_tab("tab-1");

        let (status, body) =
            put_workspace(manager.clone(), "tab-1", r#"{"workspace_id":"ws-a"}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!({ "ok": true }));
        assert_eq!(manager.explicit_tab_workspace("tab-1").as_deref(), Some("ws-a"));

        let (status, _) = put_workspace(manager.clone(), "tab-1", r#"{"workspace_id":null}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(manager.explicit_tab_workspace("tab-1"), None);
    }

    #[tokio::test]
    async fn default_workspace_sentinel_pins_the_default_workspace() {
        let manager = manager_with_tab("tab-1");
        let (status, _) =
            put_workspace(manager.clone(), "tab-1", r#"{"workspace_id":"ws-a"}"#).await;
        assert_eq!(status, StatusCode::OK);

        let (status, body) =
            put_workspace(manager.clone(), "tab-1", r#"{"workspace_id":"__default__"}"#).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!({ "ok": true }));
        assert_eq!(manager.explicit_tab_workspace("tab-1").as_deref(), Some("__default__"));
    }

    #[tokio::test]
    async fn missing_tab_is_404() {
        let manager = Arc::new(SessionManager::new());
        let (status, body) = put_workspace(manager, "missing", r#"{"workspace_id":"ws-a"}"#).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "tab not found");
    }

    #[tokio::test]
    async fn unknown_or_empty_workspace_is_400() {
        let manager = manager_with_tab("tab-1");

        let (status, _) =
            put_workspace(manager.clone(), "tab-1", r#"{"workspace_id":"nope"}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(manager.explicit_tab_workspace("tab-1"), None);

        let (status, _) = put_workspace(manager.clone(), "tab-1", r#"{"workspace_id":""}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        let (status, _) =
            put_workspace(manager.clone(), "tab-1", r#"{"workspace_id":"   "}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
}

// ---------------------------------------------------------------------------
// PUT /api/tabs/:tab_id/layout
// ---------------------------------------------------------------------------

mod update_layout_route {
    use std::sync::Arc;

    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::put,
        Router,
    };
    use tower::ServiceExt;

    use crate::session::SessionManager;

    fn manager_with_tab() -> Arc<SessionManager> {
        let manager = Arc::new(SessionManager::new());
        manager.insert_tab(
            "tab-1".to_string(),
            serde_json::json!({
                "layout": {"type": "leaf", "paneId": "pane-a"},
                "active_pane_id": "pane-a",
            }),
        );
        manager.set_active_pane_id(Some("pane-a".to_string()));
        manager
    }

    fn app(manager: Arc<SessionManager>) -> Router {
        Router::new()
            .route("/api/tabs/:tab_id/layout", put(crate::tabs::update_layout))
            .with_state(manager)
    }

    async fn put_layout(manager: Arc<SessionManager>, body: &str) -> StatusCode {
        app(manager)
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/tabs/tab-1/layout")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
    }

    fn global_active(manager: &SessionManager) -> Option<String> {
        manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    #[tokio::test]
    async fn activate_false_updates_layout_without_moving_global_active_pane() {
        let manager = manager_with_tab();

        let status = put_layout(
            manager.clone(),
            r#"{"layout":{"type":"leaf","paneId":"pane-b"},"active_pane_id":"pane-b","activate":false}"#,
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(global_active(&manager).as_deref(), Some("pane-a"));
        assert_eq!(manager.tab_layouts.get("tab-1").expect("layout")["layout"]["paneId"], "pane-b");
    }

    #[tokio::test]
    async fn missing_activate_keeps_the_activating_default() {
        let manager = manager_with_tab();

        let status = put_layout(
            manager.clone(),
            r#"{"layout":{"type":"leaf","paneId":"pane-b"},"active_pane_id":"pane-b"}"#,
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(global_active(&manager).as_deref(), Some("pane-b"));
    }
}

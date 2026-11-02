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
    }
}

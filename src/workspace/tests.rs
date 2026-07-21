use super::*;
use axum::{
    body::{to_bytes, Body},
    extract::{FromRequest, State},
    http::{Request, StatusCode},
    routing::{get, post},
    Router,
};
use std::{ffi::OsString, fs, path::Path};
use tempfile::TempDir;
use tokio::sync::RwLock;

#[test]
fn normalize_join_rejects_parent_dir() {
    let tmp = TempDir::new().unwrap();
    let result = normalize_join(tmp.path(), "../etc/passwd");
    assert!(result.is_err());
}

#[test]
fn normalize_join_rejects_nested_parent_dir() {
    let tmp = TempDir::new().unwrap();
    let result = normalize_join(tmp.path(), "foo/../../etc");
    assert!(result.is_err());
}

#[test]
fn normalize_join_accepts_normal_subdir() {
    let tmp = TempDir::new().unwrap();
    let result = normalize_join(tmp.path(), "subdir/file.txt").unwrap();
    assert_eq!(result, tmp.path().join("subdir").join("file.txt"));
}

#[test]
fn normalize_join_handles_dot_and_empty() {
    let tmp = TempDir::new().unwrap();
    assert_eq!(normalize_join(tmp.path(), ".").unwrap(), tmp.path().to_path_buf());
    assert_eq!(normalize_join(tmp.path(), "").unwrap(), tmp.path().to_path_buf());
}

#[test]
fn normalize_join_strips_leading_slash() {
    let tmp = TempDir::new().unwrap();
    let result = normalize_join(tmp.path(), "/foo/bar").unwrap();
    assert_eq!(result, tmp.path().join("foo").join("bar"));
}

struct EnvVarGuard {
    name: &'static str,
    previous: Option<OsString>,
}

impl EnvVarGuard {
    fn set(name: &'static str, value: &Path) -> Self {
        let previous = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(previous) = &self.previous {
            std::env::set_var(self.name, previous);
        } else {
            std::env::remove_var(self.name);
        }
    }
}

#[test]
fn resolve_user_path_expands_temp_tokens() {
    let tmp = TempDir::new().unwrap();

    #[cfg(windows)]
    {
        let _temp_guard = EnvVarGuard::set("TEMP", tmp.path());
        let _tmp_guard = EnvVarGuard::set("TMP", tmp.path());

        assert_eq!(resolve_user_path(None, "%TEMP%"), tmp.path());
        assert_eq!(resolve_user_path(None, "%temp%\\dinotty"), tmp.path().join("dinotty"));
        assert_eq!(resolve_user_path(None, "%TMP%/dinotty"), tmp.path().join("dinotty"));
        assert_eq!(resolve_user_path(None, "x%TEMP%\\dinotty"), PathBuf::from("x%TEMP%\\dinotty"));
    }

    #[cfg(not(windows))]
    {
        let _guard = EnvVarGuard::set("TMPDIR", tmp.path());

        assert_eq!(resolve_user_path(None, "$TMPDIR"), tmp.path());
        assert_eq!(resolve_user_path(None, "$TMPDIR/dinotty"), tmp.path().join("dinotty"));
        assert_eq!(resolve_user_path(None, "${TMPDIR}/dinotty"), tmp.path().join("dinotty"));
        assert_eq!(resolve_user_path(None, "$TMPDIR//dinotty"), tmp.path().join("dinotty"));
        assert_eq!(
            resolve_user_path(None, "$TMPDIRish/dinotty"),
            PathBuf::from("$TMPDIRish/dinotty")
        );
        assert_eq!(resolve_user_path(None, "x$TMPDIR/dinotty"), PathBuf::from("x$TMPDIR/dinotty"));
    }
}

#[test]
fn path_must_be_under_accepts_child() {
    let tmp = TempDir::new().unwrap();
    let child = tmp.path().join("sub");
    fs::create_dir(&child).unwrap();
    assert!(path_must_be_under(tmp.path(), &child).is_ok());
}

#[test]
fn path_must_be_under_rejects_outside() {
    let tmp1 = TempDir::new().unwrap();
    let tmp2 = TempDir::new().unwrap();
    assert!(path_must_be_under(tmp1.path(), tmp2.path()).is_err());
}

#[test]
fn suffixed_upload_name_preserves_tar_gz() {
    assert_eq!(suffixed_upload_name("archive.tar.gz", 1), "archive (1).tar.gz");
}

#[test]
fn suffixed_upload_name_preserves_tar_bz2() {
    assert_eq!(suffixed_upload_name("archive.tar.bz2", 2), "archive (2).tar.bz2");
}

#[test]
fn suffixed_upload_name_handles_single_extension() {
    assert_eq!(suffixed_upload_name("note.txt", 1), "note (1).txt");
}

#[test]
fn suffixed_upload_name_handles_no_extension() {
    assert_eq!(suffixed_upload_name("README", 1), "README (1)");
}

#[test]
fn suffixed_upload_name_keeps_only_allowed_compounds() {
    assert_eq!(suffixed_upload_name("a.b.pdf", 1), "a.b (1).pdf");
}

#[test]
fn suffixed_upload_name_dotfile_compound_falls_back_without_empty_stem() {
    let suffixed = suffixed_upload_name(".tar.gz", 1);
    assert_eq!(suffixed, ".tar (1).gz");
    assert!(!suffixed.starts_with(" (1)"));
}

fn upload_state(settings: Settings) -> (Arc<SessionManager>, SettingsState) {
    (Arc::new(SessionManager::new()), Arc::new(RwLock::new(settings)))
}

fn upload_router(settings: Settings) -> Router {
    Router::new()
        .route("/api/uploads", post(workspace_uploads).get(uploads_status))
        .route("/api/uploads/default-dir", get(uploads_default_dir))
        .with_state(upload_state(settings))
}

fn upload_settings(upload_dir: String, upload_file_cap_mb: u64) -> Settings {
    Settings { upload_dir, upload_file_cap_mb, ..Settings::default() }
}

fn multipart_request(parts: Vec<(&str, Vec<u8>)>) -> Request<Body> {
    let boundary = "dinotty-test-boundary";
    let mut body = Vec::new();
    for (filename, data) in parts {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"files\"; filename=\"{filename}\"\r\n\
                 Content-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(&data);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    Request::builder()
        .method("POST")
        .uri("/api/uploads")
        .header("content-type", format!("multipart/form-data; boundary={boundary}"))
        .body(Body::from(body))
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn upload_request(
    state: (Arc<SessionManager>, SettingsState),
    request: Request<Body>,
) -> axum::response::Response {
    let multipart = Multipart::from_request(request, &()).await.unwrap();
    workspace_uploads(State(state), multipart).await
}

#[tokio::test]
async fn workspace_uploads_rejects_over_file_cap_without_orphan() {
    let tmp = TempDir::new().unwrap();
    let state = upload_state(upload_settings(tmp.path().to_string_lossy().to_string(), 1));
    let oversized = vec![b'x'; 1024 * 1024 + 1];

    let response = upload_request(state, multipart_request(vec![("too-big.bin", oversized)])).await;

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert!(!tmp.path().join("too-big.bin").exists());
}

#[tokio::test]
async fn workspace_uploads_default_file_cap_zero_admits_large_file() {
    let tmp = TempDir::new().unwrap();
    let state = upload_state(upload_settings(tmp.path().to_string_lossy().to_string(), 0));
    let large = vec![b'x'; 1024 * 1024 + 1];

    let response = upload_request(state, multipart_request(vec![("large.bin", large)])).await;

    assert_eq!(response.status(), StatusCode::OK);
    let json = response_json(response).await;
    assert_eq!(json["ok"], true);
    assert!(tmp.path().join("large.bin").exists());
}

#[tokio::test]
async fn workspace_uploads_rolls_back_first_file_when_second_exceeds_cap() {
    let tmp = TempDir::new().unwrap();
    let state = upload_state(upload_settings(tmp.path().to_string_lossy().to_string(), 1));
    let oversized = vec![b'x'; 1024 * 1024 + 1];

    let response = upload_request(
        state,
        multipart_request(vec![("first.txt", b"ok".to_vec()), ("second.bin", oversized)]),
    )
    .await;

    assert!(!response.status().is_success());
    assert!(!tmp.path().join("first.txt").exists());
    assert!(!tmp.path().join("second.bin").exists());
}

#[tokio::test]
async fn uploads_status_returns_status_struct() {
    let tmp = TempDir::new().unwrap();
    let app = upload_router(upload_settings(tmp.path().to_string_lossy().to_string(), 0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let response = reqwest::get(format!("http://{addr}/api/uploads")).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json: serde_json::Value = response.json().await.unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["managed"], true);
    assert_eq!(json["foreign"], false);
    assert_eq!(json["empty"], true);
    assert!(json.get("saved").is_none());
    assert!(json.get("deleted").is_none());

    server.abort();
}

#[tokio::test]
async fn uploads_default_dir_returns_backend_default() {
    let tmp = TempDir::new().unwrap();
    let app = upload_router(upload_settings(tmp.path().to_string_lossy().to_string(), 0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let response = reqwest::get(format!("http://{addr}/api/uploads/default-dir")).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json: serde_json::Value = response.json().await.unwrap();
    assert_eq!(json["default_dir"], default_upload_dir());

    server.abort();
}

#[tokio::test]
async fn prepare_upload_base_maps_unavailable_dir_to_400() {
    let tmp = TempDir::new().unwrap();
    let file = tmp.path().join("not-a-dir");
    fs::write(&file, b"x").unwrap();
    let settings = upload_settings(file.join("child").to_string_lossy().to_string(), 0);

    let Err(response) = prepare_upload_base(&settings) else {
        panic!("prepare_upload_base unexpectedly succeeded");
    };

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let json = response_json(response).await;
    assert_eq!(json["error"], "upload dir is invalid or unavailable");
}

#[tokio::test]
async fn upload_io_err_maps_disk_full_to_507() {
    for code in [28, 39, 112] {
        let error = std::io::Error::from_raw_os_error(code);
        let response = upload_io_err(&error);

        assert_eq!(response.status(), StatusCode::INSUFFICIENT_STORAGE);
        let json = response_json(response).await;
        assert_eq!(json["error"], INSUFFICIENT_STORAGE);
    }
}

#[tokio::test]
async fn upload_io_err_keeps_non_disk_full_as_500() {
    let error = std::io::Error::from_raw_os_error(13);
    let response = upload_io_err(&error);

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let json = response_json(response).await;
    assert!(json["error"].as_str().is_some_and(|message| !message.is_empty()));
}

#[cfg(unix)]
#[tokio::test]
async fn free_browse_rejects_sensitive_dir() {
    // Regression: browsing a directly-named system dir must be rejected even on
    // macOS, where canonicalize rewrites /etc -> /private/etc; the raw
    // pre-canonicalize sensitivity check is the reliable catch.
    let manager = Arc::new(SessionManager::new());
    let q =
        WorkspaceListQuery { pane_id: String::new(), path: "/etc".into(), root: None, free: true };
    let resp = workspace_list(State(manager), axum::extract::Query(q)).await;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn free_browse_allows_normal_dir() {
    let tmp = TempDir::new().unwrap();
    let manager = Arc::new(SessionManager::new());
    let q = WorkspaceListQuery {
        pane_id: String::new(),
        path: tmp.path().to_string_lossy().into_owned(),
        root: None,
        free: true,
    };
    let resp = workspace_list(State(manager), axum::extract::Query(q)).await;
    assert_eq!(resp.status(), StatusCode::OK);
}

#[test]
fn byte_offset_to_column_ascii() {
    let line = b"fn main() {}";
    assert_eq!(byte_offset_to_column(line, 0), 1);
    assert_eq!(byte_offset_to_column(line, 3), 4);
    assert_eq!(byte_offset_to_column(line, 6), 7);
}

#[test]
fn byte_offset_to_column_multibyte_bmp() {
    // "中fn" - "中" is 3 UTF-8 bytes, 1 UTF-16 unit (BMP).
    let line = "中fn".as_bytes();
    assert_eq!(byte_offset_to_column(line, 0), 1);
    assert_eq!(byte_offset_to_column(line, 3), 2);
}

#[test]
fn byte_offset_to_column_offset_clamped() {
    let line = b"abc";
    assert_eq!(byte_offset_to_column(line, 99), 4);
}

#[test]
fn parse_rg_json_extracts_match_fields() {
    let stdout = r#"{"type":"begin","data":{"path":{"text":"src/main.rs"}}}
{"type":"match","data":{"path":{"text":"src/main.rs"},"lines":{"text":"fn main() {}\n"},"line_number":1,"absolute_offset":0,"submatches":[{"match":{"text":"fn"},"start":0,"end":2}]}}
{"type":"end","data":{"path":{"text":"src/main.rs"}}}
"#;

    let matches = parse_rg_json(stdout, 100);
    assert_eq!(matches.len(), 1);
    let m = &matches[0];
    assert_eq!(m.file_path, "src/main.rs");
    assert_eq!(m.line, 1);
    assert_eq!(m.column, 1);
    assert_eq!(m.line_text, "fn main() {}");
}

#[test]
fn parse_rg_json_strips_dot_slash_prefix() {
    let stdout = r#"{"type":"match","data":{"path":{"text":"./src/lib.rs"},"lines":{"text":"pub fn x()\n"},"line_number":5,"absolute_offset":42,"submatches":[{"match":{"text":"fn"},"start":4,"end":6}]}}
"#;
    let matches = parse_rg_json(stdout, 100);
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].file_path, "src/lib.rs");
    assert_eq!(matches[0].line, 5);
    assert_eq!(matches[0].column, 5);
}

#[test]
fn parse_rg_json_skips_non_match_types() {
    let stdout = r#"{"type":"begin","data":{"path":{"text":"a.rs"}}}
{"type":"match","data":{"path":{"text":"a.rs"},"lines":{"text":"x\n"},"line_number":1,"absolute_offset":0,"submatches":[{"match":{"text":"x"},"start":0,"end":1}]}}
{"type":"end","data":{"path":{"text":"a.rs"}}}
{"type":"summary","data":{"elapsed_total":{"secs":0,"nanos":1},"stats":{}}}
"#;
    let matches = parse_rg_json(stdout, 100);
    assert_eq!(matches.len(), 1);
}

#[test]
fn parse_rg_json_respects_max() {
    let mut stdout = String::new();
    for i in 0..10 {
        stdout.push_str(&format!(
            r#"{{"type":"match","data":{{"path":{{"text":"f{i}.rs"}},"lines":{{"text":"x\n"}},"line_number":1,"absolute_offset":0,"submatches":[{{"match":{{"text":"x"}},"start":0,"end":1}}]}}}}
"#
        ));
    }
    let matches = parse_rg_json(&stdout, 3);
    assert_eq!(matches.len(), 3);
}

#[test]
fn parse_rg_json_handles_multibyte_line() {
    // "中fn" - "中" at col 1, "fn" starts at byte offset 3 = col 2.
    let stdout = r#"{"type":"match","data":{"path":{"text":"a.rs"},"lines":{"text":"中fn\n"},"line_number":1,"absolute_offset":0,"submatches":[{"match":{"text":"fn"},"start":3,"end":5}]}}
"#;
    let matches = parse_rg_json(stdout, 100);
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].column, 2);
}

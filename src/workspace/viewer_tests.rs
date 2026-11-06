//! Workspace jail and delivery tests for the standalone file viewer.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::*;
use crate::session::test_support::{stub_session_with_cwd, stub_ssh_session};
use crate::session::{SessionManager, SyncClientRole};
use crate::token::TokenInfo;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tempfile::TempDir;

fn manager_with_root(root: &Path) -> SessionManager {
    let manager = SessionManager::new();
    manager.insert_session("pane-1", stub_session_with_cwd(root.to_path_buf()));
    manager
}

fn write(root: &Path, rel: &str, content: &str) {
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, content).unwrap();
}

#[test]
fn resolves_relative_paths() {
    let root = TempDir::new().unwrap();
    write(root.path(), "docs/design.md", "# hi");
    let manager = manager_with_root(root.path());

    let target = resolve_viewer_target(&manager, "pane-1", "docs/design.md").unwrap();
    assert_eq!(target.pane_id, "pane-1");
    assert_eq!(target.rel_path, "docs/design.md");
    assert_eq!(target.title, "design.md");
    assert_eq!(target.canonical_path, root.path().join("docs/design.md").canonicalize().unwrap());
}

#[test]
fn resolves_absolute_paths_inside_the_workspace() {
    let root = TempDir::new().unwrap();
    write(root.path(), "docs/design.md", "# hi");
    let manager = manager_with_root(root.path());

    let absolute = root.path().join("docs/design.md");
    let target = resolve_viewer_target(&manager, "pane-1", &absolute.to_string_lossy()).unwrap();
    assert_eq!(target.rel_path, "docs/design.md");
}

#[test]
fn preserves_unicode_and_spaces() {
    let root = TempDir::new().unwrap();
    write(root.path(), "文档/设计 说明.md", "# 你好");
    let manager = manager_with_root(root.path());

    let target = resolve_viewer_target(&manager, "pane-1", "文档/设计 说明.md").unwrap();
    assert_eq!(target.rel_path, "文档/设计 说明.md");
    assert_eq!(target.title, "设计 说明.md");
}

#[test]
fn rejects_parent_dir_traversal() {
    let root = TempDir::new().unwrap();
    let manager = manager_with_root(root.path());

    assert_eq!(
        resolve_viewer_target(&manager, "pane-1", "../secret.txt").unwrap_err(),
        ViewerError::InvalidPath
    );
    assert_eq!(
        resolve_viewer_target(&manager, "pane-1", "docs/../../secret.txt").unwrap_err(),
        ViewerError::InvalidPath
    );
}

#[test]
fn rejects_absolute_paths_outside_the_workspace() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    write(outside.path(), "secret.txt", "no");
    let manager = manager_with_root(root.path());

    let absolute = outside.path().join("secret.txt");
    assert_eq!(
        resolve_viewer_target(&manager, "pane-1", &absolute.to_string_lossy()).unwrap_err(),
        ViewerError::OutsideWorkspace
    );
}

#[cfg(unix)]
#[test]
fn rejects_symlink_escapes() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    write(outside.path(), "secret.txt", "no");
    std::os::unix::fs::symlink(outside.path().join("secret.txt"), root.path().join("link.txt"))
        .unwrap();
    let manager = manager_with_root(root.path());

    assert_eq!(
        resolve_viewer_target(&manager, "pane-1", "link.txt").unwrap_err(),
        ViewerError::OutsideWorkspace
    );
}

#[test]
fn rejects_directories() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir(root.path().join("docs")).unwrap();
    let manager = manager_with_root(root.path());

    assert_eq!(
        resolve_viewer_target(&manager, "pane-1", "docs").unwrap_err(),
        ViewerError::NotAFile
    );
}

#[test]
fn rejects_missing_paths() {
    let root = TempDir::new().unwrap();
    let manager = manager_with_root(root.path());

    assert_eq!(
        resolve_viewer_target(&manager, "pane-1", "nope.md").unwrap_err(),
        ViewerError::PathNotFound
    );
}

#[test]
fn rejects_files_over_the_size_limit() {
    let root = TempDir::new().unwrap();
    let file = std::fs::File::create(root.path().join("big.bin")).unwrap();
    // Sparse file: reports the size without allocating it.
    file.set_len(MAX_DOWNLOAD + 1).unwrap();
    let manager = manager_with_root(root.path());

    assert_eq!(
        resolve_viewer_target(&manager, "pane-1", "big.bin").unwrap_err(),
        ViewerError::FileTooLarge
    );
}

#[test]
fn rejects_unknown_panes() {
    let root = TempDir::new().unwrap();
    let manager = manager_with_root(root.path());

    assert_eq!(
        resolve_viewer_target(&manager, "nope", "docs/design.md").unwrap_err(),
        ViewerError::UnknownPane
    );
}

#[test]
fn rejects_ssh_panes() {
    let manager = SessionManager::new();
    manager.insert_session("ssh", stub_ssh_session());

    assert_eq!(
        resolve_viewer_target(&manager, "ssh", "docs/design.md").unwrap_err(),
        ViewerError::SshUnsupported
    );
}

#[test]
fn presents_to_main_clients_only_and_counts_them() {
    let root = TempDir::new().unwrap();
    write(root.path(), "README.md", "# hi");
    let manager = manager_with_root(root.path());
    let (_, mut main_rx) = manager.add_sync_client();
    let (_, mut detached_rx) = manager.add_sync_client_with_role(SyncClientRole::Detached);

    let target = resolve_viewer_target(&manager, "pane-1", "README.md").unwrap();
    let delivery = present_file_viewer(&manager, &target).unwrap();
    assert_eq!(delivery.delivered_clients, 1);

    let received = main_rx.try_recv().expect("main client receives the request");
    let msg: serde_json::Value = serde_json::from_str(&received).unwrap();
    assert_eq!(msg["type"], "open_file_viewer");
    assert_eq!(msg["request_id"], delivery.request_id);
    assert_eq!(msg["pane_id"], "pane-1");
    assert_eq!(msg["path"], "README.md");
    assert_eq!(msg["title"], "README.md");
    assert!(detached_rx.try_recv().is_err(), "detached windows must not present UI");
}

#[test]
fn refuses_to_present_without_a_main_client() {
    let root = TempDir::new().unwrap();
    write(root.path(), "README.md", "# hi");
    let manager = manager_with_root(root.path());
    let (_, _detached_rx) = manager.add_sync_client_with_role(SyncClientRole::Detached);

    let target = resolve_viewer_target(&manager, "pane-1", "README.md").unwrap();
    assert_eq!(present_file_viewer(&manager, &target).unwrap_err(), ViewerError::NoUiClient);
}

fn agent_token(caps: &[&str], scopes: Option<(&str, Vec<String>)>) -> TokenInfo {
    let mut scope_map: HashMap<String, Vec<String>> = HashMap::new();
    if let Some((cap, entries)) = scopes {
        scope_map.insert(cap.to_string(), entries);
    }
    TokenInfo {
        token_id: "agent".into(),
        is_global: false,
        capabilities: caps.iter().map(|cap| (*cap).to_string()).collect::<HashSet<_>>(),
        scopes: scope_map,
    }
}

#[test]
fn global_token_needs_no_scope_check() {
    let root = TempDir::new().unwrap();
    write(root.path(), "README.md", "# hi");
    let manager = manager_with_root(root.path());
    let target = resolve_viewer_target(&manager, "pane-1", "README.md").unwrap();

    assert!(check_viewer_access(&TokenInfo::global(), &target).is_ok());
}

#[test]
fn agent_token_without_workspace_read_is_denied() {
    let root = TempDir::new().unwrap();
    write(root.path(), "README.md", "# hi");
    let manager = manager_with_root(root.path());
    let target = resolve_viewer_target(&manager, "pane-1", "README.md").unwrap();

    let token = agent_token(&["terminal:read"], None);
    assert_eq!(check_viewer_access(&token, &target).unwrap_err(), ViewerError::ScopeDenied);
}

#[test]
fn agent_token_outside_its_path_scope_is_denied() {
    let root = TempDir::new().unwrap();
    let other = TempDir::new().unwrap();
    write(root.path(), "README.md", "# hi");
    let manager = manager_with_root(root.path());
    let target = resolve_viewer_target(&manager, "pane-1", "README.md").unwrap();

    let token = agent_token(
        &["workspace:read"],
        Some(("workspace:read", vec![other.path().to_string_lossy().into_owned()])),
    );
    assert_eq!(check_viewer_access(&token, &target).unwrap_err(), ViewerError::ScopeDenied);
}

#[test]
fn error_codes_match_the_contract() {
    assert_eq!(ViewerError::UnknownPane.code(), "UNKNOWN_PANE");
    assert_eq!(ViewerError::CwdUnavailable.code(), "CWD_UNAVAILABLE");
    assert_eq!(ViewerError::InvalidPath.code(), "INVALID_PATH");
    assert_eq!(ViewerError::PathNotFound.code(), "PATH_NOT_FOUND");
    assert_eq!(ViewerError::OutsideWorkspace.code(), "OUTSIDE_WORKSPACE");
    assert_eq!(ViewerError::NotAFile.code(), "NOT_A_FILE");
    assert_eq!(ViewerError::FileTooLarge.code(), "FILE_TOO_LARGE");
    assert_eq!(ViewerError::ScopeDenied.code(), "SCOPE_DENIED");
    assert_eq!(ViewerError::SshUnsupported.code(), "SSH_UNSUPPORTED");
    assert_eq!(ViewerError::NoUiClient.code(), "NO_UI_CLIENT");

    assert_eq!(ViewerError::UnknownPane.status(), axum::http::StatusCode::NOT_FOUND);
    assert_eq!(ViewerError::FileTooLarge.status(), axum::http::StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(ViewerError::NoUiClient.status(), axum::http::StatusCode::CONFLICT);
}

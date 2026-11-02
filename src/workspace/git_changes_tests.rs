use super::super::git::git_command;
use super::*;
use std::{fs, path::Path};
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) {
    let out = git_command().args(args).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
}

fn init_repo() -> TempDir {
    let tmp = TempDir::new().unwrap();
    git(tmp.path(), &["init", "-q"]);
    git(tmp.path(), &["config", "user.email", "test@example.com"]);
    git(tmp.path(), &["config", "user.name", "test"]);
    tmp
}

fn write(dir: &Path, rel: &str, content: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

fn commit_all(dir: &Path, message: &str) {
    git(dir, &["add", "."]);
    git(dir, &["commit", "-qm", message]);
}

fn changes(root: &Path) -> WorkspaceChangesResponse {
    collect_changes(root).unwrap()
}

fn entry<'a>(response: &'a WorkspaceChangesResponse, path: &str) -> &'a WorkspaceChangeFile {
    response
        .files
        .iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| panic!("missing {path}; have {:?}", paths(response)))
}

fn paths(response: &WorkspaceChangesResponse) -> Vec<&str> {
    response.files.iter().map(|file| file.path.as_str()).collect()
}

#[test]
fn reports_modified_added_untracked_and_deleted() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "keep.txt", "one\ntwo\n");
    write(root, "gone.txt", "bye\n");
    commit_all(root, "init");

    write(root, "keep.txt", "one\nTWO\n");
    write(root, "new.txt", "n\n");
    git(root, &["add", "new.txt"]);
    write(root, "loose.txt", "l\n");
    fs::remove_file(root.join("gone.txt")).unwrap();

    let response = changes(root);
    assert!(response.is_git_repo);
    assert!(response.head.is_some());
    assert_eq!(entry(&response, "keep.txt").status, "modified");
    assert_eq!(entry(&response, "new.txt").status, "added");
    assert_eq!(entry(&response, "loose.txt").status, "untracked");
    assert_eq!(entry(&response, "gone.txt").status, "deleted");
    assert_eq!(response.summary.files, 4);
    assert!(response.summary.counts_complete);
}

#[test]
fn staged_new_file_gets_counts() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");
    write(root, "added.txt", "one\ntwo\nthree\n");
    git(root, &["add", "added.txt"]);

    let response = changes(root);
    let file = entry(&response, "added.txt");
    assert_eq!(file.status, "added");
    assert_eq!(file.index_status, "A");
    assert_eq!(file.worktree_status, " ");
    assert_eq!(file.additions, Some(3));
    assert_eq!(file.deletions, Some(0));
}

#[test]
fn modified_in_index_and_worktree_keeps_both_columns() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "a.txt", "a\n");
    commit_all(root, "init");
    write(root, "a.txt", "a\nb\n");
    git(root, &["add", "a.txt"]);
    write(root, "a.txt", "a\nb\nc\n");

    let response = changes(root);
    let file = entry(&response, "a.txt");
    assert_eq!(file.index_status, "M");
    assert_eq!(file.worktree_status, "M");
    assert_eq!(file.status, "modified");
    assert_eq!(file.additions, Some(2));
    assert_eq!(file.deletions, Some(0));
}

#[test]
fn rename_reports_destination_and_original_path() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "old.txt", "content long enough for rename detection 0123456789\nsecond line\n");
    commit_all(root, "init");
    git(root, &["mv", "old.txt", "renamed.txt"]);

    let response = changes(root);
    let file = entry(&response, "renamed.txt");
    assert_eq!(file.status, "renamed");
    assert_eq!(file.orig_path.as_deref(), Some("old.txt"));
}

#[test]
fn untracked_directory_expands_to_individual_files() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");
    write(root, "fresh/a.txt", "a\n");
    write(root, "fresh/nested/b.txt", "b\n");

    let response = changes(root);
    let mut found = paths(&response);
    found.sort_unstable();
    assert_eq!(found, vec!["fresh/a.txt", "fresh/nested/b.txt"]);
    assert!(!response.files.iter().any(|file| file.path.ends_with('/')));
}

#[test]
fn unborn_head_counts_staged_files() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "a.txt", "one\ntwo\n");
    git(root, &["add", "a.txt"]);

    let response = changes(root);
    assert!(response.is_git_repo);
    assert!(response.head.is_none());
    let file = entry(&response, "a.txt");
    assert_eq!(file.status, "added");
    assert_eq!(file.additions, Some(2));
    assert_eq!(file.deletions, Some(0));
    assert_eq!(response.summary.additions, 2);
}

#[test]
fn preserves_unicode_paths() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");
    write(root, "中文文件.txt", "u\n");

    let response = changes(root);
    assert_eq!(entry(&response, "中文文件.txt").status, "untracked");
}

// `>` is not a legal filename character on Windows.
#[test]
#[cfg(not(windows))]
fn preserves_paths_containing_arrow() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");
    write(root, "weird -> name.txt", "w\n");

    let response = changes(root);
    assert_eq!(entry(&response, "weird -> name.txt").status, "untracked");
}

#[test]
fn untracked_binary_has_no_counts() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");
    fs::write(root.join("blob.bin"), [0u8, 1, 2, 255]).unwrap();

    let response = changes(root);
    let file = entry(&response, "blob.bin");
    assert_eq!(file.status, "untracked");
    assert!(file.binary);
    assert_eq!(file.additions, None);
    assert_eq!(file.deletions, None);
    assert!(response.summary.counts_complete);
}

#[test]
fn oversized_untracked_file_skips_counts() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");
    let size = usize::try_from(MAX_UNTRACKED_FILE_BYTES).unwrap() + 1;
    fs::write(root.join("big.txt"), vec![b'a'; size]).unwrap();

    let response = changes(root);
    let file = entry(&response, "big.txt");
    assert_eq!(file.additions, None);
    assert_eq!(file.deletions, None);
    assert!(!response.summary.counts_complete);
}

#[test]
fn subdirectory_results_are_relative_and_filtered() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "top.txt", "top\n");
    write(root, "sub/a.txt", "a\n");
    commit_all(root, "init");
    write(root, "top.txt", "top2\n");
    write(root, "sub/a.txt", "a2\n");

    let response = changes(&root.join("sub"));
    assert_eq!(paths(&response), vec!["a.txt"]);
    assert_eq!(entry(&response, "a.txt").status, "modified");
}

#[test]
fn detects_submodules_from_index_mode() {
    let tmp = init_repo();
    let root = tmp.path();
    let nested = root.join("nested");
    fs::create_dir_all(&nested).unwrap();
    git(&nested, &["init", "-q"]);
    git(&nested, &["config", "user.email", "test@example.com"]);
    git(&nested, &["config", "user.name", "test"]);
    fs::write(nested.join("inner.txt"), "inner\n").unwrap();
    git(&nested, &["add", "."]);
    git(&nested, &["commit", "-qm", "inner"]);

    git(root, &["add", "nested"]);
    let response = changes(root);
    let file = entry(&response, "nested");
    assert!(file.submodule);
}

#[test]
fn outside_repository_is_not_a_repo() {
    let tmp = TempDir::new().unwrap();
    let response = changes(tmp.path());
    assert!(!response.is_git_repo);
    assert_eq!(response.files.len(), 0);
    assert_eq!(response.summary.files, 0);
    assert!(response.summary.counts_complete);
}

// ---------------------------------------------------------------------------
// /git-file-diff
// ---------------------------------------------------------------------------

fn diff(
    root: &Path,
    path: &str,
    orig_path: Option<&str>,
) -> Result<WorkspaceGitFileDiffResponse, DiffError> {
    collect_file_diff(root, path, orig_path)
}

#[test]
fn file_diff_for_untracked_file() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");
    write(root, "loose.txt", "hello\nworld\n");

    let file = diff(root, "loose.txt", None).unwrap();
    assert!(file.is_git_repo);
    assert_eq!(file.base, "head");
    assert_eq!(file.original.as_deref(), Some(""));
    assert_eq!(file.modified.as_deref(), Some("hello\nworld\n"));
    assert!(!file.binary);
    assert!(!file.too_large);
}

#[test]
fn file_diff_for_deleted_file() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "gone.txt", "bye\n");
    commit_all(root, "init");
    fs::remove_file(root.join("gone.txt")).unwrap();

    let file = diff(root, "gone.txt", None).unwrap();
    assert_eq!(file.original.as_deref(), Some("bye\n"));
    assert_eq!(file.modified.as_deref(), Some(""));
}

#[test]
fn file_diff_uses_original_path_for_rename() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "old.txt", "old content\n");
    commit_all(root, "init");
    git(root, &["mv", "old.txt", "new.txt"]);
    write(root, "new.txt", "new content\n");

    let file = diff(root, "new.txt", Some("old.txt")).unwrap();
    assert_eq!(file.path, "new.txt");
    assert_eq!(file.orig_path.as_deref(), Some("old.txt"));
    assert_eq!(file.original.as_deref(), Some("old content\n"));
    assert_eq!(file.modified.as_deref(), Some("new content\n"));
}

#[test]
fn file_diff_for_binary_file_nulls_contents() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");
    fs::write(root.join("blob.bin"), [0u8, 1, 2, 255]).unwrap();

    let file = diff(root, "blob.bin", None).unwrap();
    assert!(file.binary);
    assert_eq!(file.original, None);
    assert_eq!(file.modified, None);
}

#[test]
fn file_diff_over_size_cap_nulls_contents() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");
    let size = usize::try_from(MAX_DIFF_BYTES).unwrap() + 1;
    fs::write(root.join("huge.txt"), vec![b'a'; size]).unwrap();

    let file = diff(root, "huge.txt", None).unwrap();
    assert!(file.too_large);
    assert_eq!(file.original, None);
    assert_eq!(file.modified, None);
}

#[test]
fn file_diff_missing_path_is_not_found() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");

    let (status, _) = diff(root, "nope.txt", None).unwrap_err();
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[test]
fn file_diff_rejects_parent_traversal() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "base.txt", "base\n");
    commit_all(root, "init");

    let (status, _) = diff(root, "../outside.txt", None).unwrap_err();
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[test]
fn file_diff_outside_repository_is_not_a_repo() {
    let tmp = TempDir::new().unwrap();
    let file = diff(tmp.path(), "whatever.txt", None).unwrap();
    assert!(!file.is_git_repo);
    assert_eq!(file.original, None);
    assert_eq!(file.modified, None);
}

#[test]
fn file_diff_detects_conflicts() {
    let tmp = init_repo();
    let root = tmp.path();
    write(root, "file.txt", "base\n");
    git(root, &["branch", "-m", "main"]);
    commit_all(root, "base");

    git(root, &["checkout", "-q", "-b", "side"]);
    write(root, "file.txt", "side\n");
    commit_all(root, "side");

    git(root, &["checkout", "-q", "main"]);
    write(root, "file.txt", "main\n");
    commit_all(root, "main");

    let merge = git_command().args(["merge", "side"]).current_dir(root).output().unwrap();
    assert!(!merge.status.success(), "merge should conflict");

    let file = diff(root, "file.txt", None).unwrap();
    assert!(file.conflicted);
    assert_eq!(file.original.as_deref(), Some("main\n"));
    assert!(file.modified.unwrap_or_default().contains("<<<<<<<"));
}

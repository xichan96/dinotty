use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::{platform::process::CommandNoWindowExt, session::SessionManager};

use super::{
    get_root, json_err, normalize_join, path_must_be_under, PanePathQuery, PaneQuery,
    MAX_TEXT_PREVIEW,
};

const MAX_GIT_DIFF_OUTPUT: usize = 2 * 1024 * 1024;

macro_rules! try_res {
    ($e:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => return e,
        }
    };
}

fn git_command() -> std::process::Command {
    let mut command = std::process::Command::new("git");
    command.no_window();
    command
}

#[derive(Clone, Debug, Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub conflict: bool,
}

#[derive(Serialize)]
pub struct GitStatusResponse {
    pub is_git_repo: bool,
    pub branch: Option<String>,
    pub files: Vec<GitFileStatus>,
}

struct ParsedGitStatus {
    branch: Option<String>,
    files: Vec<GitFileStatus>,
}

fn parse_branch_line(line: &str) -> Option<String> {
    // 步骤1：去掉 porcelain 分支标记并识别 detached HEAD。
    let branch_text = line.strip_prefix("## ")?.trim();
    if branch_text.starts_with("HEAD ") || branch_text == "HEAD" {
        return None;
    }
    if let Some(initial_branch) = branch_text.strip_prefix("No commits yet on ") {
        return Some(initial_branch.to_string());
    }

    // 步骤2：去掉上游分支和 ahead/behind 信息，只保留当前分支名称。
    let branch_without_upstream = branch_text.split("...").next().unwrap_or(branch_text);
    let branch = branch_without_upstream.split(" [").next().unwrap_or(branch_without_upstream);
    if branch.is_empty() {
        None
    } else {
        Some(branch.to_string())
    }
}

fn status_name(index_status: char, worktree_status: char, conflict: bool) -> &'static str {
    // 步骤1：冲突和未跟踪状态优先于普通修改状态。
    if conflict {
        return "conflict";
    }
    if index_status == '?' && worktree_status == '?' {
        return "untracked";
    }

    // 步骤2：优先展示工作区状态，没有工作区修改时再展示暂存区状态。
    if worktree_status == 'D' {
        return "deleted";
    }
    if worktree_status != ' ' {
        return "modified";
    }
    match index_status {
        'A' => "staged_new",
        'D' => "staged_deleted",
        'R' | 'C' => "renamed",
        'M' | 'T' => "staged_modified",
        _ => "modified",
    }
}

fn parse_status_output(output: &str) -> ParsedGitStatus {
    // 步骤1：逐行读取分支和文件状态，避免按空格拆分带空格的文件名。
    let mut branch = None;
    let mut files = Vec::new();
    for line in output.lines() {
        if line.starts_with("## ") {
            branch = parse_branch_line(line);
            continue;
        }
        if line.len() < 4 {
            continue;
        }
        let mut status_characters = line.chars();
        let index_status = status_characters.next().unwrap_or(' ');
        let worktree_status = status_characters.next().unwrap_or(' ');
        let Some(raw_path) = line.get(3..) else { continue };
        let path_without_quotes = raw_path.trim_matches('"');
        let path =
            path_without_quotes.split(" -> ").last().unwrap_or(path_without_quotes).to_string();

        // 步骤2：分别保留暂存区与工作区状态，支持同一文件同时出现在两个分组。
        let conflict = index_status == 'U'
            || worktree_status == 'U'
            || (index_status == 'A' && worktree_status == 'A')
            || (index_status == 'D' && worktree_status == 'D');
        let staged = index_status != ' ' && index_status != '?';
        let unstaged = worktree_status != ' ' || (index_status == '?' && worktree_status == '?');
        let status = status_name(index_status, worktree_status, conflict).to_string();
        files.push(GitFileStatus {
            path,
            status,
            index_status: index_status.to_string(),
            worktree_status: worktree_status.to_string(),
            staged,
            unstaged,
            conflict,
        });
    }
    ParsedGitStatus { branch, files }
}

pub async fn workspace_git_status(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PaneQuery>,
) -> impl IntoResponse {
    let root = try_res!(get_root(&manager, &q.pane_id));
    let output = match tokio::task::spawn_blocking(move || {
        git_command()
            .args([
                "-c",
                "core.quotepath=false",
                "status",
                "--porcelain=v1",
                "--branch",
                "--untracked-files=all",
            ])
            .current_dir(&root)
            .output()
    })
    .await
    {
        Ok(Ok(o)) if o.status.success() => o,
        _ => {
            return Json(GitStatusResponse { is_git_repo: false, branch: None, files: vec![] })
                .into_response()
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed = parse_status_output(&stdout);
    Json(GitStatusResponse { is_git_repo: true, branch: parsed.branch, files: parsed.files })
        .into_response()
}

#[derive(Serialize)]
pub struct GitChange {
    #[serde(rename = "type")]
    pub change_type: String,
    pub modified_start: usize,
    pub modified_end: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_start: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_end: Option<usize>,
}

#[derive(Serialize)]
pub struct GitDiffResponse {
    pub is_git_repo: bool,
    pub original_content: Option<String>,
    pub changes: Vec<GitChange>,
}

pub async fn workspace_git_diff(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
) -> impl IntoResponse {
    let no_git = || {
        Json(GitDiffResponse { is_git_repo: false, original_content: None, changes: vec![] })
            .into_response()
    };
    let root = try_res!(get_root(&manager, &q.pane_id));
    let git_check = tokio::task::spawn_blocking({
        let root = root.clone();
        move || git_command().args(["rev-parse", "--git-dir"]).current_dir(&root).output()
    })
    .await;
    match git_check {
        Ok(Ok(o)) if o.status.success() => {}
        _ => return no_git(),
    }
    let rel = q.path.trim().trim_start_matches('/');
    if rel.is_empty() {
        return no_git();
    }
    let original = tokio::task::spawn_blocking({
        let root = root.clone();
        let rel = rel.to_string();
        move || git_command().args(["show", &format!("HEAD:{rel}")]).current_dir(&root).output()
    })
    .await;
    let original_content = match original {
        Ok(Ok(o)) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => return no_git(),
    };
    let target = try_res!(normalize_join(&root, rel));
    let Ok(current) = std::fs::read_to_string(&target) else { return no_git() };
    let diff = similar::TextDiff::from_lines(&original_content, &current);
    let mut changes: Vec<GitChange> = Vec::new();
    let mut orig_line = 1usize;
    let mut mod_line = 1usize;

    for op in diff.ops() {
        match op {
            similar::DiffOp::Equal { old_index: _, new_index: _, len } => {
                orig_line += len;
                mod_line += len;
            }
            similar::DiffOp::Insert { old_index: _, new_index: _, new_len } => {
                changes.push(GitChange {
                    change_type: "added".to_string(),
                    modified_start: mod_line,
                    modified_end: mod_line + new_len - 1,
                    original_start: Some(orig_line),
                    original_end: None,
                });
                mod_line += new_len;
            }
            similar::DiffOp::Delete { old_index: _, old_len, new_index: _ } => {
                changes.push(GitChange {
                    change_type: "deleted".to_string(),
                    modified_start: mod_line,
                    modified_end: mod_line,
                    original_start: Some(orig_line),
                    original_end: Some(orig_line + old_len - 1),
                });
                orig_line += old_len;
            }
            similar::DiffOp::Replace { old_index: _, old_len, new_index: _, new_len } => {
                changes.push(GitChange {
                    change_type: "modified".to_string(),
                    modified_start: mod_line,
                    modified_end: mod_line + new_len - 1,
                    original_start: Some(orig_line),
                    original_end: Some(orig_line + old_len - 1),
                });
                orig_line += old_len;
                mod_line += new_len;
            }
        }
    }

    Json(GitDiffResponse { is_git_repo: true, original_content: Some(original_content), changes })
        .into_response()
}

#[derive(Deserialize)]
pub struct GitStageBody {
    pub start_line: usize,
    pub end_line: usize,
}

#[allow(clippy::too_many_lines)]
pub async fn workspace_git_stage_lines(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<GitStageBody>,
) -> impl IntoResponse {
    let root = try_res!(get_root(&manager, &q.pane_id));
    let rel = q.path.trim().trim_start_matches('/');
    if rel.is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "path required");
    }
    let original_out = tokio::task::spawn_blocking({
        let root = root.clone();
        let rel = rel.to_string();
        move || git_command().args(["show", &format!("HEAD:{rel}")]).current_dir(&root).output()
    })
    .await;
    let original = match original_out {
        Ok(Ok(o)) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => String::new(),
    };
    let target = try_res!(normalize_join(&root, rel));
    let current = match std::fs::read_to_string(&target) {
        Ok(c) => c,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let orig_lines: Vec<&str> = original.lines().collect();
    let cur_lines: Vec<&str> = current.lines().collect();
    let diff = similar::TextDiff::from_slices(&orig_lines, &cur_lines);
    let mut staged_lines: Vec<String> = Vec::new();
    let mut mod_line = 1usize;
    for op in diff.ops() {
        match op {
            similar::DiffOp::Equal { old_index, len, .. } => {
                for i in 0..*len {
                    staged_lines.push(orig_lines[old_index + i].to_string());
                }
                mod_line += len;
            }
            similar::DiffOp::Insert { new_index, new_len, .. } => {
                for i in 0..*new_len {
                    let line_num = mod_line + i;
                    if line_num >= body.start_line && line_num <= body.end_line {
                        staged_lines.push(cur_lines[new_index + i].to_string());
                    }
                }
                mod_line += new_len;
            }
            similar::DiffOp::Delete { old_index, old_len, .. } => {
                for i in 0..*old_len {
                    if mod_line >= body.start_line && mod_line <= body.end_line {
                        // staged: omit these lines (accept deletion)
                    } else {
                        staged_lines.push(orig_lines[old_index + i].to_string());
                    }
                }
            }
            similar::DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                let in_range =
                    mod_line >= body.start_line && mod_line + new_len - 1 <= body.end_line;
                if in_range {
                    for i in 0..*new_len {
                        staged_lines.push(cur_lines[new_index + i].to_string());
                    }
                } else {
                    for i in 0..*old_len {
                        staged_lines.push(orig_lines[old_index + i].to_string());
                    }
                }
                mod_line += new_len;
            }
        }
    }
    let staged_content = staged_lines.join("\n");
    let mut patch = format!("--- a/{rel}\n+++ b/{rel}\n");
    let udiff = similar::TextDiff::from_lines(&original, &staged_content);
    for hunk in udiff.unified_diff().context_radius(3).iter_hunks() {
        patch.push_str(&hunk.to_string());
    }
    if patch.lines().count() <= 2 {
        return Json(serde_json::json!({ "ok": true })).into_response();
    }
    let result = tokio::task::spawn_blocking(move || {
        git_command()
            .args(["apply", "--cached", "--unidiff-zero"])
            .stdin(std::process::Stdio::piped())
            .current_dir(&root)
            .spawn()
            .and_then(|mut child| {
                use std::io::Write;
                if let Some(ref mut stdin) = child.stdin {
                    stdin.write_all(patch.as_bytes())?;
                }
                child.wait()
            })
    })
    .await;
    match result {
        Ok(Ok(s)) if s.success() => Json(serde_json::json!({ "ok": true })).into_response(),
        Ok(Ok(s)) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &format!("git apply failed: {s}")),
        Ok(Err(e)) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        Err(e) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

#[derive(Deserialize)]
pub struct GitRevertBody {
    pub start_line: usize,
    pub end_line: usize,
    pub original_lines: String,
}

pub async fn workspace_git_revert_lines(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<GitRevertBody>,
) -> impl IntoResponse {
    let root = try_res!(get_root(&manager, &q.pane_id));
    let rel = q.path.trim().trim_start_matches('/');
    if rel.is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "path required");
    }
    let target = try_res!(normalize_join(&root, rel));
    let current = match std::fs::read_to_string(&target) {
        Ok(c) => c,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let lines: Vec<&str> = current.lines().collect();
    let start = body.start_line.saturating_sub(1);
    let end = body.end_line.min(lines.len());
    let mut result_lines: Vec<&str> = Vec::new();
    result_lines.extend_from_slice(&lines[..start]);
    for l in body.original_lines.lines() {
        result_lines.push(l);
    }
    if end < lines.len() {
        result_lines.extend_from_slice(&lines[end..]);
    }
    let new_content = result_lines.join("\n");
    let trailing = current.ends_with('\n');
    let write_content = if trailing && !new_content.ends_with('\n') {
        format!("{new_content}\n")
    } else {
        new_content
    };
    if let Err(e) = std::fs::write(&target, write_content.as_bytes()) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

#[derive(Deserialize)]
pub struct GitPathsBody {
    pub paths: Vec<String>,
}

#[derive(Deserialize)]
pub struct GitDiscardBody {
    pub path: String,
    #[serde(default)]
    pub untracked: bool,
}

#[derive(Deserialize)]
pub struct GitCommitBody {
    pub message: String,
}

#[derive(Deserialize)]
pub struct GitUnifiedDiffQuery {
    pub pane_id: String,
    pub path: String,
    #[serde(default)]
    pub staged: bool,
    #[serde(default)]
    pub untracked: bool,
}

fn validate_git_paths(root: &Path, paths: &[String]) -> Result<Vec<String>, Response> {
    // 步骤1：拒绝空操作，避免 Git 将命令作用到整个仓库。
    if paths.is_empty() {
        return Err(json_err(StatusCode::BAD_REQUEST, "paths required"));
    }

    // 步骤2：逐个验证相对路径位于当前工作区内，并统一使用 Git 的正斜杠格式。
    let mut validated_paths = Vec::new();
    for path in paths {
        let trimmed_path = path.trim().trim_start_matches('/');
        if trimmed_path.is_empty() {
            return Err(json_err(StatusCode::BAD_REQUEST, "invalid path"));
        }
        let candidate = normalize_join(root, trimmed_path)?;
        if candidate == root || !candidate.starts_with(root) {
            return Err(json_err(StatusCode::FORBIDDEN, "outside workspace"));
        }
        validated_paths.push(trimmed_path.replace('\\', "/"));
    }
    Ok(validated_paths)
}

async fn run_git_output(
    root: PathBuf,
    arguments: Vec<String>,
) -> Result<std::process::Output, String> {
    // 步骤1：在阻塞线程中执行 Git，避免占用异步请求线程。
    let result = tokio::task::spawn_blocking(move || {
        git_command().args(arguments).current_dir(root).output()
    })
    .await;

    // 步骤2：统一转换进程启动和任务错误，交给接口生成明确响应。
    match result {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(error.to_string()),
        Err(error) => Err(error.to_string()),
    }
}

async fn unstage_git_paths(
    root: PathBuf,
    paths: &[String],
) -> Result<std::process::Output, String> {
    // 步骤1：判断仓库是否已有 HEAD，新仓库不能使用 git restore --staged。
    let head_arguments = vec!["rev-parse".to_string(), "--verify".to_string(), "HEAD".to_string()];
    let head_output = run_git_output(root.clone(), head_arguments).await?;

    // 步骤2：普通仓库恢复暂存区，新仓库从索引移除但保留工作区文件。
    let mut arguments = if head_output.status.success() {
        vec!["restore".to_string(), "--staged".to_string(), "--".to_string()]
    } else {
        vec!["rm".to_string(), "--cached".to_string(), "-r".to_string(), "--".to_string()]
    };
    for path in paths {
        arguments.push(path.clone());
    }
    run_git_output(root, arguments).await
}

fn git_command_response(output: &std::process::Output) -> Response {
    // 步骤1：成功时返回 Git 的简短输出，便于提交后显示摘要。
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Json(serde_json::json!({ "ok": true, "output": stdout })).into_response();
    }

    // 步骤2：失败时优先返回 stderr，避免前端只能看到模糊错误。
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let message = if stderr.is_empty() { "git command failed" } else { &stderr };
    json_err(StatusCode::BAD_REQUEST, message)
}

pub async fn workspace_git_stage(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitPathsBody>,
) -> Response {
    // 步骤1：验证文件路径并构造只作用于这些文件的 git add 命令。
    let root = try_res!(get_root(&manager, &query.pane_id));
    let paths = try_res!(validate_git_paths(&root, &body.paths));
    let mut arguments = vec!["add".to_string(), "--".to_string()];
    for path in paths {
        arguments.push(path);
    }

    // 步骤2：执行暂存并返回 Git 的真实结果。
    match run_git_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_unstage(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitPathsBody>,
) -> Response {
    // 步骤1：验证需要取消暂存的文件路径。
    let root = try_res!(get_root(&manager, &query.pane_id));
    let paths = try_res!(validate_git_paths(&root, &body.paths));

    // 步骤2：执行取消暂存并返回操作结果。
    match unstage_git_paths(root, &paths).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_discard(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitDiscardBody>,
) -> Response {
    // 步骤1：验证单个目标路径，防止丢弃操作越出工作区。
    let root = try_res!(get_root(&manager, &query.pane_id));
    let paths = try_res!(validate_git_paths(&root, &[body.path]));
    let path = paths[0].clone();

    // 步骤2：未跟踪文件直接删除，已跟踪文件交给 Git 恢复工作区版本。
    if body.untracked {
        let target = try_res!(normalize_join(&root, &path));
        try_res!(path_must_be_under(&root, &target));
        let delete_result = if target.is_dir() {
            std::fs::remove_dir_all(&target)
        } else {
            std::fs::remove_file(&target)
        };
        return match delete_result {
            Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
            Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
        };
    }

    let arguments = vec!["restore".to_string(), "--worktree".to_string(), "--".to_string(), path];
    match run_git_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_commit(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitCommitBody>,
) -> Response {
    // 步骤1：要求非空提交说明，避免生成无法识别的提交。
    let message = body.message.trim();
    if message.is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "commit message required");
    }
    let root = try_res!(get_root(&manager, &query.pane_id));

    // 步骤2：把提交说明作为独立参数传递，避免经过 shell 解释。
    let arguments = vec!["commit".to_string(), "-m".to_string(), message.to_string()];
    match run_git_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn build_untracked_patch(path: &str, content: &str) -> String {
    // 步骤1：生成与 Git unified diff 一致的新增文件头部。
    let mut diff_text = format!("diff --git a/{path} b/{path}\n--- /dev/null\n+++ b/{path}\n");

    // 步骤2：给每一行添加新增标记，供前端统一渲染。
    for line in content.lines() {
        diff_text.push('+');
        diff_text.push_str(line);
        diff_text.push('\n');
    }
    diff_text
}

pub async fn workspace_git_unified_diff(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<GitUnifiedDiffQuery>,
) -> Response {
    // 步骤1：验证目标文件，并为未跟踪文本直接生成新增文件 diff。
    let root = try_res!(get_root(&manager, &query.pane_id));
    let paths = try_res!(validate_git_paths(&root, &[query.path]));
    let file_path = paths[0].clone();
    if query.untracked {
        let target = try_res!(normalize_join(&root, &file_path));
        let metadata = match std::fs::metadata(&target) {
            Ok(metadata) => metadata,
            Err(error) => return json_err(StatusCode::NOT_FOUND, &error.to_string()),
        };
        if metadata.len() > MAX_TEXT_PREVIEW as u64 {
            return json_err(StatusCode::BAD_REQUEST, "file too large for diff");
        }
        let content = match std::fs::read_to_string(&target) {
            Ok(content) => content,
            Err(error) => return json_err(StatusCode::BAD_REQUEST, &error.to_string()),
        };
        let diff_text = build_untracked_patch(&file_path, &content);
        return Json(serde_json::json!({ "patch": diff_text })).into_response();
    }

    // 步骤2：根据分组读取暂存区或工作区的统一差异。
    let mut arguments =
        vec!["diff".to_string(), "--no-ext-diff".to_string(), "--no-color".to_string()];
    if query.staged {
        arguments.push("--cached".to_string());
    }
    arguments.push("--".to_string());
    arguments.push(file_path);
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            if output.stdout.len() > MAX_GIT_DIFF_OUTPUT {
                return json_err(StatusCode::BAD_REQUEST, "diff too large to display");
            }
            let diff_text = String::from_utf8_lossy(&output.stdout).into_owned();
            Json(serde_json::json!({ "patch": diff_text })).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

#[cfg(test)]
mod tests {
    use super::{git_command, parse_status_output, unstage_git_paths};
    use std::path::Path;

    fn run_test_git(root: &Path, arguments: &[&str]) {
        // 步骤1：在临时仓库执行 Git 命令，并在失败时输出真实 stderr。
        let output = git_command().args(arguments).current_dir(root).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    }

    #[test]
    fn parses_branch_and_worktree_groups() {
        // 步骤1：准备同时包含暂存、未暂存、未跟踪和重命名状态的 Git 输出。
        let output = "## feature/git-panel...origin/feature/git-panel [ahead 1]\n M src/main.rs\nM  staged.rs\nMM both.rs\n?? new file.txt\nR  old.txt -> new.txt\nUU conflict.txt\n";

        // 步骤2：解析输出并检查分支名称和每类文件状态。
        let parsed = parse_status_output(output);
        assert_eq!(parsed.branch.as_deref(), Some("feature/git-panel"));
        assert_eq!(parsed.files.len(), 6);

        let unstaged = &parsed.files[0];
        assert_eq!(unstaged.path, "src/main.rs");
        assert!(!unstaged.staged);
        assert!(unstaged.unstaged);
        assert_eq!(unstaged.status, "modified");

        let staged = &parsed.files[1];
        assert!(staged.staged);
        assert!(!staged.unstaged);
        assert_eq!(staged.status, "staged_modified");

        let both = &parsed.files[2];
        assert!(both.staged);
        assert!(both.unstaged);
        assert_eq!(both.index_status, "M");
        assert_eq!(both.worktree_status, "M");

        let untracked = &parsed.files[3];
        assert_eq!(untracked.path, "new file.txt");
        assert!(!untracked.staged);
        assert!(untracked.unstaged);
        assert_eq!(untracked.status, "untracked");

        let renamed = &parsed.files[4];
        assert_eq!(renamed.path, "new.txt");
        assert!(renamed.staged);
        assert_eq!(renamed.status, "renamed");

        let conflict = &parsed.files[5];
        assert!(conflict.conflict);
        assert_eq!(conflict.status, "conflict");
    }

    #[test]
    fn parses_detached_head_without_inventing_branch_name() {
        // 步骤1：准备 detached HEAD 的状态输出。
        let output = "## HEAD (no branch)\n M README.md\n";

        // 步骤2：确认解析结果明确表示当前没有分支名称。
        let parsed = parse_status_output(output);
        assert_eq!(parsed.branch, None);
        assert_eq!(parsed.files[0].path, "README.md");
    }

    #[test]
    fn parses_branch_name_before_the_first_commit() {
        // 步骤1：准备新仓库尚无提交时的 porcelain 分支输出。
        let output = "## No commits yet on main\n?? README.md\n";

        // 步骤2：确认面板只显示真实分支名，而不是 Git 的说明文字。
        let parsed = parse_status_output(output);
        assert_eq!(parsed.branch.as_deref(), Some("main"));
        assert_eq!(parsed.files[0].status, "untracked");
    }

    #[tokio::test]
    async fn unstages_a_new_file_before_the_first_commit() {
        // 步骤1：创建没有任何提交的新仓库，并暂存一个新文件。
        let temporary_directory = tempfile::tempdir().unwrap();
        run_test_git(temporary_directory.path(), &["init"]);
        std::fs::write(temporary_directory.path().join("README.md"), "hello\n").unwrap();
        run_test_git(temporary_directory.path(), &["add", "--", "README.md"]);

        // 步骤2：执行面板的取消暂存逻辑，确认文件回到未跟踪状态。
        let paths = vec!["README.md".to_string()];
        let output =
            unstage_git_paths(temporary_directory.path().to_path_buf(), &paths).await.unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let status_output = git_command()
            .args(["status", "--porcelain"])
            .current_dir(temporary_directory.path())
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&status_output.stdout), "?? README.md\n");
    }
}

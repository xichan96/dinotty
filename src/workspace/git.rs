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
const MAX_GIT_STATUS_FILES: usize = 2000;
const MAX_DISCOVERED_REPOSITORIES: usize = 100;
const MAX_REPOSITORY_SCAN_DEPTH: usize = 4;

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
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GCM_INTERACTIVE", "never");
    command.env("GIT_EDITOR", "true");
    command.env("GIT_SEQUENCE_EDITOR", "true");
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

#[derive(Clone, Debug, Serialize)]
pub struct GitRemote {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitBranchInfo {
    pub name: String,
    pub upstream: Option<String>,
    pub current: bool,
}

#[derive(Debug, Serialize)]
pub struct GitBranchesResponse {
    pub local: Vec<GitBranchInfo>,
    pub remote: Vec<GitBranchInfo>,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitCommitSummary {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub parents: Vec<String>,
    pub decorations: Vec<String>,
    pub subject: String,
}

#[derive(Debug, Serialize)]
pub struct GitLogResponse {
    pub commits: Vec<GitCommitSummary>,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
pub struct GitCompareResponse {
    pub base_only: usize,
    pub target_only: usize,
    pub patch: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitStashEntry {
    pub reference: String,
    pub hash: String,
    pub created_at: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct GitStashesResponse {
    pub stashes: Vec<GitStashEntry>,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitTagEntry {
    pub name: String,
    pub target: String,
    pub created_at: String,
    pub subject: String,
}

#[derive(Debug, Serialize)]
pub struct GitTagsResponse {
    pub tags: Vec<GitTagEntry>,
}

#[derive(Debug, Serialize)]
pub struct GitOperationStateResponse {
    pub operation: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitRepositoryEntry {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct GitRepositoriesResponse {
    pub repositories: Vec<GitRepositoryEntry>,
}

#[derive(Debug, Deserialize)]
pub struct GitInitializeBody {
    pub initial_branch: String,
}

#[derive(Debug, Deserialize)]
pub struct GitCloneBody {
    pub url: String,
    pub directory: String,
}

fn validate_initial_branch(value: &str) -> Result<String, String> {
    // 步骤1：先拒绝空名称、控制字符和可能被 Git 解释为选项的名称。
    let branch = value.trim();
    if branch.is_empty() || branch.starts_with('-') || branch.chars().any(char::is_control) {
        return Err("invalid initial branch".to_string());
    }

    // 步骤2：交给 Git 自身校验完整引用命名规则，避免手工规则与 Git 不一致。
    let output = git_command()
        .args(["check-ref-format", "--branch", branch])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("invalid initial branch".to_string());
    }
    Ok(branch.to_string())
}

fn validate_clone_url(value: &str) -> Result<String, String> {
    // 步骤1：允许 HTTPS、SSH 和本地仓库路径，但拒绝空值、控制字符和选项注入。
    let url = value.trim();
    if url.is_empty() || url.starts_with('-') || url.chars().any(char::is_control) {
        return Err("invalid repository URL".to_string());
    }
    Ok(url.to_string())
}

fn validate_clone_directory(value: &str) -> Result<String, String> {
    // 步骤1：克隆目录只接受一个普通目录名称，确保目标始终是工作区直属子目录。
    let directory = value.trim();
    let invalid = directory.is_empty()
        || directory == "."
        || directory == ".."
        || directory.starts_with('-')
        || directory.contains('/')
        || directory.contains('\\')
        || directory.contains(':')
        || directory.chars().any(char::is_control);
    if invalid {
        return Err("invalid clone directory".to_string());
    }
    Ok(directory.to_string())
}

fn discover_git_repositories(root: &Path) -> Vec<GitRepositoryEntry> {
    // 步骤1：使用显式栈限制扫描深度，并跳过常见的大型生成目录。
    let skipped_directories = [".git", "node_modules", "target", ".venv", "dist", "build"];
    let mut repositories = Vec::new();
    let mut pending_directories = vec![(root.to_path_buf(), 0usize)];
    while let Some((directory, depth)) = pending_directories.pop() {
        if repositories.len() >= MAX_DISCOVERED_REPOSITORIES {
            break;
        }
        if directory.join(".git").exists() {
            let relative_path = directory.strip_prefix(root).unwrap_or(Path::new(""));
            let path = relative_path.to_string_lossy().replace('\\', "/");
            let name = if path.is_empty() {
                root.file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("repository")
                    .to_string()
            } else {
                directory.file_name().and_then(|value| value.to_str()).unwrap_or(&path).to_string()
            };
            repositories.push(GitRepositoryEntry { path, name });
            if depth > 0 {
                continue;
            }
        }
        if depth >= MAX_REPOSITORY_SCAN_DEPTH {
            continue;
        }
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry_result in entries {
            let entry = match entry_result {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if !file_type.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if skipped_directories.contains(&name.as_str()) {
                continue;
            }
            pending_directories.push((entry.path(), depth + 1));
        }
    }

    // 步骤2：按仓库相对路径排序，根仓库稳定排在第一项。
    repositories.sort_by(compare_repository_paths);
    repositories
}

fn compare_repository_paths(
    first: &GitRepositoryEntry,
    second: &GitRepositoryEntry,
) -> std::cmp::Ordering {
    // 步骤1：使用相对路径字典序生成稳定列表。
    first.path.cmp(&second.path)
}

fn get_git_root(
    manager: &SessionManager,
    pane_id: &str,
    repository: Option<&str>,
) -> Result<PathBuf, Response> {
    // 步骤1：空仓库路径继续使用当前文件导航根目录。
    let workspace_root = get_root(manager, pane_id)?;
    let repository = repository.unwrap_or("").trim();
    if repository.is_empty() {
        return Ok(workspace_root);
    }

    // 步骤2：验证选择的仓库位于导航根目录内，并实际包含 .git。
    let repository_root = normalize_join(&workspace_root, repository)?;
    if repository_root == workspace_root || !repository_root.starts_with(&workspace_root) {
        return Err(json_err(StatusCode::FORBIDDEN, "repository outside workspace"));
    }
    if !repository_root.is_dir() || !repository_root.join(".git").exists() {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid repository"));
    }
    Ok(repository_root)
}

pub async fn workspace_git_repositories(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：在阻塞线程中扫描当前文件导航根目录下的仓库。
    let root = try_res!(get_root(&manager, &query.pane_id));
    let result = tokio::task::spawn_blocking(move || discover_git_repositories(&root)).await;
    match result {
        Ok(repositories) => Json(GitRepositoriesResponse { repositories }).into_response(),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

async fn initialize_git_repository(
    root: PathBuf,
    initial_branch: String,
) -> Result<std::process::Output, String> {
    // 步骤1：在当前工作区创建仓库，并显式指定用户选择的初始分支。
    let arguments = vec![
        "init".to_string(),
        "--initial-branch".to_string(),
        initial_branch,
        ".".to_string(),
    ];
    run_git_output(root, arguments).await
}

async fn clone_git_repository(
    workspace_root: PathBuf,
    url: String,
    destination: PathBuf,
) -> Result<std::process::Output, String> {
    // 步骤1：使用 -- 结束选项解析，并让 Git 在工作区内创建目标目录。
    let arguments = vec![
        "clone".to_string(),
        "--".to_string(),
        url,
        destination.to_string_lossy().into_owned(),
    ];
    run_git_output(workspace_root, arguments).await
}

fn repository_setup_response(output: &std::process::Output, repository: &str) -> Response {
    // 步骤1：成功时返回新仓库相对路径，前端据此重新扫描并自动选中。
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stdout.is_empty() { stderr } else { stdout };
        return Json(serde_json::json!({
            "ok": true,
            "repository": repository,
            "output": message,
        }))
        .into_response();
    }

    // 步骤2：失败时沿用统一 Git 错误响应，保留真实 stderr。
    git_command_response(output)
}

pub async fn workspace_git_initialize(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitInitializeBody>,
) -> Response {
    // 步骤1：读取当前文件导航根目录，并拒绝重复初始化已有仓库。
    let root = try_res!(get_root(&manager, &query.pane_id));
    if root.join(".git").exists() {
        return json_err(StatusCode::CONFLICT, "workspace is already a Git repository");
    }
    let initial_branch = match validate_initial_branch(&body.initial_branch) {
        Ok(value) => value,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };

    // 步骤2：执行初始化并返回根仓库使用的空相对路径。
    match initialize_git_repository(root, initial_branch).await {
        Ok(output) => repository_setup_response(&output, ""),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_clone(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitCloneBody>,
) -> Response {
    // 步骤1：验证远程地址和直属子目录名称，确保目标不会逃离工作区。
    let root = try_res!(get_root(&manager, &query.pane_id));
    let url = match validate_clone_url(&body.url) {
        Ok(value) => value,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    let directory = match validate_clone_directory(&body.directory) {
        Ok(value) => value,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    let destination = root.join(&directory);
    if destination.exists() {
        return json_err(StatusCode::CONFLICT, "clone destination already exists");
    }

    // 步骤2：克隆成功后返回目录名称，文件导航会重新扫描并选中新仓库。
    match clone_git_repository(root, url, destination).await {
        Ok(output) => repository_setup_response(&output, &directory),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

#[derive(Serialize)]
pub struct GitStatusResponse {
    pub is_git_repo: bool,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub remotes: Vec<GitRemote>,
    pub files: Vec<GitFileStatus>,
    pub total_files: usize,
    pub truncated: bool,
}

struct ParsedGitStatus {
    branch: Option<String>,
    upstream: Option<String>,
    ahead: usize,
    behind: usize,
    files: Vec<GitFileStatus>,
    total_files: usize,
    truncated: bool,
}

struct ParsedBranchStatus {
    branch: Option<String>,
    upstream: Option<String>,
    ahead: usize,
    behind: usize,
}

fn parse_branch_line(line: &str) -> ParsedBranchStatus {
    // 步骤1：去掉 porcelain 分支标记并识别 detached HEAD。
    let Some(branch_text) = line.strip_prefix("## ") else {
        return ParsedBranchStatus { branch: None, upstream: None, ahead: 0, behind: 0 };
    };
    let branch_text = branch_text.trim();
    if branch_text.starts_with("HEAD ") || branch_text == "HEAD" {
        return ParsedBranchStatus { branch: None, upstream: None, ahead: 0, behind: 0 };
    }
    if let Some(initial_branch) = branch_text.strip_prefix("No commits yet on ") {
        return ParsedBranchStatus {
            branch: Some(initial_branch.to_string()),
            upstream: None,
            ahead: 0,
            behind: 0,
        };
    }

    // 步骤2：分离本地分支、上游分支和同步计数。
    let mut branch_parts = branch_text.splitn(2, "...");
    let local_branch = branch_parts.next().unwrap_or("").trim();
    let upstream_text = branch_parts.next();
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    if let Some(upstream_text) = upstream_text {
        let upstream_name = upstream_text.split(" [").next().unwrap_or(upstream_text).trim();
        if !upstream_name.is_empty() {
            upstream = Some(upstream_name.to_string());
        }
        if let Some(metadata_start) = upstream_text.find('[') {
            let metadata = upstream_text[metadata_start + 1..].trim_end_matches(']');
            for item in metadata.split(',') {
                let item = item.trim();
                if let Some(value) = item.strip_prefix("ahead ") {
                    ahead = value.parse().unwrap_or(0);
                }
                if let Some(value) = item.strip_prefix("behind ") {
                    behind = value.parse().unwrap_or(0);
                }
            }
        }
    }

    let branch = if local_branch.is_empty() { None } else { Some(local_branch.to_string()) };
    ParsedBranchStatus { branch, upstream, ahead, behind }
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
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();
    let mut total_files = 0;
    for line in output.lines() {
        if line.starts_with("## ") {
            let branch_status = parse_branch_line(line);
            branch = branch_status.branch;
            upstream = branch_status.upstream;
            ahead = branch_status.ahead;
            behind = branch_status.behind;
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
        total_files += 1;
        if files.len() < MAX_GIT_STATUS_FILES {
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
    }
    let truncated = total_files > files.len();
    ParsedGitStatus { branch, upstream, ahead, behind, files, total_files, truncated }
}

fn parse_remote_output(output: &str) -> Vec<GitRemote> {
    // 步骤1：逐行读取 remote、地址和用途，并按远程仓库名称合并。
    let mut remotes: Vec<GitRemote> = Vec::new();
    for line in output.lines() {
        let mut columns = line.split_whitespace();
        let Some(name) = columns.next() else { continue };
        let Some(url) = columns.next() else { continue };
        let Some(direction) = columns.next() else { continue };
        let remote_index = remotes.iter().position(|remote| remote.name == name);
        let index = if let Some(index) = remote_index {
            index
        } else {
            remotes.push(GitRemote {
                name: name.to_string(),
                fetch_url: String::new(),
                push_url: String::new(),
            });
            remotes.len() - 1
        };

        // 步骤2：分别保存 fetch 与 push 地址，支持两者使用不同协议或主机。
        if direction == "(fetch)" {
            remotes[index].fetch_url = url.to_string();
        }
        if direction == "(push)" {
            remotes[index].push_url = url.to_string();
        }
    }
    remotes
}

fn parse_branch_output(output: &str) -> GitBranchesResponse {
    // 步骤1：按 NUL 分隔字段读取完整引用、短名称、上游和当前分支标记。
    let mut local = Vec::new();
    let mut remote = Vec::new();
    for line in output.lines() {
        let columns: Vec<&str> = line.split('\0').collect();
        if columns.len() < 4 {
            continue;
        }
        let full_name = columns[0];
        let name = columns[1];
        let upstream = if columns[2].is_empty() { None } else { Some(columns[2].to_string()) };
        let current = columns[3].trim() == "*";
        let branch = GitBranchInfo { name: name.to_string(), upstream, current };

        // 步骤2：本地与远程引用分组，并忽略 origin/HEAD 之类的指针引用。
        if full_name.starts_with("refs/heads/") {
            local.push(branch);
        } else if full_name.starts_with("refs/remotes/") && !full_name.ends_with("/HEAD") {
            remote.push(branch);
        }
    }
    GitBranchesResponse { local, remote }
}

fn parse_log_output(output: &str) -> Vec<GitCommitSummary> {
    // 步骤1：按记录分隔符拆分提交，再按 NUL 拆分不会与正文冲突的字段。
    let mut commits = Vec::new();
    for record in output.split('\x1e') {
        let record = record.trim_matches(['\r', '\n']);
        if record.is_empty() {
            continue;
        }
        let columns: Vec<&str> = record.split('\0').collect();
        if columns.len() < 8 {
            continue;
        }

        // 步骤2：逐个保存父提交，支持普通提交、根提交和合并提交。
        let mut parents = Vec::new();
        for parent in columns[5].split_whitespace() {
            parents.push(parent.to_string());
        }
        let mut decorations = Vec::new();
        for decoration in columns[6].split(", ") {
            let decoration = decoration.trim();
            if !decoration.is_empty() {
                decorations.push(decoration.to_string());
            }
        }
        commits.push(GitCommitSummary {
            hash: columns[0].to_string(),
            short_hash: columns[1].to_string(),
            author_name: columns[2].to_string(),
            author_email: columns[3].to_string(),
            authored_at: columns[4].to_string(),
            parents,
            decorations,
            subject: columns[7].to_string(),
        });
    }
    commits
}

fn git_commit_matches_search(commit: &GitCommitSummary, search: &str) -> bool {
    // 步骤1：统一使用小写比较，覆盖 hash、作者、说明和分支/标签名称。
    let search = search.trim().to_lowercase();
    if search.is_empty() {
        return true;
    }
    let text_fields = [
        commit.hash.as_str(),
        commit.short_hash.as_str(),
        commit.author_name.as_str(),
        commit.author_email.as_str(),
        commit.subject.as_str(),
    ];
    for field in text_fields {
        if field.to_lowercase().contains(&search) {
            return true;
        }
    }
    for decoration in &commit.decorations {
        if decoration.to_lowercase().contains(&search) {
            return true;
        }
    }
    false
}

fn parse_stash_output(output: &str) -> Vec<GitStashEntry> {
    // 步骤1：按记录分隔符拆分 stash，再读取引用、对象 ID、时间和说明。
    let mut stashes = Vec::new();
    for record in output.split('\x1e') {
        let record = record.trim_matches(['\r', '\n']);
        if record.is_empty() {
            continue;
        }
        let columns: Vec<&str> = record.split('\0').collect();
        if columns.len() < 4 {
            continue;
        }
        stashes.push(GitStashEntry {
            reference: columns[0].to_string(),
            hash: columns[1].to_string(),
            created_at: columns[2].to_string(),
            message: columns[3].to_string(),
        });
    }
    stashes
}

fn parse_tag_output(output: &str) -> Vec<GitTagEntry> {
    // 步骤1：标签每行一条记录，字段使用 NUL 分隔以保留说明中的空格。
    let mut tags = Vec::new();
    for line in output.lines() {
        let columns: Vec<&str> = line.split('\0').collect();
        if columns.len() < 4 || columns[0].is_empty() {
            continue;
        }
        tags.push(GitTagEntry {
            name: columns[0].to_string(),
            target: columns[1].to_string(),
            created_at: columns[2].to_string(),
            subject: columns[3].to_string(),
        });
    }
    tags
}

pub async fn workspace_git_status(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PaneQuery>,
) -> impl IntoResponse {
    let root = try_res!(get_git_root(&manager, &q.pane_id, q.repository.as_deref()));
    let outputs = match tokio::task::spawn_blocking(move || {
        let status_output = git_command()
            .args([
                "-c",
                "core.quotepath=false",
                "status",
                "--porcelain=v1",
                "--branch",
                "--untracked-files=all",
            ])
            .current_dir(&root)
            .output()?;
        let remote_output = git_command().args(["remote", "-v"]).current_dir(&root).output()?;
        Ok::<_, std::io::Error>((status_output, remote_output))
    })
    .await
    {
        Ok(Ok((status_output, remote_output))) if status_output.status.success() => {
            (status_output, remote_output)
        }
        _ => {
            return Json(GitStatusResponse {
                is_git_repo: false,
                branch: None,
                upstream: None,
                ahead: 0,
                behind: 0,
                remotes: vec![],
                files: vec![],
                total_files: 0,
                truncated: false,
            })
            .into_response()
        }
    };
    let (status_output, remote_output) = outputs;
    let stdout = String::from_utf8_lossy(&status_output.stdout);
    let parsed = parse_status_output(&stdout);
    let remote_stdout = String::from_utf8_lossy(&remote_output.stdout);
    let remotes = if remote_output.status.success() {
        parse_remote_output(&remote_stdout)
    } else {
        Vec::new()
    };
    Json(GitStatusResponse {
        is_git_repo: true,
        branch: parsed.branch,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        remotes,
        files: parsed.files,
        total_files: parsed.total_files,
        truncated: parsed.truncated,
    })
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
    #[serde(default)]
    pub amend: bool,
    #[serde(default)]
    pub signoff: bool,
}

#[derive(Deserialize)]
pub struct GitStashSaveBody {
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub include_untracked: bool,
}

#[derive(Deserialize)]
pub struct GitStashReferenceBody {
    pub reference: String,
}

#[derive(Deserialize)]
pub struct GitConflictResolveBody {
    pub path: String,
    pub resolution: String,
}

#[derive(Deserialize)]
pub struct GitConflictContentQuery {
    pub pane_id: String,
    #[serde(default)]
    pub repository: Option<String>,
    pub path: String,
}

#[derive(Deserialize)]
pub struct GitConflictSaveBody {
    pub path: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct GitSourceBody {
    pub source: String,
}

#[derive(Deserialize)]
pub struct GitCommitActionBody {
    pub commit: String,
}

#[derive(Deserialize)]
pub struct GitResetBody {
    pub target: String,
    pub mode: String,
    #[serde(default)]
    pub confirm_hard: bool,
}

#[derive(Deserialize)]
pub struct GitOperationActionBody {
    pub operation: String,
    pub action: String,
}

#[derive(Deserialize)]
pub struct GitTagCreateBody {
    pub name: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub annotated: bool,
    #[serde(default)]
    pub message: String,
}

#[derive(Deserialize)]
pub struct GitTagDeleteBody {
    pub name: String,
}

#[derive(Deserialize)]
pub struct GitBranchSwitchBody {
    pub name: String,
    #[serde(default)]
    pub remote: bool,
    #[serde(default)]
    pub detached: bool,
}

#[derive(Deserialize)]
pub struct GitBranchNameBody {
    pub name: String,
    #[serde(default)]
    pub start_point: Option<String>,
}

#[derive(Deserialize)]
pub struct GitBranchRenameBody {
    pub old_name: String,
    pub new_name: String,
}

#[derive(Deserialize)]
pub struct GitBranchPublishBody {
    pub remote: String,
    pub branch: String,
}

#[derive(Deserialize)]
pub struct GitRemoteAddBody {
    pub name: String,
    pub url: String,
}

#[derive(Deserialize)]
pub struct GitRemoteUpdateBody {
    pub name: String,
    pub new_name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Deserialize)]
pub struct GitRemoteNameBody {
    pub name: String,
}

#[derive(Deserialize)]
pub struct GitUpstreamSetBody {
    pub remote: String,
    pub branch: String,
    pub remote_branch: String,
}

#[derive(Deserialize)]
pub struct GitUpstreamUnsetBody {
    pub branch: String,
}

#[derive(Deserialize)]
pub struct GitUnifiedDiffQuery {
    pub pane_id: String,
    #[serde(default)]
    pub repository: Option<String>,
    pub path: String,
    #[serde(default)]
    pub staged: bool,
    #[serde(default)]
    pub untracked: bool,
    #[serde(default)]
    pub ignore_whitespace: bool,
}

#[derive(Deserialize)]
pub struct GitHunkActionBody {
    pub path: String,
    #[serde(default)]
    pub staged: bool,
    #[serde(default)]
    pub untracked: bool,
    #[serde(default)]
    pub ignore_whitespace: bool,
    pub hunk_index: usize,
    pub action: String,
}

fn default_git_log_limit() -> usize {
    50
}

#[derive(Deserialize)]
pub struct GitLogQuery {
    pub pane_id: String,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub skip: usize,
    #[serde(default = "default_git_log_limit")]
    pub limit: usize,
}

#[derive(Deserialize)]
pub struct GitCommitDiffQuery {
    pub pane_id: String,
    #[serde(default)]
    pub repository: Option<String>,
    pub commit: String,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Deserialize)]
pub struct GitCompareQuery {
    pub pane_id: String,
    #[serde(default)]
    pub repository: Option<String>,
    pub base: String,
    pub target: String,
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
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stdout.is_empty() { stderr } else { stdout };
        return Json(serde_json::json!({ "ok": true, "output": message })).into_response();
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
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
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
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let paths = try_res!(validate_git_paths(&root, &body.paths));

    // 步骤2：执行取消暂存并返回操作结果。
    match unstage_git_paths(root, &paths).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_stage_all(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：用户选择“全部暂存”时由 Git 直接处理整个当前仓库。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let arguments = vec!["add".to_string(), "--all".to_string()];
    match run_git_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_unstage_all(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：判断仓库是否已有 HEAD，分别恢复完整索引或清空新仓库索引。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let head_arguments = vec!["rev-parse".to_string(), "--verify".to_string(), "HEAD".to_string()];
    let head_output = match run_git_output(root.clone(), head_arguments).await {
        Ok(output) => output,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let arguments = if head_output.status.success() {
        vec!["restore".to_string(), "--staged".to_string(), "--".to_string(), ":/".to_string()]
    } else {
        vec![
            "rm".to_string(),
            "--cached".to_string(),
            "-r".to_string(),
            "--".to_string(),
            ".".to_string(),
        ]
    };
    match run_git_output(root, arguments).await {
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
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
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
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));

    // 步骤2：把提交选项和说明作为独立参数传递，避免经过 shell 解释。
    let arguments = build_commit_arguments(message, body.amend, body.signoff);
    match run_git_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn build_commit_arguments(message: &str, amend: bool, signoff: bool) -> Vec<String> {
    // 步骤1：先加入提交命令，再按界面开关追加修订和签署参数。
    let mut arguments = vec!["commit".to_string()];
    if amend {
        arguments.push("--amend".to_string());
    }
    if signoff {
        arguments.push("--signoff".to_string());
    }

    // 步骤2：提交说明始终作为最后一个独立参数传递。
    arguments.push("-m".to_string());
    arguments.push(message.to_string());
    arguments
}

fn validate_stash_reference(value: &str) -> Result<String, Response> {
    // 步骤1：只接受 stash@{数字}，避免引用被解释为 Git 选项或其他对象。
    let value = value.trim();
    let Some(index_text) = value.strip_prefix("stash@{").and_then(|rest| rest.strip_suffix('}'))
    else {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid stash reference"));
    };
    if index_text.is_empty() || !index_text.chars().all(|character| character.is_ascii_digit()) {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid stash reference"));
    }
    Ok(value.to_string())
}

pub async fn workspace_git_stashes(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：使用稳定分隔符读取当前仓库全部 stash。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let arguments = vec![
        "stash".to_string(),
        "list".to_string(),
        "--date=iso-strict".to_string(),
        "--format=%gd%x00%H%x00%aI%x00%gs%x1e".to_string(),
    ];
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            Json(GitStashesResponse { stashes: parse_stash_output(&stdout) }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_stash_save(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitStashSaveBody>,
) -> Response {
    // 步骤1：构造 stash push，可选包含未跟踪文件和用户说明。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let mut arguments = vec!["stash".to_string(), "push".to_string()];
    if body.include_untracked {
        arguments.push("--include-untracked".to_string());
    }
    let message = body.message.trim();
    if !message.is_empty() {
        arguments.push("-m".to_string());
        arguments.push(message.to_string());
    }

    // 步骤2：执行保存并返回 Git 的真实提示。
    match run_git_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

async fn run_stash_reference_action(
    manager: &SessionManager,
    query: &PaneQuery,
    operation: &str,
    reference: &str,
) -> Response {
    // 步骤1：验证仓库和 stash 引用，再执行单一 stash 操作。
    let root = match get_git_root(manager, &query.pane_id, query.repository.as_deref()) {
        Ok(root) => root,
        Err(response) => return response,
    };
    let reference = match validate_stash_reference(reference) {
        Ok(reference) => reference,
        Err(response) => return response,
    };
    let arguments = vec!["stash".to_string(), operation.to_string(), reference];
    match run_git_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_stash_apply(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitStashReferenceBody>,
) -> Response {
    // 步骤1：应用 stash 但保留列表记录。
    run_stash_reference_action(&manager, &query, "apply", &body.reference).await
}

pub async fn workspace_git_stash_pop(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitStashReferenceBody>,
) -> Response {
    // 步骤1：应用 stash，并在成功时由 Git 删除对应记录。
    run_stash_reference_action(&manager, &query, "pop", &body.reference).await
}

pub async fn workspace_git_stash_drop(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitStashReferenceBody>,
) -> Response {
    // 步骤1：删除用户明确选择的 stash 记录。
    run_stash_reference_action(&manager, &query, "drop", &body.reference).await
}

pub async fn workspace_git_conflict_resolve(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitConflictResolveBody>,
) -> Response {
    // 步骤1：验证冲突文件路径和界面允许的三种解决方式。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let paths = try_res!(validate_git_paths(&root, &[body.path]));
    let path = paths[0].clone();
    let resolution = body.resolution.as_str();
    if resolution != "ours" && resolution != "theirs" && resolution != "resolved" {
        return json_err(StatusCode::BAD_REQUEST, "invalid conflict resolution");
    }

    // 步骤2：采用一侧版本时先恢复对应内容，手动解决时直接进入暂存区。
    if resolution == "ours" || resolution == "theirs" {
        let checkout_arguments =
            vec!["checkout".to_string(), format!("--{resolution}"), "--".to_string(), path.clone()];
        match run_git_output(root.clone(), checkout_arguments).await {
            Ok(output) if output.status.success() => {}
            Ok(output) => return git_command_response(&output),
            Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
        }
    }
    let add_arguments = vec!["add".to_string(), "--".to_string(), path];
    match run_git_output(root, add_arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

async fn read_conflict_stage(
    root: PathBuf,
    stage: usize,
    path: String,
) -> Result<Option<String>, String> {
    // 步骤1：只允许 Git index 定义的 base、current、incoming 三个 stage。
    if !(1..=3).contains(&stage) {
        return Err("invalid conflict stage".to_string());
    }
    let arguments = vec!["show".to_string(), format!(":{stage}:{path}")];
    let output = run_git_output(root, arguments).await?;
    if !output.status.success() {
        return Ok(None);
    }
    if output.stdout.len() > MAX_TEXT_PREVIEW {
        return Err("conflict source too large".to_string());
    }
    Ok(Some(String::from_utf8_lossy(&output.stdout).into_owned()))
}

pub async fn workspace_git_conflict_content(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<GitConflictContentQuery>,
) -> Response {
    // 步骤1：验证仓库和冲突文件路径，并读取当前工作文件结果。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let paths = try_res!(validate_git_paths(&root, &[query.path]));
    let path = paths[0].clone();
    let target = try_res!(normalize_join(&root, &path));
    let metadata = match std::fs::metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) => return json_err(StatusCode::NOT_FOUND, &error.to_string()),
    };
    if metadata.len() > MAX_TEXT_PREVIEW as u64 {
        return json_err(StatusCode::BAD_REQUEST, "conflict file too large");
    }
    let result_content = match std::fs::read_to_string(&target) {
        Ok(content) => content,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error.to_string()),
    };

    // 步骤2：并行读取 index 中的 base、current 和 incoming，缺失 stage 返回空值。
    let base_future = read_conflict_stage(root.clone(), 1, path.clone());
    let current_future = read_conflict_stage(root.clone(), 2, path.clone());
    let incoming_future = read_conflict_stage(root, 3, path);
    let (base_result, current_result, incoming_result) =
        tokio::join!(base_future, current_future, incoming_future);
    let base = match base_result {
        Ok(content) => content,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let current = match current_result {
        Ok(content) => content,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let incoming = match incoming_result {
        Ok(content) => content,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    Json(serde_json::json!({
        "base": base,
        "current": current,
        "incoming": incoming,
        "result": result_content,
    }))
    .into_response()
}

pub async fn workspace_git_conflict_save(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitConflictSaveBody>,
) -> Response {
    // 步骤1：限制合并结果大小，并确认目标文件当前确实处于 unmerged 状态。
    if body.content.len() > MAX_TEXT_PREVIEW {
        return json_err(StatusCode::BAD_REQUEST, "merged content too large");
    }
    if contains_conflict_markers(&body.content) {
        return json_err(StatusCode::BAD_REQUEST, "conflict markers remain");
    }
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let paths = try_res!(validate_git_paths(&root, &[body.path]));
    let path = paths[0].clone();
    let check_arguments = vec![
        "ls-files".to_string(),
        "--unmerged".to_string(),
        "--".to_string(),
        path.clone(),
    ];
    let check_output = match run_git_output(root.clone(), check_arguments).await {
        Ok(output) => output,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    if !check_output.status.success() {
        return git_command_response(&check_output);
    }
    if check_output.stdout.is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "file is not conflicted");
    }

    // 步骤2：写入完整合并结果，再由 git add 原子地标记冲突已解决。
    let target = try_res!(normalize_join(&root, &path));
    if let Err(error) = std::fs::write(&target, body.content.as_bytes()) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    let add_arguments = vec!["add".to_string(), "--".to_string(), path];
    match run_git_output(root, add_arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn contains_conflict_markers(content: &str) -> bool {
    // 步骤1：只识别行首 Git 冲突标记，普通代码中的连续等号不会误报。
    for line in content.lines() {
        let marker = line.trim_end_matches('\r');
        if marker.starts_with("<<<<<<<")
            || marker.starts_with("|||||||")
            || marker == "======="
            || marker.starts_with(">>>>>>>")
        {
            return true;
        }
    }
    false
}

async fn run_git_action(
    manager: &SessionManager,
    query: &PaneQuery,
    arguments: Vec<String>,
) -> Response {
    // 步骤1：在当前仓库执行已完成参数校验的高级 Git 操作。
    let root = match get_git_root(manager, &query.pane_id, query.repository.as_deref()) {
        Ok(root) => root,
        Err(response) => return response,
    };
    match run_git_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_merge(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitSourceBody>,
) -> Response {
    // 步骤1：校验来源分支并执行不会打开编辑器的合并。
    let source = try_res!(validate_git_name(&body.source, "source"));
    let arguments = vec!["merge".to_string(), "--no-edit".to_string(), source];
    run_git_action(&manager, &query, arguments).await
}

pub async fn workspace_git_rebase(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitSourceBody>,
) -> Response {
    // 步骤1：校验目标分支并把当前分支变基到该分支。
    let source = try_res!(validate_git_name(&body.source, "source"));
    let arguments = vec!["rebase".to_string(), source];
    run_git_action(&manager, &query, arguments).await
}

pub async fn workspace_git_cherry_pick(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitCommitActionBody>,
) -> Response {
    // 步骤1：只接受明确的十六进制提交 ID，再执行 Cherry-pick。
    let commit = try_res!(validate_commit_hash(&body.commit));
    let arguments = vec!["cherry-pick".to_string(), commit];
    run_git_action(&manager, &query, arguments).await
}

pub async fn workspace_git_revert_commit(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitCommitActionBody>,
) -> Response {
    // 步骤1：验证提交 ID，并创建不打开编辑器的反向提交。
    let commit = try_res!(validate_commit_hash(&body.commit));
    let arguments = vec!["revert".to_string(), "--no-edit".to_string(), commit];
    run_git_action(&manager, &query, arguments).await
}

pub async fn workspace_git_reset(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitResetBody>,
) -> Response {
    // 步骤1：Reset 模式使用固定白名单，hard 模式还要求请求体显式二次确认。
    let mode = body.mode.trim();
    if mode != "soft" && mode != "mixed" && mode != "hard" {
        return json_err(StatusCode::BAD_REQUEST, "invalid reset mode");
    }
    if mode == "hard" && !body.confirm_hard {
        return json_err(StatusCode::BAD_REQUEST, "hard reset confirmation required");
    }
    let target = try_res!(validate_git_name(&body.target, "target"));
    let arguments = vec!["reset".to_string(), format!("--{mode}"), target];
    run_git_action(&manager, &query, arguments).await
}

pub async fn workspace_git_operation_state(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：读取真实 Git 目录，兼容普通仓库和 worktree。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let git_dir_arguments = vec!["rev-parse".to_string(), "--git-dir".to_string()];
    let output = match run_git_output(root.clone(), git_dir_arguments).await {
        Ok(output) if output.status.success() => output,
        Ok(output) => return git_command_response(&output),
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let git_dir_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let git_dir_path = PathBuf::from(&git_dir_text);
    let git_dir = if git_dir_path.is_absolute() { git_dir_path } else { root.join(git_dir_path) };

    // 步骤2：按优先级识别正在进行的变基、合并、Cherry-pick 或 Revert。
    let operation =
        if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
            Some("rebase".to_string())
        } else if git_dir.join("MERGE_HEAD").exists() {
            Some("merge".to_string())
        } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
            Some("cherry-pick".to_string())
        } else if git_dir.join("REVERT_HEAD").exists() {
            Some("revert".to_string())
        } else {
            None
        };
    Json(GitOperationStateResponse { operation }).into_response()
}

pub async fn workspace_git_operation_action(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitOperationActionBody>,
) -> Response {
    // 步骤1：操作类型和动作都使用白名单，避免拼接任意 Git 子命令。
    let operation = body.operation.trim();
    let action = body.action.trim();
    let valid_operation = operation == "merge"
        || operation == "rebase"
        || operation == "cherry-pick"
        || operation == "revert";
    if !valid_operation || (action != "continue" && action != "abort") {
        return json_err(StatusCode::BAD_REQUEST, "invalid operation action");
    }
    let arguments = vec![operation.to_string(), format!("--{action}")];
    run_git_action(&manager, &query, arguments).await
}

pub async fn workspace_git_tags(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：按创建时间倒序读取本地标签的稳定字段。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let arguments = vec![
        "for-each-ref".to_string(),
        "--sort=-creatordate".to_string(),
        "--format=%(refname:short)%00%(objectname)%00%(creatordate:iso-strict)%00%(subject)"
            .to_string(),
        "refs/tags".to_string(),
    ];
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            Json(GitTagsResponse { tags: parse_tag_output(&stdout) }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_tag_create(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitTagCreateBody>,
) -> Response {
    // 步骤1：校验标签名和目标引用，空目标默认指向 HEAD。
    let name = try_res!(validate_git_name(&body.name, "tag name"));
    let target_text = if body.target.trim().is_empty() { "HEAD" } else { body.target.trim() };
    let target = try_res!(validate_git_name(target_text, "target"));
    let mut arguments = vec!["tag".to_string()];
    if body.annotated {
        let message = body.message.trim();
        if message.is_empty() {
            return json_err(StatusCode::BAD_REQUEST, "tag message required");
        }
        arguments.push("-a".to_string());
        arguments.push(name);
        arguments.push(target);
        arguments.push("-m".to_string());
        arguments.push(message.to_string());
    } else {
        arguments.push(name);
        arguments.push(target);
    }
    run_git_action(&manager, &query, arguments).await
}

pub async fn workspace_git_tag_delete(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitTagDeleteBody>,
) -> Response {
    // 步骤1：删除用户明确选择且通过校验的本地标签。
    let name = try_res!(validate_git_name(&body.name, "tag name"));
    let arguments = vec!["tag".to_string(), "-d".to_string(), name];
    run_git_action(&manager, &query, arguments).await
}

async fn run_git_remote_command(
    manager: &SessionManager,
    query: &PaneQuery,
    arguments: Vec<String>,
) -> Response {
    // 步骤1：读取当前 pane 的真实工作目录，确保远程操作作用于正在查看的仓库。
    let root = match get_git_root(manager, &query.pane_id, query.repository.as_deref()) {
        Ok(root) => root,
        Err(response) => return response,
    };

    // 步骤2：执行不经过 shell 的 Git 参数，并把远程端真实结果返回给面板。
    match run_git_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn validate_git_name(value: &str, label: &str) -> Result<String, Response> {
    // 步骤1：拒绝空名称和控制字符，Git 会继续校验具体引用命名规则。
    let value = value.trim();
    if value.is_empty() || value.starts_with('-') || value.chars().any(char::is_control) {
        return Err(json_err(StatusCode::BAD_REQUEST, &format!("{label} required")));
    }
    Ok(value.to_string())
}

pub async fn workspace_git_branches(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：读取本地与远程引用，使用 NUL 分隔避免分支名称解析歧义。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let arguments = vec![
        "for-each-ref".to_string(),
        "--sort=refname".to_string(),
        "--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(HEAD)".to_string(),
        "refs/heads".to_string(),
        "refs/remotes".to_string(),
    ];
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            Json(parse_branch_output(&stdout)).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_branch_switch(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitBranchSwitchBody>,
) -> Response {
    // 步骤1：历史提交检出只接受提交 hash，普通切换继续使用分支名称。
    let name = if body.detached {
        try_res!(validate_commit_hash(&body.name))
    } else {
        try_res!(validate_git_name(&body.name, "branch"))
    };
    if body.detached && body.remote {
        return json_err(StatusCode::BAD_REQUEST, "detached checkout cannot track a remote");
    }
    let arguments = build_branch_switch_arguments(&name, body.remote, body.detached);
    run_git_remote_command(&manager, &query, arguments).await
}

fn build_branch_switch_arguments(name: &str, remote: bool, detached: bool) -> Vec<String> {
    // 步骤1：按互斥模式构造 detached、远程跟踪或普通分支切换参数。
    if detached {
        return vec!["switch".to_string(), "--detach".to_string(), name.to_string()];
    }
    if remote {
        return vec!["switch".to_string(), "--track".to_string(), name.to_string()];
    }
    vec!["switch".to_string(), name.to_string()]
}

pub async fn workspace_git_branch_create(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitBranchNameBody>,
) -> Response {
    // 步骤1：创建新分支并立即切换；历史入口可指定经过校验的提交起点。
    let name = try_res!(validate_git_name(&body.name, "branch"));
    let start_point = match body.start_point.as_deref() {
        Some(value) if !value.trim().is_empty() => Some(try_res!(validate_commit_hash(value))),
        _ => None,
    };
    let arguments = build_branch_create_arguments(&name, start_point.as_deref());
    run_git_remote_command(&manager, &query, arguments).await
}

fn build_branch_create_arguments(name: &str, start_point: Option<&str>) -> Vec<String> {
    // 步骤1：先放置固定命令和分支名，再按需追加历史提交起点。
    let mut arguments = vec!["switch".to_string(), "-c".to_string(), name.to_string()];
    if let Some(start_point) = start_point {
        arguments.push(start_point.to_string());
    }
    arguments
}

pub async fn workspace_git_branch_delete(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitBranchNameBody>,
) -> Response {
    // 步骤1：只删除已合并的本地分支，未合并分支由 Git 拒绝并返回明确提示。
    let name = try_res!(validate_git_name(&body.name, "branch"));
    let arguments = vec!["branch".to_string(), "-d".to_string(), name];
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_branch_rename(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitBranchRenameBody>,
) -> Response {
    // 步骤1：同时校验旧名称与新名称，再交给 Git 原子重命名。
    let old_name = try_res!(validate_git_name(&body.old_name, "old branch"));
    let new_name = try_res!(validate_git_name(&body.new_name, "new branch"));
    let arguments = vec!["branch".to_string(), "-m".to_string(), old_name, new_name];
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_branch_publish(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitBranchPublishBody>,
) -> Response {
    // 步骤1：推送当前本地分支并建立 upstream，后续可直接 Pull 和 Push。
    let remote = try_res!(validate_git_name(&body.remote, "remote"));
    let branch = try_res!(validate_git_name(&body.branch, "branch"));
    let arguments = vec!["push".to_string(), "-u".to_string(), remote, branch];
    run_git_remote_command(&manager, &query, arguments).await
}

fn build_remote_add_arguments(name: &str, url: &str) -> Vec<String> {
    // 步骤1：使用固定 remote add 子命令添加名称和地址。
    vec!["remote".to_string(), "add".to_string(), name.to_string(), url.to_string()]
}

fn build_remote_update_arguments(
    name: &str,
    new_name: &str,
    fetch_url: &str,
    push_url: &str,
) -> Vec<Vec<String>> {
    // 步骤1：名称变化时先重命名，后续命令统一使用新名称。
    let mut commands = Vec::new();
    if name != new_name {
        commands.push(vec![
            "remote".to_string(),
            "rename".to_string(),
            name.to_string(),
            new_name.to_string(),
        ]);
    }

    // 步骤2：分别设置 Fetch 与 Push 地址，支持读写地址不同的仓库。
    commands.push(vec![
        "remote".to_string(),
        "set-url".to_string(),
        new_name.to_string(),
        fetch_url.to_string(),
    ]);
    commands.push(vec![
        "remote".to_string(),
        "set-url".to_string(),
        "--push".to_string(),
        new_name.to_string(),
        push_url.to_string(),
    ]);
    commands
}

fn build_remote_delete_arguments(name: &str) -> Vec<String> {
    // 步骤1：删除 Remote 及其远程跟踪引用。
    vec!["remote".to_string(), "remove".to_string(), name.to_string()]
}

fn build_upstream_set_arguments(
    remote: &str,
    branch: &str,
    remote_branch: &str,
) -> Vec<String> {
    // 步骤1：显式拼接经过验证的 Remote 与远程分支，再绑定指定本地分支。
    let upstream = format!("--set-upstream-to={remote}/{remote_branch}");
    vec!["branch".to_string(), upstream, branch.to_string()]
}

fn build_upstream_unset_arguments(branch: &str) -> Vec<String> {
    // 步骤1：只取消指定本地分支的 Upstream，不修改远程引用。
    vec!["branch".to_string(), "--unset-upstream".to_string(), branch.to_string()]
}

pub async fn workspace_git_remote_add(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitRemoteAddBody>,
) -> Response {
    // 步骤1：校验名称和地址，再执行固定 Remote 添加命令。
    let name = try_res!(validate_git_name(&body.name, "remote"));
    let url = match validate_clone_url(&body.url) {
        Ok(value) => value,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    let arguments = build_remote_add_arguments(&name, &url);
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_remote_update(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitRemoteUpdateBody>,
) -> Response {
    // 步骤1：完整校验旧名称、新名称以及两个地址。
    let name = try_res!(validate_git_name(&body.name, "remote"));
    let new_name = try_res!(validate_git_name(&body.new_name, "new remote"));
    let fetch_url = match validate_clone_url(&body.fetch_url) {
        Ok(value) => value,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    let push_url = match validate_clone_url(&body.push_url) {
        Ok(value) => value,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    let commands = build_remote_update_arguments(&name, &new_name, &fetch_url, &push_url);
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));

    // 步骤2：顺序执行重命名和地址更新，任一步失败立即返回真实 Git 错误。
    let mut last_output = None;
    for arguments in commands {
        let output = match run_git_output(root.clone(), arguments).await {
            Ok(value) => value,
            Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
        };
        if !output.status.success() {
            return git_command_response(&output);
        }
        last_output = Some(output);
    }
    match last_output {
        Some(output) => git_command_response(&output),
        None => json_err(StatusCode::BAD_REQUEST, "remote update required"),
    }
}

pub async fn workspace_git_remote_delete(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitRemoteNameBody>,
) -> Response {
    // 步骤1：校验名称后删除指定 Remote。
    let name = try_res!(validate_git_name(&body.name, "remote"));
    let arguments = build_remote_delete_arguments(&name);
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_upstream_set(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitUpstreamSetBody>,
) -> Response {
    // 步骤1：校验 Remote、本地分支和远程分支，再建立跟踪关系。
    let remote = try_res!(validate_git_name(&body.remote, "remote"));
    let branch = try_res!(validate_git_name(&body.branch, "branch"));
    let remote_branch = try_res!(validate_git_name(&body.remote_branch, "remote branch"));
    let arguments = build_upstream_set_arguments(&remote, &branch, &remote_branch);
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_upstream_unset(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitUpstreamUnsetBody>,
) -> Response {
    // 步骤1：校验本地分支后取消其跟踪关系。
    let branch = try_res!(validate_git_name(&body.branch, "branch"));
    let arguments = build_upstream_unset_arguments(&branch);
    run_git_remote_command(&manager, &query, arguments).await
}

fn validate_commit_hash(value: &str) -> Result<String, Response> {
    // 步骤1：提交详情只接受 Git 生成的十六进制对象 ID，避免把选项当作 revision。
    let value = value.trim();
    let valid_length = (4..=64).contains(&value.len());
    if !valid_length || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid commit"));
    }
    Ok(value.to_string())
}

pub async fn workspace_git_log(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<GitLogQuery>,
) -> Response {
    // 步骤1：限制单页数量，并构造字段稳定的 Git Log 格式。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let limit = query.limit.clamp(1, 200);
    let requested_count = limit + 1;
    let search = query.search.as_deref().unwrap_or("").trim().to_string();
    let search_active = !search.is_empty();
    let mut arguments = vec![
        "log".to_string(),
        "--all".to_string(),
        "--topo-order".to_string(),
        "--date=iso-strict".to_string(),
        "--decorate=short".to_string(),
        "--pretty=format:%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%D%x00%s%x1e".to_string(),
    ];
    if search_active {
        arguments.push("--max-count=10000".to_string());
    } else {
        arguments.push(format!("--max-count={requested_count}"));
        arguments.push(format!("--skip={}", query.skip));
    }
    if let Some(path) = query.path.as_deref() {
        if !path.trim().is_empty() {
            let paths = try_res!(validate_git_paths(&root, &[path.to_string()]));
            arguments.push("--".to_string());
            arguments.push(paths[0].clone());
        }
    }

    // 步骤2：多取一条判断是否还有下一页，再只返回请求数量。
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let parsed_commits = parse_log_output(&stdout);
            let mut commits = Vec::new();
            if search_active {
                // 步骤2：搜索结果先过滤再分页，确保翻页不会跳过匹配提交。
                let mut matched_count = 0usize;
                for commit in parsed_commits {
                    if !git_commit_matches_search(&commit, &search) {
                        continue;
                    }
                    if matched_count < query.skip {
                        matched_count += 1;
                        continue;
                    }
                    commits.push(commit);
                    matched_count += 1;
                    if commits.len() >= requested_count {
                        break;
                    }
                }
            } else {
                commits = parsed_commits;
            }
            let has_more = commits.len() > limit;
            commits.truncate(limit);
            Json(GitLogResponse { commits, has_more }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_commit_diff(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<GitCommitDiffQuery>,
) -> Response {
    // 步骤1：校验提交 ID，并生成包含提交元数据和文件 Patch 的参数。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let commit = try_res!(validate_commit_hash(&query.commit));
    let mut arguments = vec![
        "show".to_string(),
        "--no-ext-diff".to_string(),
        "--no-color".to_string(),
        "--format=fuller".to_string(),
        "--find-renames".to_string(),
        commit,
    ];
    if let Some(path) = query.path.as_deref() {
        if !path.trim().is_empty() {
            let paths = try_res!(validate_git_paths(&root, &[path.to_string()]));
            arguments.push("--".to_string());
            arguments.push(paths[0].clone());
        }
    }

    // 步骤2：限制返回体大小并交给统一 Patch 查看器渲染。
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            if output.stdout.len() > MAX_GIT_DIFF_OUTPUT {
                return json_err(StatusCode::BAD_REQUEST, "commit diff too large to display");
            }
            let patch = String::from_utf8_lossy(&output.stdout).into_owned();
            Json(serde_json::json!({ "patch": patch })).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_compare(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<GitCompareQuery>,
) -> Response {
    // 步骤1：校验两个引用并统计各自独有的提交数量。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let base = try_res!(validate_git_name(&query.base, "base"));
    let target = try_res!(validate_git_name(&query.target, "target"));
    let comparison = format!("{base}...{target}");
    let count_arguments = vec![
        "rev-list".to_string(),
        "--left-right".to_string(),
        "--count".to_string(),
        comparison.clone(),
    ];
    let count_output = match run_git_output(root.clone(), count_arguments).await {
        Ok(output) if output.status.success() => output,
        Ok(output) => return git_command_response(&output),
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let count_text = String::from_utf8_lossy(&count_output.stdout);
    let mut counts = count_text.split_whitespace();
    let base_only = counts.next().and_then(|value| value.parse().ok()).unwrap_or(0);
    let target_only = counts.next().and_then(|value| value.parse().ok()).unwrap_or(0);

    // 步骤2：生成从共同祖先到目标分支的完整 Patch。
    let diff_arguments =
        vec!["diff".to_string(), "--no-ext-diff".to_string(), "--no-color".to_string(), comparison];
    match run_git_output(root, diff_arguments).await {
        Ok(output) if output.status.success() => {
            if output.stdout.len() > MAX_GIT_DIFF_OUTPUT {
                return json_err(StatusCode::BAD_REQUEST, "comparison too large to display");
            }
            let patch = String::from_utf8_lossy(&output.stdout).into_owned();
            Json(GitCompareResponse { base_only, target_only, patch }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_fetch(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：拉取全部远程引用并清理远程已删除的引用。
    let arguments = vec!["fetch".to_string(), "--prune".to_string()];
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_pull(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：只允许快进拉取，避免面板在用户不知情时创建合并提交。
    let arguments = vec!["pull".to_string(), "--ff-only".to_string()];
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_push(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：推送当前分支到已配置的上游分支。
    let arguments = vec!["push".to_string()];
    run_git_remote_command(&manager, &query, arguments).await
}

fn build_untracked_patch(path: &str, content: &str) -> String {
    // 步骤1：生成与 Git unified diff 一致的新增文件头部。
    let mut diff_text = format!("diff --git a/{path} b/{path}\n--- /dev/null\n+++ b/{path}\n");

    // 步骤2：补充标准 hunk 头，确保新增文件也能执行局部暂存。
    let line_count = content.lines().count();
    if line_count == 0 {
        return diff_text;
    }
    diff_text.push_str(&format!("@@ -0,0 +1,{line_count} @@\n"));

    // 步骤3：给每一行添加新增标记，供前端统一渲染。
    for line in content.lines() {
        diff_text.push('+');
        diff_text.push_str(line);
        diff_text.push('\n');
    }
    diff_text
}

fn extract_unified_diff_hunk(patch: &str, hunk_index: usize) -> Result<String, String> {
    // 步骤1：保留第一个 hunk 之前的文件头，Git 应用单个 hunk 时仍需要这些字段。
    let mut file_header = String::new();
    let mut selected_hunk = String::new();
    let mut current_hunk_index: Option<usize> = None;
    for line in patch.split_inclusive('\n') {
        if line.starts_with("@@ ") {
            let next_hunk_index = match current_hunk_index {
                Some(index) => index + 1,
                None => 0,
            };
            current_hunk_index = Some(next_hunk_index);
            if next_hunk_index > hunk_index {
                break;
            }
        }

        // 步骤2：只复制文件头和用户选择的 hunk，其他修改不能进入应用 Patch。
        match current_hunk_index {
            None => file_header.push_str(line),
            Some(index) if index == hunk_index => selected_hunk.push_str(line),
            Some(_) => {}
        }
    }
    if selected_hunk.is_empty() {
        return Err("hunk not found".to_string());
    }
    Ok(format!("{file_header}{selected_hunk}"))
}

async fn apply_unified_diff_hunk(
    root: PathBuf,
    patch: String,
    action: &str,
) -> Result<std::process::Output, String> {
    // 步骤1：把界面动作转换为固定 Git 参数，不接受任意命令选项。
    let mut arguments = vec![
        "apply".to_string(),
        "--recount".to_string(),
        "--whitespace=nowarn".to_string(),
    ];
    if action == "stage" || action == "unstage" {
        arguments.push("--cached".to_string());
    }
    if action == "unstage" || action == "discard" {
        arguments.push("--reverse".to_string());
    }
    if action != "stage" && action != "unstage" && action != "discard" {
        return Err("invalid hunk action".to_string());
    }

    // 步骤2：通过标准输入把选中的 Patch 交给 Git，避免 shell 解释文件内容。
    let result = tokio::task::spawn_blocking(move || {
        use std::io::Write;
        let mut child = git_command()
            .args(arguments)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(root)
            .spawn()?;
        let mut child_stdin = child
            .stdin
            .take()
            .ok_or_else(|| std::io::Error::other("git stdin unavailable"))?;
        child_stdin.write_all(patch.as_bytes())?;
        drop(child_stdin);
        child.wait_with_output()
    })
    .await;
    match result {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(error.to_string()),
        Err(error) => Err(error.to_string()),
    }
}

pub async fn workspace_git_hunk_action(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitHunkActionBody>,
) -> Response {
    // 步骤1：验证仓库、文件路径和动作与当前差异分组一致。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let paths = try_res!(validate_git_paths(&root, &[body.path]));
    let file_path = paths[0].clone();
    if body.action == "stage" && body.staged {
        return json_err(StatusCode::BAD_REQUEST, "cannot stage a staged hunk");
    }
    if body.action == "unstage" && !body.staged {
        return json_err(StatusCode::BAD_REQUEST, "cannot unstage a working tree hunk");
    }
    if body.action == "discard" && (body.staged || body.untracked) {
        return json_err(StatusCode::BAD_REQUEST, "cannot discard this hunk");
    }

    // 步骤2：从当前仓库重新生成完整 Patch，避免客户端提交任意文件内容。
    let full_patch = if body.untracked {
        let target = try_res!(normalize_join(&root, &file_path));
        let metadata = match std::fs::metadata(&target) {
            Ok(metadata) => metadata,
            Err(error) => return json_err(StatusCode::NOT_FOUND, &error.to_string()),
        };
        if metadata.len() > MAX_TEXT_PREVIEW as u64 {
            return json_err(StatusCode::BAD_REQUEST, "file too large for diff");
        }
        match std::fs::read_to_string(&target) {
            Ok(content) => build_untracked_patch(&file_path, &content),
            Err(error) => return json_err(StatusCode::BAD_REQUEST, &error.to_string()),
        }
    } else {
        let mut arguments = vec![
            "diff".to_string(),
            "--no-ext-diff".to_string(),
            "--no-color".to_string(),
        ];
        if body.staged {
            arguments.push("--cached".to_string());
        }
        if body.ignore_whitespace {
            arguments.push("--ignore-all-space".to_string());
        }
        arguments.push("--".to_string());
        arguments.push(file_path);
        match run_git_output(root.clone(), arguments).await {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout).into_owned()
            }
            Ok(output) => return git_command_response(&output),
            Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
        }
    };
    if full_patch.len() > MAX_GIT_DIFF_OUTPUT {
        return json_err(StatusCode::BAD_REQUEST, "diff too large to apply");
    }

    // 步骤3：只提取指定 hunk，并按暂存、取消暂存或撤销动作应用。
    let selected_patch = match extract_unified_diff_hunk(&full_patch, body.hunk_index) {
        Ok(patch) => patch,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    match apply_unified_diff_hunk(root, selected_patch, &body.action).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_unified_diff(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<GitUnifiedDiffQuery>,
) -> Response {
    // 步骤1：验证目标文件，并为未跟踪文本直接生成新增文件 diff。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
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
    if query.ignore_whitespace {
        arguments.push("--ignore-all-space".to_string());
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
    use super::{
        apply_unified_diff_hunk, build_branch_create_arguments, build_branch_switch_arguments,
        build_commit_arguments, build_remote_add_arguments, build_remote_delete_arguments,
        build_remote_update_arguments, build_upstream_set_arguments,
        build_upstream_unset_arguments, contains_conflict_markers, discover_git_repositories,
        clone_git_repository, extract_unified_diff_hunk, git_command, git_commit_matches_search,
        initialize_git_repository, parse_branch_output, parse_log_output, parse_remote_output,
        parse_stash_output, parse_status_output, parse_tag_output, read_conflict_stage,
        unstage_git_paths, validate_clone_directory, validate_clone_url, validate_initial_branch,
    };
    use std::path::Path;

    fn run_test_git(root: &Path, arguments: &[&str]) {
        // 步骤1：在临时仓库执行 Git 命令，并在失败时输出真实 stderr。
        let output = git_command().args(arguments).current_dir(root).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    }

    #[test]
    fn extracts_only_the_selected_unified_diff_hunk() {
        // 步骤1：准备包含两个修改区块的完整文件 Patch。
        let patch = "diff --git a/example.txt b/example.txt\nindex 1111111..2222222 100644\n--- a/example.txt\n+++ b/example.txt\n@@ -1,2 +1,2 @@\n-old one\n+new one\n context\n@@ -10,2 +10,2 @@\n-old two\n+new two\n context\n";

        // 步骤2：提取第二个区块，确认文件头被保留且第一个区块没有混入。
        let selected_patch = extract_unified_diff_hunk(patch, 1).unwrap();
        assert!(selected_patch.contains("diff --git a/example.txt b/example.txt"));
        assert!(selected_patch.contains("@@ -10,2 +10,2 @@"));
        assert!(selected_patch.contains("+new two"));
        assert!(!selected_patch.contains("+new one"));
    }

    #[test]
    fn rejects_missing_unified_diff_hunk() {
        // 步骤1：请求不存在的区块序号，避免后端把空 Patch 当成成功操作。
        let patch = "diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n+new\n";
        let result = extract_unified_diff_hunk(patch, 2);

        // 步骤2：确认调用方能收到明确错误并停止 Git 操作。
        assert_eq!(result.unwrap_err(), "hunk not found");
    }

    #[tokio::test]
    async fn stages_only_the_selected_hunk_in_a_real_repository() {
        // 步骤1：创建包含足够间隔行的临时仓库和基准提交。
        let temporary_directory = tempfile::tempdir().unwrap();
        run_test_git(temporary_directory.path(), &["init"]);
        run_test_git(temporary_directory.path(), &["config", "user.name", "Test User"]);
        run_test_git(
            temporary_directory.path(),
            &["config", "user.email", "test@example.com"],
        );
        let mut original_lines = Vec::new();
        for line_number in 1..=20 {
            original_lines.push(format!("line {line_number}"));
        }
        std::fs::write(
            temporary_directory.path().join("example.txt"),
            format!("{}\n", original_lines.join("\n")),
        )
        .unwrap();
        run_test_git(temporary_directory.path(), &["add", "example.txt"]);
        run_test_git(temporary_directory.path(), &["commit", "-m", "initial"]);

        // 步骤2：修改两个相距较远的位置，确保 Git 生成两个独立 hunk。
        let mut modified_lines = original_lines.clone();
        modified_lines[0] = "first changed".to_string();
        modified_lines[19] = "last changed".to_string();
        std::fs::write(
            temporary_directory.path().join("example.txt"),
            format!("{}\n", modified_lines.join("\n")),
        )
        .unwrap();
        let diff_output = git_command()
            .args(["diff", "--", "example.txt"])
            .current_dir(temporary_directory.path())
            .output()
            .unwrap();
        let full_patch = String::from_utf8_lossy(&diff_output.stdout).into_owned();

        // 步骤3：只暂存第一个 hunk，并检查暂存区与工作区分别保留正确修改。
        let selected_patch = extract_unified_diff_hunk(&full_patch, 0).unwrap();
        let apply_output = apply_unified_diff_hunk(
            temporary_directory.path().to_path_buf(),
            selected_patch,
            "stage",
        )
        .await
        .unwrap();
        assert!(apply_output.status.success());
        let staged_output = git_command()
            .args(["diff", "--cached", "--", "example.txt"])
            .current_dir(temporary_directory.path())
            .output()
            .unwrap();
        let staged_patch = String::from_utf8_lossy(&staged_output.stdout);
        assert!(staged_patch.contains("first changed"));
        assert!(!staged_patch.contains("last changed"));
        let working_output = git_command()
            .args(["diff", "--", "example.txt"])
            .current_dir(temporary_directory.path())
            .output()
            .unwrap();
        let working_patch = String::from_utf8_lossy(&working_output.stdout);
        assert!(!working_patch.contains("first changed"));
        assert!(working_patch.contains("last changed"));
    }

    #[tokio::test]
    async fn unstages_and_discards_only_the_selected_hunks() {
        // 步骤1：建立包含两个独立修改区块的临时仓库，并先暂存全部修改。
        let temporary_directory = tempfile::tempdir().unwrap();
        run_test_git(temporary_directory.path(), &["init"]);
        run_test_git(temporary_directory.path(), &["config", "user.name", "Test User"]);
        run_test_git(
            temporary_directory.path(),
            &["config", "user.email", "test@example.com"],
        );
        let mut original_lines = Vec::new();
        for line_number in 1..=20 {
            original_lines.push(format!("line {line_number}"));
        }
        let file_path = temporary_directory.path().join("example.txt");
        std::fs::write(&file_path, format!("{}\n", original_lines.join("\n"))).unwrap();
        run_test_git(temporary_directory.path(), &["add", "example.txt"]);
        run_test_git(temporary_directory.path(), &["commit", "-m", "initial"]);
        let mut modified_lines = original_lines.clone();
        modified_lines[0] = "first changed".to_string();
        modified_lines[19] = "last changed".to_string();
        std::fs::write(&file_path, format!("{}\n", modified_lines.join("\n"))).unwrap();
        run_test_git(temporary_directory.path(), &["add", "example.txt"]);

        // 步骤2：从暂存区反向应用第一个 hunk，确认只把第一处修改移回工作区。
        let staged_output = git_command()
            .args(["diff", "--cached", "--", "example.txt"])
            .current_dir(temporary_directory.path())
            .output()
            .unwrap();
        let staged_patch = String::from_utf8_lossy(&staged_output.stdout).into_owned();
        let selected_staged_patch = extract_unified_diff_hunk(&staged_patch, 0).unwrap();
        let unstage_output = apply_unified_diff_hunk(
            temporary_directory.path().to_path_buf(),
            selected_staged_patch,
            "unstage",
        )
        .await
        .unwrap();
        assert!(unstage_output.status.success());
        let remaining_staged_output = git_command()
            .args(["diff", "--cached", "--", "example.txt"])
            .current_dir(temporary_directory.path())
            .output()
            .unwrap();
        let remaining_staged_patch = String::from_utf8_lossy(&remaining_staged_output.stdout);
        assert!(!remaining_staged_patch.contains("first changed"));
        assert!(remaining_staged_patch.contains("last changed"));

        // 步骤3：撤销工作区中的第一个 hunk，确认文件恢复第一行但保留已暂存的末行修改。
        let working_output = git_command()
            .args(["diff", "--", "example.txt"])
            .current_dir(temporary_directory.path())
            .output()
            .unwrap();
        let working_patch = String::from_utf8_lossy(&working_output.stdout).into_owned();
        let selected_working_patch = extract_unified_diff_hunk(&working_patch, 0).unwrap();
        let discard_output = apply_unified_diff_hunk(
            temporary_directory.path().to_path_buf(),
            selected_working_patch,
            "discard",
        )
        .await
        .unwrap();
        assert!(discard_output.status.success());
        let final_content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(final_content.lines().next(), Some("line 1"));
        assert_eq!(final_content.lines().last(), Some("last changed"));
    }

    #[test]
    fn parses_branch_and_worktree_groups() {
        // 步骤1：准备同时包含暂存、未暂存、未跟踪和重命名状态的 Git 输出。
        let output = "## feature/git-panel...origin/feature/git-panel [ahead 2, behind 1]\n M src/main.rs\nM  staged.rs\nMM both.rs\n?? new file.txt\nR  old.txt -> new.txt\nUU conflict.txt\n";

        // 步骤2：解析输出并检查分支名称和每类文件状态。
        let parsed = parse_status_output(output);
        assert_eq!(parsed.branch.as_deref(), Some("feature/git-panel"));
        assert_eq!(parsed.upstream.as_deref(), Some("origin/feature/git-panel"));
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.behind, 1);
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
    fn truncates_large_status_lists_but_keeps_total_count() {
        // 步骤1：构造超过界面安全上限的文件状态输出。
        let mut output = String::from("## main\n");
        for index in 0..2005 {
            output.push_str(&format!(" M src/file-{index}.txt\n"));
        }

        // 步骤2：确认返回列表被截断，同时总数和截断标记保持准确。
        let parsed = parse_status_output(&output);
        assert_eq!(parsed.files.len(), 2000);
        assert_eq!(parsed.total_files, 2005);
        assert!(parsed.truncated);
    }

    #[test]
    fn parses_fetch_and_push_remote_urls() {
        // 步骤1：准备包含多个远程仓库和不同 fetch、push 地址的 Git 输出。
        let output = "origin\thttps://example.com/team/project.git (fetch)\norigin\tgit@example.com:team/project.git (push)\nbackup\thttps://backup.example.com/project.git (fetch)\nbackup\thttps://backup.example.com/project.git (push)\n";

        // 步骤2：确认每个远程仓库保留自己的拉取和推送地址。
        let remotes = parse_remote_output(output);
        assert_eq!(remotes.len(), 2);
        assert_eq!(remotes[0].name, "origin");
        assert_eq!(remotes[0].fetch_url, "https://example.com/team/project.git");
        assert_eq!(remotes[0].push_url, "git@example.com:team/project.git");
        assert_eq!(remotes[1].name, "backup");
    }

    #[test]
    fn parses_local_and_remote_branches() {
        // 步骤1：准备本地分支、当前分支、远程分支和远程 HEAD 引用。
        let output = "refs/heads/feature\0feature\0origin/feature\0 \nrefs/heads/main\0main\0origin/main\0*\nrefs/remotes/origin/HEAD\0origin/HEAD\0\0 \nrefs/remotes/origin/main\0origin/main\0\0 \n";

        // 步骤2：确认本地与远程分组正确，并忽略 remote HEAD 占位引用。
        let branches = parse_branch_output(output);
        assert_eq!(branches.local.len(), 2);
        assert_eq!(branches.remote.len(), 1);
        assert_eq!(branches.local[0].name, "feature");
        assert_eq!(branches.local[0].upstream.as_deref(), Some("origin/feature"));
        assert!(branches.local[1].current);
        assert_eq!(branches.remote[0].name, "origin/main");
    }

    #[test]
    fn parses_commit_log_records() {
        // 步骤1：准备两个由记录分隔符和 NUL 字段组成的提交日志。
        let output = "aaaaaaaa\0aaaaaaa\0Alice\0alice@example.com\02026-07-17T10:00:00+08:00\0bbbbbbbb cccccccc\0HEAD -> feature, tag: v1.0.0\0Add history view\x1ebbbbbbbb\0bbbbbbb\0Bob\0bob@example.com\02026-07-16T09:00:00+08:00\0\0main\0Initial commit\x1e";

        // 步骤2：确认作者、父提交和主题被完整解析。
        let commits = parse_log_output(output);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].hash, "aaaaaaaa");
        assert_eq!(commits[0].parents, vec!["bbbbbbbb", "cccccccc"]);
        assert_eq!(commits[0].decorations, vec!["HEAD -> feature", "tag: v1.0.0"]);
        assert_eq!(commits[0].subject, "Add history view");
        assert_eq!(commits[1].author_name, "Bob");
        assert!(commits[1].parents.is_empty());
    }

    #[test]
    fn searches_commits_by_hash_author_subject_and_reference() {
        // 步骤1：构造包含作者、说明和标签的提交记录。
        let commit = super::GitCommitSummary {
            hash: "abcdef1234567890".to_string(),
            short_hash: "abcdef1".to_string(),
            author_name: "Alice Zhang".to_string(),
            author_email: "alice@example.com".to_string(),
            authored_at: "2026-07-17T10:00:00+08:00".to_string(),
            parents: Vec::new(),
            decorations: vec!["tag: release-1".to_string()],
            subject: "Add graph history".to_string(),
        };

        // 步骤2：确认四类常用关键词均可命中，并且比较不区分大小写。
        assert!(git_commit_matches_search(&commit, "ABCDEF"));
        assert!(git_commit_matches_search(&commit, "alice zhang"));
        assert!(git_commit_matches_search(&commit, "GRAPH HISTORY"));
        assert!(git_commit_matches_search(&commit, "release-1"));
        assert!(!git_commit_matches_search(&commit, "missing"));
    }

    #[test]
    fn builds_branch_arguments_for_history_commits() {
        // 步骤1：历史检出必须使用 detached，避免把提交 hash 误当分支。
        let checkout_arguments = build_branch_switch_arguments("abcdef12", false, true);
        assert_eq!(checkout_arguments, vec!["switch", "--detach", "abcdef12"]);

        // 步骤2：从历史创建分支时把提交 hash 作为明确起点。
        let create_arguments =
            build_branch_create_arguments("feature/history", Some("abcdef12"));
        assert_eq!(create_arguments, vec!["switch", "-c", "feature/history", "abcdef12"]);
    }

    #[tokio::test]
    async fn reads_base_current_and_incoming_conflict_stages() {
        // 步骤1：建立两个分支并在同一行制造真实合并冲突。
        let temporary_directory = tempfile::tempdir().unwrap();
        run_test_git(temporary_directory.path(), &["init"]);
        run_test_git(temporary_directory.path(), &["config", "user.name", "Test User"]);
        run_test_git(
            temporary_directory.path(),
            &["config", "user.email", "test@example.com"],
        );
        let file_path = temporary_directory.path().join("conflict.txt");
        std::fs::write(&file_path, "base value\n").unwrap();
        run_test_git(temporary_directory.path(), &["add", "conflict.txt"]);
        run_test_git(temporary_directory.path(), &["commit", "-m", "base"]);
        let branch_output = git_command()
            .args(["branch", "--show-current"])
            .current_dir(temporary_directory.path())
            .output()
            .unwrap();
        let initial_branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();
        run_test_git(temporary_directory.path(), &["switch", "-c", "feature"]);
        std::fs::write(&file_path, "incoming value\n").unwrap();
        run_test_git(temporary_directory.path(), &["commit", "-am", "incoming"]);
        run_test_git(temporary_directory.path(), &["switch", &initial_branch]);
        std::fs::write(&file_path, "current value\n").unwrap();
        run_test_git(temporary_directory.path(), &["commit", "-am", "current"]);
        let merge_output = git_command()
            .args(["merge", "feature"])
            .current_dir(temporary_directory.path())
            .output()
            .unwrap();
        assert!(!merge_output.status.success());

        // 步骤2：从 Git index 三个 stage 读取 base、当前和传入版本。
        let base = read_conflict_stage(
            temporary_directory.path().to_path_buf(),
            1,
            "conflict.txt".to_string(),
        )
        .await
        .unwrap();
        let current = read_conflict_stage(
            temporary_directory.path().to_path_buf(),
            2,
            "conflict.txt".to_string(),
        )
        .await
        .unwrap();
        let incoming = read_conflict_stage(
            temporary_directory.path().to_path_buf(),
            3,
            "conflict.txt".to_string(),
        )
        .await
        .unwrap();
        assert_eq!(base.as_deref(), Some("base value\n"));
        assert_eq!(current.as_deref(), Some("current value\n"));
        assert_eq!(incoming.as_deref(), Some("incoming value\n"));
    }

    #[test]
    fn detects_remaining_conflict_marker_lines() {
        // 步骤1：只有完整标记行触发保护，普通代码中的等号不应误报。
        assert!(contains_conflict_markers("before\n<<<<<<< HEAD\nvalue\n"));
        assert!(contains_conflict_markers("value\n=======\nother\n"));
        assert!(contains_conflict_markers("value\n>>>>>>> feature\n"));
        assert!(!contains_conflict_markers("let value = '=======';\n"));
    }

    #[tokio::test]
    async fn initializes_and_clones_real_repositories() {
        // 步骤1：初始化指定目录并确认初始分支名称。
        let workspace_directory = tempfile::tempdir().unwrap();
        let initialized_root = workspace_directory.path().join("initialized");
        std::fs::create_dir_all(&initialized_root).unwrap();
        let init_output =
            initialize_git_repository(initialized_root.clone(), "develop".to_string())
                .await
                .unwrap();
        assert!(init_output.status.success());
        let branch_output = git_command()
            .args(["branch", "--show-current"])
            .current_dir(&initialized_root)
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&branch_output.stdout).trim(), "develop");

        // 步骤2：创建本地源仓库，再通过与远程相同的 clone 流程复制到工作区。
        let source_directory = tempfile::tempdir().unwrap();
        run_test_git(source_directory.path(), &["init"]);
        run_test_git(source_directory.path(), &["config", "user.name", "Test User"]);
        run_test_git(
            source_directory.path(),
            &["config", "user.email", "test@example.com"],
        );
        std::fs::write(source_directory.path().join("README.md"), "source\n").unwrap();
        run_test_git(source_directory.path(), &["add", "README.md"]);
        run_test_git(source_directory.path(), &["commit", "-m", "initial"]);
        let cloned_root = workspace_directory.path().join("cloned");
        let clone_output = clone_git_repository(
            workspace_directory.path().to_path_buf(),
            source_directory.path().to_string_lossy().into_owned(),
            cloned_root.clone(),
        )
        .await
        .unwrap();
        assert!(clone_output.status.success());
        assert!(cloned_root.join(".git").is_dir());
        let cloned_content = std::fs::read_to_string(cloned_root.join("README.md")).unwrap();
        assert_eq!(cloned_content.trim(), "source");
    }

    #[test]
    fn validates_repository_setup_inputs() {
        // 步骤1：允许常规分支、远程地址和单层工作区子目录。
        assert_eq!(validate_initial_branch("main").unwrap(), "main");
        assert_eq!(validate_clone_url("https://example.com/team/app.git").unwrap(), "https://example.com/team/app.git");
        assert_eq!(validate_clone_directory("app").unwrap(), "app");

        // 步骤2：拒绝空值、Git 选项注入和任何可能逃离工作区的目录。
        assert!(validate_initial_branch("-main").is_err());
        assert!(validate_clone_url("").is_err());
        assert!(validate_clone_url("--upload-pack=program").is_err());
        assert!(validate_clone_directory("").is_err());
        assert!(validate_clone_directory("../outside").is_err());
        assert!(validate_clone_directory("nested/repository").is_err());
        assert!(validate_clone_directory("C:\\outside").is_err());
    }

    #[test]
    fn builds_remote_and_upstream_management_arguments() {
        // 步骤1：Remote 新增、修改和删除只生成固定子命令与经过验证的值。
        assert_eq!(
            build_remote_add_arguments("mirror", "https://example.com/project.git"),
            vec!["remote", "add", "mirror", "https://example.com/project.git"]
        );
        assert_eq!(
            build_remote_update_arguments(
                "origin",
                "upstream",
                "https://example.com/upstream.git",
                "git@example.com:upstream.git"
            ),
            vec![
                vec!["remote", "rename", "origin", "upstream"],
                vec!["remote", "set-url", "upstream", "https://example.com/upstream.git"],
                vec![
                    "remote",
                    "set-url",
                    "--push",
                    "upstream",
                    "git@example.com:upstream.git"
                ],
            ]
        );
        assert_eq!(build_remote_delete_arguments("backup"), vec!["remote", "remove", "backup"]);

        // 步骤2：Upstream 设置和取消明确包含本地分支，避免误改当前 HEAD 之外的引用。
        assert_eq!(
            build_upstream_set_arguments("origin", "main", "release"),
            vec!["branch", "--set-upstream-to=origin/release", "main"]
        );
        assert_eq!(
            build_upstream_unset_arguments("main"),
            vec!["branch", "--unset-upstream", "main"]
        );
    }

    #[test]
    fn parses_stash_records() {
        // 步骤1：准备两条带引用、对象 ID、时间和说明的 stash 记录。
        let output = "stash@{0}\0aaaaaaaa\02026-07-17T11:00:00+08:00\0On main: work in progress\x1estash@{1}\0bbbbbbbb\02026-07-16T10:00:00+08:00\0On feature: before switch\x1e";

        // 步骤2：确认引用、说明和时间字段完整保留。
        let stashes = parse_stash_output(output);
        assert_eq!(stashes.len(), 2);
        assert_eq!(stashes[0].reference, "stash@{0}");
        assert_eq!(stashes[0].message, "On main: work in progress");
        assert_eq!(stashes[1].hash, "bbbbbbbb");
    }

    #[test]
    fn parses_tag_records() {
        // 步骤1：准备两个包含对象 ID、创建时间和主题的标签记录。
        let output = "v1.2.0\0aaaaaaaa\02026-07-17 11:00:00 +0800\0Release 1.2.0\nv1.1.0\0bbbbbbbb\02026-07-16 10:00:00 +0800\0Release 1.1.0\n";

        // 步骤2：确认标签字段按行和 NUL 正确解析。
        let tags = parse_tag_output(output);
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].name, "v1.2.0");
        assert_eq!(tags[0].target, "aaaaaaaa");
        assert_eq!(tags[1].subject, "Release 1.1.0");
    }

    #[test]
    fn discovers_nested_repositories_and_skips_dependency_directories() {
        // 步骤1：创建根仓库、嵌套仓库和应跳过的 node_modules 仓库。
        let temporary_directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(temporary_directory.path().join(".git")).unwrap();
        std::fs::create_dir_all(temporary_directory.path().join("packages/app/.git")).unwrap();
        std::fs::create_dir_all(temporary_directory.path().join("node_modules/vendor/.git"))
            .unwrap();

        // 步骤2：确认只返回根仓库和正常嵌套仓库。
        let repositories = discover_git_repositories(temporary_directory.path());
        assert_eq!(repositories.len(), 2);
        assert_eq!(repositories[0].path, "");
        assert_eq!(repositories[1].path, "packages/app");
    }

    #[test]
    fn builds_amend_and_signoff_commit_arguments() {
        // 步骤1：同时启用修订提交和 Signed-off-by。
        let arguments = build_commit_arguments("Update history", true, true);

        // 步骤2：确认两个开关与提交说明都作为独立参数传递。
        assert_eq!(arguments, vec!["commit", "--amend", "--signoff", "-m", "Update history"]);
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

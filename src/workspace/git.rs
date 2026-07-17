use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::{platform::process::CommandNoWindowExt, session::SessionManager};

use super::{
    get_root, json_err, normalize_join, path_must_be_under, PanePathQuery, PaneQuery,
    MAX_TEXT_PREVIEW,
};

const MAX_GIT_DIFF_OUTPUT: usize = 2 * 1024 * 1024;
const MAX_GIT_BLAME_OUTPUT: usize = 16 * 1024 * 1024;
const MAX_GIT_STATUS_FILES: usize = 2000;
const MAX_DISCOVERED_REPOSITORIES: usize = 100;
const MAX_REPOSITORY_SCAN_DEPTH: usize = 4;
const MAX_GIT_BACKUP_BYTES: u64 = 512 * 1024 * 1024;

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
    command.env("LC_ALL", "C");
    command.env("GIT_TERMINAL_PROMPT", "0");
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
pub struct GitSyncPreviewResponse {
    pub incoming: Vec<GitCommitSummary>,
    pub outgoing: Vec<GitCommitSummary>,
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
    pub target: Option<String>,
    pub progress_current: Option<u32>,
    pub progress_total: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitReflogEntry {
    pub selector: String,
    pub hash: String,
    pub short_hash: String,
    pub action: String,
    pub message: String,
    pub authored_at: String,
}

#[derive(Debug, Serialize)]
pub struct GitReflogResponse {
    pub entries: Vec<GitReflogEntry>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct GitConfigValues {
    pub user_name: String,
    pub user_email: String,
    pub credential_helper: String,
    pub default_branch: String,
    pub gpg_sign: bool,
    pub signing_key: String,
}

#[derive(Debug, Serialize)]
pub struct GitConfigResponse {
    pub local: GitConfigValues,
    pub global: GitConfigValues,
}

#[derive(Debug, Deserialize)]
pub struct GitConfigUpdateBody {
    pub scope: String,
    pub user_name: String,
    pub user_email: String,
    pub credential_helper: String,
    pub default_branch: String,
    pub gpg_sign: bool,
    pub signing_key: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitDiagnosticTool {
    pub name: String,
    pub available: bool,
    pub version: String,
}

#[derive(Debug, Serialize)]
pub struct GitDiagnosticsResponse {
    pub tools: Vec<GitDiagnosticTool>,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitCommandRecord {
    pub id: String,
    pub command: String,
    pub status: String,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub output: String,
    #[serde(skip)]
    root: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct GitCommandLogResponse {
    pub commands: Vec<GitCommandRecord>,
}

#[derive(Debug, Deserialize)]
pub struct GitCommandCancelBody {
    pub id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitBlameLine {
    pub line_number: usize,
    pub content: String,
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: u64,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct GitBlameResponse {
    pub path: String,
    pub lines: Vec<GitBlameLine>,
}

#[derive(Debug, Serialize)]
pub struct GitIgnoreResponse {
    pub content: String,
    pub exists: bool,
}

#[derive(Debug, Deserialize)]
pub struct GitIgnoreUpdateBody {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct GitIgnoreAddBody {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct GitCleanPreviewResponse {
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct GitCleanBody {
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitWorktreeEntry {
    pub path: String,
    pub head: String,
    pub branch: String,
    pub detached: bool,
    pub locked: bool,
    pub prunable: bool,
    pub dirty: bool,
    pub current: bool,
}

#[derive(Debug, Serialize)]
pub struct GitWorktreesResponse {
    pub worktrees: Vec<GitWorktreeEntry>,
}

#[derive(Debug, Deserialize)]
pub struct GitWorktreeCreateBody {
    pub directory: String,
    #[serde(default)]
    pub branch: String,
    #[serde(default)]
    pub start_point: String,
}

#[derive(Debug, Deserialize)]
pub struct GitWorktreeRemoveBody {
    pub path: String,
    #[serde(default)]
    pub force: bool,
    #[serde(default)]
    pub confirm_force: bool,
}

#[derive(Debug, Deserialize)]
pub struct GitWorktreeActionBody {
    pub action: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub target: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitSubmoduleEntry {
    pub path: String,
    pub commit: String,
    pub status: String,
    pub description: String,
}

#[derive(Debug, Serialize)]
pub struct GitSubmodulesResponse {
    pub submodules: Vec<GitSubmoduleEntry>,
}

#[derive(Debug, Deserialize)]
pub struct GitSubmoduleUpdateBody {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub initialize: bool,
    #[serde(default)]
    pub recursive: bool,
    #[serde(default)]
    pub remote: bool,
}

#[derive(Debug, Deserialize)]
pub struct GitSubmoduleAddBody {
    pub url: String,
    pub path: String,
    #[serde(default)]
    pub branch: String,
}

#[derive(Debug, Deserialize)]
pub struct GitSubmoduleActionBody {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub confirm: bool,
}

#[derive(Debug, Serialize)]
pub struct GitLfsTrackResponse {
    pub patterns: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GitBackupEntry {
    pub name: String,
    pub reason: String,
    pub created_at: u64,
    pub paths: Vec<String>,
    #[serde(default)]
    pub missing_paths: Vec<String>,
    pub size: u64,
}

#[derive(Debug, Serialize)]
pub struct GitBackupsResponse {
    pub backups: Vec<GitBackupEntry>,
}

#[derive(Debug, Deserialize)]
pub struct GitBackupActionBody {
    pub name: String,
    #[serde(default)]
    pub confirm: bool,
}

#[derive(Debug, Deserialize)]
pub struct GitLfsTrackBody {
    pub pattern: String,
}

#[derive(Debug, Deserialize)]
pub struct GitLfsPushBody {
    pub remote: String,
    #[serde(default)]
    pub reference: String,
    #[serde(default)]
    pub all: bool,
}

#[derive(Debug, Deserialize)]
pub struct GitLfsLockBody {
    pub path: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitLfsLockEntry {
    pub id: String,
    pub path: String,
    pub owner: String,
}

#[derive(Debug, Serialize)]
pub struct GitLfsLocksResponse {
    pub locks: Vec<GitLfsLockEntry>,
}

#[derive(Debug, Deserialize)]
pub struct GitRemoteTagsQuery {
    pub pane_id: String,
    #[serde(default)]
    pub repository: Option<String>,
    pub remote: String,
}

#[derive(Debug, Deserialize)]
pub struct GitRemoteTagActionBody {
    pub remote: String,
    pub tag: String,
}

#[derive(Debug, Deserialize)]
pub struct GitBisectBody {
    pub action: String,
    #[serde(default)]
    pub revision: String,
}

#[derive(Debug, Deserialize)]
pub struct GitPatchApplyBody {
    pub patch: String,
    #[serde(default)]
    pub check: bool,
    #[serde(default)]
    pub three_way: bool,
}

#[derive(Debug, Deserialize)]
pub struct GitRemoteTagDeleteBody {
    pub remote: String,
    pub tag: String,
}

struct GitCommandCancellation {
    id: String,
    root: PathBuf,
    requested: Arc<AtomicBool>,
}

#[derive(Default)]
struct GitCommandTracker {
    records: VecDeque<GitCommandRecord>,
    cancellations: Vec<GitCommandCancellation>,
}

static GIT_COMMAND_TRACKER: OnceLock<Mutex<GitCommandTracker>> = OnceLock::new();
static GIT_REPOSITORY_OPERATION_LOCKS: OnceLock<
    Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>,
> = OnceLock::new();

fn git_operation_lock_key(root: &Path) -> PathBuf {
    // 步骤1：普通仓库直接使用 .git 目录，避免同一路径的不同文本写法产生多把锁。
    let dot_git_path = root.join(".git");
    if dot_git_path.is_dir() {
        return dot_git_path.canonicalize().unwrap_or(dot_git_path);
    }

    // 步骤2：链接 Worktree 的 .git 是指针文件，向上解析到共享的公共 Git 目录。
    if dot_git_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&dot_git_path) {
            if let Some(raw_git_directory) = content.trim().strip_prefix("gitdir:") {
                let raw_git_directory = raw_git_directory.trim();
                let git_directory_path = PathBuf::from(raw_git_directory);
                let git_directory = if git_directory_path.is_absolute() {
                    git_directory_path
                } else {
                    root.join(git_directory_path)
                };
                let git_directory = git_directory.canonicalize().unwrap_or(git_directory);
                if let Some(worktrees_directory) = git_directory.parent() {
                    if worktrees_directory.file_name().and_then(|name| name.to_str())
                        == Some("worktrees")
                    {
                        if let Some(common_directory) = worktrees_directory.parent() {
                            return common_directory.to_path_buf();
                        }
                    }
                }
                return git_directory;
            }
        }
    }

    // 步骤3：初始化前等没有 .git 的目录退回工作目录本身。
    root.canonicalize().unwrap_or_else(|_| root.to_path_buf())
}

fn git_repository_operation_lock(root: &Path) -> Arc<tokio::sync::Mutex<()>> {
    // 步骤1：使用 Git 公共目录作为键，使主工作树和链接 Worktree 共享同一把锁。
    let lock_root = git_operation_lock_key(root);
    let locks = GIT_REPOSITORY_OPERATION_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(lock) = locks.get(&lock_root) {
        return lock.clone();
    }

    // 步骤2：不同仓库建立独立异步锁，读取操作不受影响。
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    locks.insert(lock_root, lock.clone());
    lock
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
    if !repository_root.is_dir() || !repository_root.join(".git").exists() {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid repository"));
    }
    let repository_root = match repository_root.canonicalize() {
        Ok(path) => path,
        Err(_) => return Err(json_err(StatusCode::BAD_REQUEST, "invalid repository")),
    };
    let workspace_root = workspace_root.canonicalize().unwrap_or(workspace_root);
    if repository_root == workspace_root || !repository_root.starts_with(&workspace_root) {
        return Err(json_err(StatusCode::FORBIDDEN, "repository outside workspace"));
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
    let arguments =
        vec!["init".to_string(), "--initial-branch".to_string(), initial_branch, ".".to_string()];
    run_git_tracked_output(root, arguments).await
}

async fn clone_git_repository(
    workspace_root: PathBuf,
    url: String,
    destination: PathBuf,
) -> Result<std::process::Output, String> {
    // 步骤1：使用 -- 结束选项解析，并让 Git 在工作区内创建目标目录。
    let destination_argument = match destination.strip_prefix(&workspace_root) {
        Ok(relative_destination) => relative_destination.to_string_lossy().into_owned(),
        Err(_) => destination.to_string_lossy().into_owned(),
    };
    let arguments = vec![
        "clone".to_string(),
        "--progress".to_string(),
        "--".to_string(),
        url,
        destination_argument,
    ];
    run_git_tracked_output(workspace_root, arguments).await
}

fn cleanup_incomplete_clone(destination: &Path) -> Result<(), String> {
    // 步骤1：只清理由本次克隆新建的目标，符号链接本身删除但不跟随其目标。
    let metadata = match std::fs::symlink_metadata(destination) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() || metadata.is_file() {
        std::fs::remove_file(destination).map_err(|error| error.to_string())
    } else {
        std::fs::remove_dir_all(destination).map_err(|error| error.to_string())
    }
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
    match clone_git_repository(root, url, destination.clone()).await {
        Ok(output) if output.status.success() => repository_setup_response(&output, &directory),
        Ok(output) => {
            let _ = cleanup_incomplete_clone(&destination);
            repository_setup_response(&output, &directory)
        }
        Err(error) => {
            let _ = cleanup_incomplete_clone(&destination);
            json_err(StatusCode::INTERNAL_SERVER_ERROR, &error)
        }
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
    // 步骤1：优先读取 NUL 记录，文件名中的换行、引号和箭头保持原文。
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();
    let mut total_files = 0;
    let nul_records = output.contains('\0');
    let mut skip_rename_source = false;
    let records: Vec<&str> =
        if nul_records { output.split('\0').collect() } else { output.lines().collect() };
    for record in records {
        if record.is_empty() {
            continue;
        }
        if skip_rename_source {
            skip_rename_source = false;
            continue;
        }
        if record.starts_with("## ") {
            let branch_status = parse_branch_line(record);
            branch = branch_status.branch;
            upstream = branch_status.upstream;
            ahead = branch_status.ahead;
            behind = branch_status.behind;
            continue;
        }
        if record.len() < 4 {
            continue;
        }
        let mut status_characters = record.chars();
        let index_status = status_characters.next().unwrap_or(' ');
        let worktree_status = status_characters.next().unwrap_or(' ');
        let Some(raw_path) = record.get(3..) else { continue };
        let path = if nul_records {
            raw_path.to_string()
        } else {
            let path_without_quotes = raw_path.trim_matches('"');
            path_without_quotes.split(" -> ").last().unwrap_or(path_without_quotes).to_string()
        };
        if nul_records && (index_status == 'R' || index_status == 'C') {
            skip_rename_source = true;
        }

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

fn parse_reflog_output(output: &str) -> Vec<GitReflogEntry> {
    // 步骤1：按记录分隔符和 NUL 字段读取 Reflog，避免说明文字中的空格干扰解析。
    let mut entries = Vec::new();
    for record in output.split('\x1e') {
        let record = record.trim_matches(['\r', '\n']);
        if record.is_empty() {
            continue;
        }
        let columns: Vec<&str> = record.split('\0').collect();
        if columns.len() < 5 {
            continue;
        }

        // 步骤2：把 Git 主题中的动作前缀与说明拆开，未知格式保留完整说明。
        let subject = columns[3].trim();
        let mut action = subject.to_string();
        let mut message = String::new();
        if let Some(separator_index) = subject.find(": ") {
            action = subject[..separator_index].to_string();
            message = subject[separator_index + 2..].to_string();
        }
        entries.push(GitReflogEntry {
            selector: columns[0].to_string(),
            hash: columns[1].to_string(),
            short_hash: columns[2].to_string(),
            action,
            message,
            authored_at: columns[4].to_string(),
        });
    }
    entries
}

fn parse_git_config_output(output: &str) -> GitConfigValues {
    // 步骤1：每条配置使用 NUL 结尾，键和值由 Git 固定使用换行分隔。
    let mut configuration = GitConfigValues::default();
    for record in output.split('\0') {
        let Some((raw_key, raw_value)) = record.split_once('\n') else { continue };
        let key = raw_key.trim().to_lowercase();
        let value = raw_value.trim().to_string();
        if key == "user.name" {
            configuration.user_name = value;
        } else if key == "user.email" {
            configuration.user_email = value;
        } else if key == "credential.helper" {
            configuration.credential_helper = value;
        } else if key == "init.defaultbranch" {
            configuration.default_branch = value;
        } else if key == "commit.gpgsign" {
            configuration.gpg_sign = value.eq_ignore_ascii_case("true");
        } else if key == "user.signingkey" {
            configuration.signing_key = value;
        }
    }
    configuration
}

fn validate_git_config_text(value: &str, label: &str) -> Result<String, String> {
    // 步骤1：配置值允许空白以表示取消，但拒绝控制字符和过长内容。
    let value = value.trim();
    if value.len() > 500 || value.chars().any(char::is_control) {
        return Err(format!("invalid {label}"));
    }
    Ok(value.to_string())
}

fn build_git_config_command(scope_argument: &str, key: &str, value: &str) -> Vec<String> {
    // 步骤1：空值转换为取消配置，非空值替换该白名单键的全部旧值。
    if value.is_empty() {
        return vec![
            "config".to_string(),
            scope_argument.to_string(),
            "--unset-all".to_string(),
            key.to_string(),
        ];
    }
    vec![
        "config".to_string(),
        scope_argument.to_string(),
        "--replace-all".to_string(),
        key.to_string(),
        value.to_string(),
    ]
}

fn build_git_config_update_commands(
    body: &GitConfigUpdateBody,
) -> Result<Vec<Vec<String>>, String> {
    // 步骤1：把明确作用域转换为固定参数，拒绝任意 scope 注入。
    let scope_argument = if body.scope == "local" {
        "--local"
    } else if body.scope == "global" {
        "--global"
    } else {
        return Err("invalid git config scope".to_string());
    };

    // 步骤2：逐个校验界面管理的固定配置值。
    let user_name = validate_git_config_text(&body.user_name, "user name")?;
    let user_email = validate_git_config_text(&body.user_email, "user email")?;
    let credential_helper = validate_git_config_text(&body.credential_helper, "credential helper")?;
    let default_branch = if body.default_branch.trim().is_empty() {
        String::new()
    } else {
        validate_initial_branch(&body.default_branch)?
    };
    let signing_key = validate_git_config_text(&body.signing_key, "signing key")?;

    // 步骤3：只生成六个白名单键的命令，布尔值始终显式写入。
    let mut commands = Vec::new();
    commands.push(build_git_config_command(scope_argument, "user.name", &user_name));
    commands.push(build_git_config_command(scope_argument, "user.email", &user_email));
    commands.push(build_git_config_command(
        scope_argument,
        "credential.helper",
        &credential_helper,
    ));
    commands.push(build_git_config_command(scope_argument, "init.defaultbranch", &default_branch));
    commands.push(build_git_config_command(
        scope_argument,
        "commit.gpgsign",
        if body.gpg_sign { "true" } else { "false" },
    ));
    commands.push(build_git_config_command(scope_argument, "user.signingkey", &signing_key));
    Ok(commands)
}

async fn read_git_config_scope(
    root: PathBuf,
    scope_argument: &str,
) -> Result<GitConfigValues, String> {
    // 步骤1：读取指定作用域的原始 NUL 配置，再转换为固定响应结构。
    let arguments = vec![
        "config".to_string(),
        scope_argument.to_string(),
        "--null".to_string(),
        "--list".to_string(),
    ];
    let output = run_git_output(root, arguments).await?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_git_config_output(&stdout))
}

fn run_git_diagnostic_tool(
    root: &Path,
    name: &str,
    program: &str,
    arguments: &[&str],
) -> GitDiagnosticTool {
    // 步骤1：禁用窗口并捕获版本输出，缺失程序直接标记为不可用。
    let mut command = std::process::Command::new(program);
    command.no_window();
    command
        .args(arguments)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => {
            return GitDiagnosticTool {
                name: name.to_string(),
                available: false,
                version: String::new(),
            };
        }
    };

    // 步骤2：版本命令最多等待三秒，避免损坏的外部工具卡住面板。
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return GitDiagnosticTool {
                    name: name.to_string(),
                    available: false,
                    version: String::new(),
                };
            }
        }
    }
    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(_) => {
            return GitDiagnosticTool {
                name: name.to_string(),
                available: false,
                version: String::new(),
            };
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let version_text = if stdout.trim().is_empty() { stderr.trim() } else { stdout.trim() };
    let version = version_text.lines().next().unwrap_or("").to_string();
    GitDiagnosticTool { name: name.to_string(), available: output.status.success(), version }
}

fn read_git_state_text(path: &Path) -> Option<String> {
    // 步骤1：读取 Git 操作状态文件，空值或读取失败都视为没有该字段。
    let content = std::fs::read_to_string(path).ok()?;
    let value = content.trim();
    if value.is_empty() {
        return None;
    }
    Some(value.to_string())
}

fn read_git_state_number(path: &Path) -> Option<u32> {
    // 步骤1：操作进度只接受 Git 写入的无符号整数。
    let value = read_git_state_text(path)?;
    value.parse().ok()
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
                "-z",
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
    pub content_version: Option<String>,
}

fn git_content_version(content: &str) -> String {
    // 步骤1：为差异对应的工作区内容生成稳定版本，用于拒绝过期撤销请求。
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn resolve_git_file_context(
    workspace_root: &Path,
    requested_path: &str,
) -> Result<(PathBuf, String), String> {
    // 步骤1：限制文件位于 Pane 工作区内，并从文件父目录查找最近的 Git 仓库。
    let relative_path = requested_path.trim().trim_start_matches('/');
    if relative_path.is_empty() {
        return Err("path required".to_string());
    }
    let target = normalize_join(workspace_root, relative_path)
        .map_err(|response| format!("invalid path: {}", response.status()))?;
    let search_directory = if target.is_dir() {
        target.clone()
    } else {
        target.parent().unwrap_or(workspace_root).to_path_buf()
    };
    let output = git_command()
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(search_directory)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(git_command_error_message(&output.stdout, &output.stderr));
    }

    // 步骤2：规范化三个路径，确认最近仓库没有越出当前工作区。
    let git_root_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let git_root = PathBuf::from(git_root_text);
    let canonical_workspace = workspace_root.canonicalize().map_err(|error| error.to_string())?;
    let canonical_git_root = git_root.canonicalize().map_err(|error| error.to_string())?;
    let canonical_target = target.canonicalize().unwrap_or(target);
    if !canonical_git_root.starts_with(&canonical_workspace)
        || !canonical_target.starts_with(&canonical_git_root)
    {
        return Err("git file is outside workspace".to_string());
    }
    let repository_path = canonical_target
        .strip_prefix(&canonical_git_root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok((canonical_git_root, repository_path))
}

pub async fn workspace_git_diff(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
) -> impl IntoResponse {
    let no_git = || {
        Json(GitDiffResponse {
            is_git_repo: false,
            original_content: None,
            changes: vec![],
            content_version: None,
        })
        .into_response()
    };
    let workspace_root = try_res!(get_root(&manager, &q.pane_id));
    let (root, rel) = match resolve_git_file_context(&workspace_root, &q.path) {
        Ok(context) => context,
        Err(_) => return no_git(),
    };
    let target = root.join(&rel);
    let original = tokio::task::spawn_blocking({
        let root = root.clone();
        let rel = rel.clone();
        move || git_command().args(["show", &format!("HEAD:{rel}")]).current_dir(&root).output()
    })
    .await;
    let original_content = match original {
        Ok(Ok(o)) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => return no_git(),
    };
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

    let content_version = Some(git_content_version(&current));
    Json(GitDiffResponse {
        is_git_repo: true,
        original_content: Some(original_content),
        changes,
        content_version,
    })
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
    let workspace_root = try_res!(get_root(&manager, &q.pane_id));
    let (root, rel) = match resolve_git_file_context(&workspace_root, &q.path) {
        Ok(context) => context,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    let target = root.join(&rel);
    let original_out = tokio::task::spawn_blocking({
        let root = root.clone();
        let rel = rel.clone();
        move || git_command().args(["show", &format!("HEAD:{rel}")]).current_dir(&root).output()
    })
    .await;
    let original = match original_out {
        Ok(Ok(o)) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => String::new(),
    };
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
    let arguments = vec!["apply".to_string(), "--cached".to_string(), "--unidiff-zero".to_string()];
    match run_git_tracked_output_with_input(root, arguments, patch.into_bytes()).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

#[derive(Deserialize)]
pub struct GitRevertBody {
    pub start_line: usize,
    pub end_line: usize,
    pub content_version: String,
}

fn build_reverted_content(
    original: &str,
    current: &str,
    start_line: usize,
    end_line: usize,
) -> Result<String, String> {
    // 步骤1：请求必须命中一个完整差异块，禁止用过期行号修改相邻内容。
    if start_line == 0 || end_line < start_line {
        return Err("invalid line range".to_string());
    }
    let original_lines: Vec<&str> = original.lines().collect();
    let current_lines: Vec<&str> = current.lines().collect();
    let diff = similar::TextDiff::from_slices(&original_lines, &current_lines);
    let mut result_lines = Vec::new();
    let mut modified_line = 1usize;
    let mut matched = false;
    for operation in diff.ops() {
        match operation {
            similar::DiffOp::Equal { new_index, len, .. } => {
                for offset in 0..*len {
                    result_lines.push(current_lines[new_index + offset].to_string());
                }
                modified_line += len;
            }
            similar::DiffOp::Insert { new_index, new_len, .. } => {
                let operation_end = modified_line + new_len - 1;
                if modified_line == start_line && operation_end == end_line {
                    matched = true;
                } else {
                    for offset in 0..*new_len {
                        result_lines.push(current_lines[new_index + offset].to_string());
                    }
                }
                modified_line += new_len;
            }
            similar::DiffOp::Delete { old_index, old_len, .. } => {
                if modified_line == start_line && modified_line == end_line {
                    for offset in 0..*old_len {
                        result_lines.push(original_lines[old_index + offset].to_string());
                    }
                    matched = true;
                }
            }
            similar::DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                let operation_end = modified_line + new_len - 1;
                if modified_line == start_line && operation_end == end_line {
                    for offset in 0..*old_len {
                        result_lines.push(original_lines[old_index + offset].to_string());
                    }
                    matched = true;
                } else {
                    for offset in 0..*new_len {
                        result_lines.push(current_lines[new_index + offset].to_string());
                    }
                }
                modified_line += new_len;
            }
        }
    }
    if !matched {
        return Err("stale line range".to_string());
    }

    // 步骤2：恢复文件原有的末尾换行约定。
    let mut result = result_lines.join("\n");
    if !result.is_empty() && (current.ends_with('\n') || original.ends_with('\n')) {
        result.push('\n');
    }
    Ok(result)
}

pub async fn workspace_git_revert_lines(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<GitRevertBody>,
) -> impl IntoResponse {
    let workspace_root = try_res!(get_root(&manager, &q.pane_id));
    let (root, rel) = match resolve_git_file_context(&workspace_root, &q.path) {
        Ok(context) => context,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    let target = root.join(&rel);
    let current = match std::fs::read_to_string(&target) {
        Ok(c) => c,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if git_content_version(&current) != body.content_version {
        return json_err(StatusCode::CONFLICT, "file changed; refresh diff");
    }
    let revision = format!("HEAD:{rel}");
    let original_arguments = vec!["show".to_string(), revision];
    let original_output = match run_git_output(root.clone(), original_arguments).await {
        Ok(output) if output.status.success() => output,
        Ok(output) => return git_command_response(&output),
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let original = String::from_utf8_lossy(&original_output.stdout);
    let write_content =
        match build_reverted_content(&original, &current, body.start_line, body.end_line) {
            Ok(content) => content,
            Err(error) => return json_err(StatusCode::CONFLICT, &error),
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
    #[serde(default)]
    pub keep_index: bool,
    #[serde(default)]
    pub staged_only: bool,
    #[serde(default)]
    pub paths: Vec<String>,
}

#[derive(Deserialize)]
pub struct GitStashReferenceBody {
    pub reference: String,
}

#[derive(Deserialize)]
pub struct GitStashDiffQuery {
    pub pane_id: String,
    #[serde(default)]
    pub repository: Option<String>,
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
pub struct GitCherryPickBody {
    #[serde(default)]
    pub commit: Option<String>,
    #[serde(default)]
    pub commits: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GitRebasePlanEntry {
    pub commit: String,
    pub action: String,
    #[serde(default)]
    pub message: String,
}

impl GitRebasePlanEntry {
    #[cfg(test)]
    fn new(commit: String, action: &str, message: &str) -> Self {
        // 步骤1：测试使用直白构造器建立历史重写计划项。
        Self { commit, action: action.to_string(), message: message.to_string() }
    }
}

#[derive(Deserialize)]
pub struct GitRebasePlanBody {
    pub upstream: String,
    pub entries: Vec<GitRebasePlanEntry>,
    #[serde(default)]
    pub confirm_rewrite: bool,
}

#[derive(Serialize)]
pub struct GitRebaseCandidatesResponse {
    pub commits: Vec<GitCommitSummary>,
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
    #[serde(default)]
    pub force: bool,
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

#[derive(Default, Deserialize)]
pub struct GitFetchBody {
    #[serde(default)]
    pub remote: Option<String>,
    #[serde(default)]
    pub all: bool,
}

#[derive(Default, Deserialize)]
pub struct GitPullBody {
    #[serde(default)]
    pub remote: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default = "default_pull_strategy")]
    pub strategy: String,
}

fn default_pull_strategy() -> String {
    "ff-only".to_string()
}

#[derive(Default, Deserialize)]
pub struct GitPushBody {
    #[serde(default)]
    pub remote: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub remote_branch: Option<String>,
    #[serde(default)]
    pub push_tags: bool,
    #[serde(default)]
    pub force_with_lease: bool,
    #[serde(default)]
    pub confirm_force_with_lease: bool,
}

#[derive(Deserialize)]
pub struct GitRemoteBranchDeleteBody {
    pub remote: String,
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
pub struct GitBlameQuery {
    pub pane_id: String,
    #[serde(default)]
    pub repository: Option<String>,
    pub path: String,
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
    #[serde(default)]
    pub content_version: String,
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
        let normalized_path = trimmed_path.replace('\\', "/");
        if normalized_path.is_empty() {
            return Err(json_err(StatusCode::BAD_REQUEST, "invalid path"));
        }
        for character in normalized_path.chars() {
            if character.is_control() {
                return Err(json_err(StatusCode::BAD_REQUEST, "invalid path"));
            }
        }
        for component in normalized_path.split('/') {
            if component == ".." {
                return Err(json_err(StatusCode::BAD_REQUEST, "invalid path"));
            }
        }
        let candidate = normalize_join(root, &normalized_path)?;
        if candidate == root || !candidate.starts_with(root) {
            return Err(json_err(StatusCode::FORBIDDEN, "outside workspace"));
        }
        if validate_git_candidate_path(root, &candidate).is_err() {
            return Err(json_err(StatusCode::FORBIDDEN, "outside workspace"));
        }
        validated_paths.push(normalized_path);
    }
    Ok(validated_paths)
}

fn validate_git_candidate_path(root: &Path, candidate: &Path) -> Result<(), String> {
    // 步骤1：解析工作区真实路径，避免词法路径检查被符号链接绕过。
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let mut existing_ancestor = candidate.to_path_buf();

    // 步骤2：目标可以尚未创建，此时向上查找最近的现有父目录并解析其真实路径。
    while !existing_ancestor.exists() {
        let Some(parent) = existing_ancestor.parent() else {
            return Err("outside workspace".to_string());
        };
        existing_ancestor = parent.to_path_buf();
    }
    let canonical_ancestor = existing_ancestor.canonicalize().map_err(|error| error.to_string())?;
    if canonical_ancestor != canonical_root && !canonical_ancestor.starts_with(&canonical_root) {
        return Err("outside workspace".to_string());
    }
    Ok(())
}

fn is_git_blame_header(line: &str) -> Option<(String, usize)> {
    // 步骤1：Blame 头必须包含 40 位十六进制提交和最终文件行号。
    let mut fields = line.split_whitespace();
    let raw_hash = fields.next()?;
    let hash = raw_hash.trim_start_matches('^');
    if hash.len() != 40 {
        return None;
    }
    for value in hash.bytes() {
        if !value.is_ascii_hexdigit() {
            return None;
        }
    }
    fields.next()?;
    let line_number = fields.next()?.parse::<usize>().ok()?;
    Some((hash.to_string(), line_number))
}

fn parse_git_blame_output(output: &str) -> Vec<GitBlameLine> {
    // 步骤1：逐行读取 porcelain 块，保存当前源码行的提交元数据。
    let mut blame_lines = Vec::new();
    let mut hash = String::new();
    let mut line_number = 0;
    let mut author_name = String::new();
    let mut author_email = String::new();
    let mut authored_at = 0;
    let mut summary = String::new();
    for line in output.lines() {
        if let Some((next_hash, next_line_number)) = is_git_blame_header(line) {
            hash = next_hash;
            line_number = next_line_number;
            author_name.clear();
            author_email.clear();
            authored_at = 0;
            summary.clear();
            continue;
        }
        if let Some(value) = line.strip_prefix("author ") {
            author_name = value.to_string();
            continue;
        }
        if let Some(value) = line.strip_prefix("author-mail ") {
            author_email = value.trim_start_matches('<').trim_end_matches('>').to_string();
            continue;
        }
        if let Some(value) = line.strip_prefix("author-time ") {
            authored_at = value.parse::<u64>().unwrap_or(0);
            continue;
        }
        if let Some(value) = line.strip_prefix("summary ") {
            summary = value.to_string();
            continue;
        }
        let Some(content) = line.strip_prefix('\t') else {
            continue;
        };
        if hash.len() != 40 || line_number == 0 {
            continue;
        }

        // 步骤2：遇到源码内容行时完成一条稳定记录。
        blame_lines.push(GitBlameLine {
            line_number,
            content: content.to_string(),
            short_hash: hash[..8].to_string(),
            hash: hash.clone(),
            author_name: author_name.clone(),
            author_email: author_email.clone(),
            authored_at,
            summary: summary.clone(),
        });
    }
    blame_lines
}

pub async fn workspace_git_blame(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<GitBlameQuery>,
) -> Response {
    // 步骤1：验证仓库内文件并限制源文件大小，避免 Blame 占用过多内存。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let paths = try_res!(validate_git_paths(&root, &[query.path]));
    let path = paths[0].clone();
    let target = try_res!(normalize_join(&root, &path));
    let metadata = match std::fs::metadata(&target) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => return json_err(StatusCode::BAD_REQUEST, "blame target must be a file"),
        Err(error) => return json_err(StatusCode::NOT_FOUND, &error.to_string()),
    };
    if metadata.len() > MAX_TEXT_PREVIEW as u64 {
        return json_err(StatusCode::PAYLOAD_TOO_LARGE, "file too large for blame");
    }

    // 步骤2：读取逐行 porcelain 输出并转换为前端可直接显示的结构。
    let arguments =
        vec!["blame".to_string(), "--line-porcelain".to_string(), "--".to_string(), path.clone()];
    match run_git_output(root.clone(), arguments).await {
        Ok(output) if output.status.success() => {
            if output.stdout.len() > MAX_GIT_BLAME_OUTPUT {
                return json_err(StatusCode::PAYLOAD_TOO_LARGE, "blame output too large");
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            Json(GitBlameResponse { path, lines: parse_git_blame_output(&stdout) }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn git_ignore_literal_pattern(path: &str, directory: bool) -> String {
    // 步骤1：生成仓库根锚定规则，并转义 Gitignore 特殊字符。
    let normalized_path = path.trim_matches('/');
    let mut pattern = String::from("/");
    for character in normalized_path.chars() {
        let needs_escape = character == '\\'
            || character == '!'
            || character == '#'
            || character == '['
            || character == ']'
            || character == '*'
            || character == '?'
            || character == ' ';
        if needs_escape {
            pattern.push('\\');
        }
        pattern.push(character);
    }
    if directory && !pattern.ends_with('/') {
        pattern.push('/');
    }
    pattern
}

fn append_git_ignore_pattern(content: &str, pattern: &str) -> String {
    // 步骤1：已有完全相同的规则时原样返回，避免重复写入。
    for line in content.lines() {
        if line == pattern {
            return content.to_string();
        }
    }

    // 步骤2：在现有内容后补齐换行并追加规则。
    let mut updated = content.to_string();
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push_str(pattern);
    updated.push('\n');
    updated
}

fn read_git_ignore(root: &Path) -> Result<GitIgnoreResponse, String> {
    // 步骤1：不存在时返回空内容；符号链接和过大文件拒绝读取。
    let target = root.join(".gitignore");
    let metadata = match std::fs::symlink_metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(GitIgnoreResponse { content: String::new(), exists: false });
        }
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() {
        return Err("symbolic .gitignore is not supported".to_string());
    }
    if metadata.len() > MAX_TEXT_PREVIEW as u64 {
        return Err(".gitignore is too large".to_string());
    }
    let content = match std::fs::read_to_string(target) {
        Ok(content) => content,
        Err(error) => return Err(error.to_string()),
    };
    Ok(GitIgnoreResponse { content, exists: true })
}

fn write_git_ignore(root: &Path, content: &str) -> Result<(), String> {
    // 步骤1：限制内容大小，并拒绝覆盖指向仓库外部的符号链接。
    if content.len() > MAX_TEXT_PREVIEW {
        return Err(".gitignore is too large".to_string());
    }
    let target = root.join(".gitignore");
    match std::fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("symbolic .gitignore is not supported".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    match std::fs::write(target, content) {
        Ok(()) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub async fn workspace_git_ignore(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：读取当前仓库根目录的 .gitignore。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    match read_git_ignore(&root) {
        Ok(response) => Json(response).into_response(),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_ignore_update(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitIgnoreUpdateBody>,
) -> Response {
    // 步骤1：把编辑器内容写回当前仓库根目录。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    match write_git_ignore(&root, &body.content) {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_ignore_add(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitIgnoreAddBody>,
) -> Response {
    // 步骤1：验证目标位于当前仓库并判断文件类型。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let paths = try_res!(validate_git_paths(&root, &[body.path]));
    let path = paths[0].trim_end_matches('/').to_string();
    let target = try_res!(normalize_join(&root, &path));
    let metadata = match std::fs::metadata(target) {
        Ok(metadata) => metadata,
        Err(error) => return json_err(StatusCode::NOT_FOUND, &error.to_string()),
    };

    // 步骤2：按字面路径追加规则并写回 .gitignore。
    let pattern = git_ignore_literal_pattern(&path, metadata.is_dir());
    let current = match read_git_ignore(&root) {
        Ok(response) => response.content,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let updated = append_git_ignore_pattern(&current, &pattern);
    match write_git_ignore(&root, &updated) {
        Ok(()) => Json(serde_json::json!({ "ok": true, "pattern": pattern })).into_response(),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn parse_git_clean_preview_output(output: &str) -> Vec<String> {
    // 步骤1：只接收 Git 明确标记为“将删除”的路径。
    let mut paths = Vec::new();
    for line in output.lines() {
        let Some(path) = line.strip_prefix("Would remove ") else {
            continue;
        };
        let path = path.trim_end_matches('\r');
        if !path.is_empty() {
            paths.push(path.to_string());
        }
    }
    paths
}

fn build_git_clean_arguments(paths: &[String]) -> Vec<String> {
    // 步骤1：只清理明确选择的未跟踪项，并用 -- 隔离路径参数。
    let mut arguments = vec!["clean".to_string(), "-fd".to_string(), "--".to_string()];
    for path in paths {
        arguments.push(path.clone());
    }
    arguments
}

fn parse_git_worktree_output(output: &str) -> Vec<GitWorktreeEntry> {
    // 步骤1：按 porcelain 空行分组，每组代表一个 worktree。
    let mut worktrees = Vec::new();
    let mut path = String::new();
    let mut head = String::new();
    let mut branch = String::new();
    let mut detached = false;
    let mut locked = false;
    let mut prunable = false;

    // 步骤2：逐行识别 Git 固定字段，并在空行处提交当前记录。
    for line in output.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            if !path.is_empty() {
                worktrees.push(GitWorktreeEntry {
                    path: path.clone(),
                    head: head.clone(),
                    branch: branch.clone(),
                    detached,
                    locked,
                    prunable,
                    dirty: false,
                    current: false,
                });
            }
            path.clear();
            head.clear();
            branch.clear();
            detached = false;
            locked = false;
            prunable = false;
            continue;
        }
        if let Some(value) = line.strip_prefix("worktree ") {
            path = value.to_string();
        } else if let Some(value) = line.strip_prefix("HEAD ") {
            head = value.to_string();
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = value.strip_prefix("refs/heads/").unwrap_or(value).to_string();
        } else if line == "detached" {
            detached = true;
        } else if line.starts_with("locked") {
            locked = true;
        } else if line.starts_with("prunable") {
            prunable = true;
        }
    }

    // 步骤3：兼容没有尾随空行的最后一组记录。
    if !path.is_empty() {
        worktrees.push(GitWorktreeEntry {
            path,
            head,
            branch,
            detached,
            locked,
            prunable,
            dirty: false,
            current: false,
        });
    }
    worktrees
}
fn validate_worktree_directory(value: &str) -> Result<String, Response> {
    // 步骤1：路径作为独立 Git 参数传递，允许标准的兄弟目录和绝对目录布局。
    let value = value.trim();
    if value.is_empty() || value.starts_with('-') || value.chars().any(char::is_control) {
        return Err(json_err(StatusCode::BAD_REQUEST, "worktree directory required"));
    }
    Ok(value.replace('\\', "/"))
}

fn build_worktree_create_arguments(
    directory: &str,
    branch: Option<&str>,
    start_point: Option<&str>,
) -> Vec<String> {
    // 步骤1：按 Git 固定参数顺序创建 worktree，可选新建分支和起点引用。
    let mut arguments = vec!["worktree".to_string(), "add".to_string()];
    if let Some(branch) = branch {
        arguments.push("-b".to_string());
        arguments.push(branch.to_string());
    }
    arguments.push(directory.to_string());
    if let Some(start_point) = start_point {
        arguments.push(start_point.to_string());
    }
    arguments
}

fn build_worktree_remove_arguments(path: &str, force: bool) -> Vec<String> {
    // 步骤1：删除 worktree 时只传入明确路径，强制删除必须由界面显式传入。
    let mut arguments = vec!["worktree".to_string(), "remove".to_string()];
    if force {
        arguments.push("--force".to_string());
    }
    arguments.push(path.to_string());
    arguments
}

fn normalize_worktree_path_for_compare(path: &str) -> String {
    // 步骤1：只用于比较 Git 输出和界面回传路径，不改变实际传给 Git 的原始路径。
    path.trim().replace('\\', "/").trim_end_matches('/').to_string()
}

fn canonical_or_original(path: &Path) -> PathBuf {
    // 步骤1：已存在路径用规范化路径比较，已损坏或可修剪 worktree 保留原路径比较。
    match path.canonicalize() {
        Ok(canonical_path) => canonical_path,
        Err(_) => path.to_path_buf(),
    }
}

fn select_removable_worktree_path(
    root: &Path,
    worktrees: &[GitWorktreeEntry],
    requested_path: &str,
) -> Result<String, Response> {
    // 步骤1：请求路径必须来自当前仓库的 worktree 列表，避免手写路径误删。
    let requested_path_for_compare = normalize_worktree_path_for_compare(requested_path);
    let mut selected_path = String::new();
    for worktree in worktrees {
        let worktree_path_for_compare = normalize_worktree_path_for_compare(&worktree.path);
        if worktree_path_for_compare == requested_path_for_compare {
            selected_path = worktree.path.clone();
            break;
        }
    }
    if selected_path.is_empty() {
        return Err(json_err(StatusCode::BAD_REQUEST, "unknown worktree path"));
    }

    // 步骤2：禁止删除当前仓库根 worktree，避免把正在管理的主工作区移除。
    let root_path = canonical_or_original(root);
    let selected_path_buf = PathBuf::from(&selected_path);
    let selected_canonical_path = canonical_or_original(&selected_path_buf);
    if selected_canonical_path == root_path {
        return Err(json_err(StatusCode::BAD_REQUEST, "cannot remove current worktree"));
    }
    Ok(selected_path)
}

fn parse_git_submodule_status_output(output: &str) -> Vec<GitSubmoduleEntry> {
    // 步骤1：逐行解析 git submodule status 的状态字符、提交和路径。
    let mut submodules = Vec::new();
    for line in output.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let status_character = line.chars().next().unwrap_or(' ');
        let rest = line.get(1..).unwrap_or("").trim();
        let Some(commit_end) = rest.find(char::is_whitespace) else { continue };
        let commit = rest[..commit_end].to_string();
        let path_and_description = rest[commit_end..].trim();
        let mut path = path_and_description.to_string();
        let mut description = String::new();
        if path_and_description.ends_with(')') {
            if let Some(description_start) = path_and_description.rfind(" (") {
                path = path_and_description[..description_start].to_string();
                description = path_and_description[description_start + 1..].to_string();
            }
        }
        if path.is_empty() {
            continue;
        }
        let status = match status_character {
            '-' => "uninitialized",
            '+' => "changed",
            'U' => "conflict",
            _ => "clean",
        }
        .to_string();
        submodules.push(GitSubmoduleEntry { path, commit, status, description });
    }
    submodules
}

fn build_submodule_update_arguments(
    path: Option<&str>,
    initialize: bool,
    recursive: bool,
    remote: bool,
) -> Vec<String> {
    // 步骤1：把界面选项映射为 Git submodule update 的固定参数。
    let mut arguments = vec!["submodule".to_string(), "update".to_string()];
    if initialize {
        arguments.push("--init".to_string());
    }
    if recursive {
        arguments.push("--recursive".to_string());
    }
    if remote {
        arguments.push("--remote".to_string());
    }
    if let Some(path) = path {
        arguments.push("--".to_string());
        arguments.push(path.to_string());
    }
    arguments
}

fn select_existing_worktree_path(
    worktrees: &[GitWorktreeEntry],
    requested_path: &str,
) -> Result<String, Response> {
    // 步骤1：只接受 Git 当前列表中存在的 Worktree 路径，并返回 Git 的原始路径文本。
    let requested_path = normalize_worktree_path_for_compare(requested_path);
    for worktree in worktrees {
        let listed_path = normalize_worktree_path_for_compare(&worktree.path);
        if listed_path == requested_path {
            return Ok(worktree.path.clone());
        }
    }
    Err(json_err(StatusCode::NOT_FOUND, "worktree not found"))
}

fn build_submodule_add_arguments(url: &str, path: &str, branch: Option<&str>) -> Vec<String> {
    // 步骤1：可选分支放在 URL 和路径之前，所有值都作为独立参数。
    let mut arguments = vec!["submodule".to_string(), "add".to_string()];
    if let Some(branch) = branch {
        arguments.push("-b".to_string());
        arguments.push(branch.to_string());
    }
    arguments.push(url.to_string());
    arguments.push(path.to_string());
    arguments
}

fn build_submodule_sync_arguments(path: Option<&str>) -> Vec<String> {
    // 步骤1：空路径同步全部子模块，指定路径时使用选项结束标记隔离。
    let mut arguments = vec!["submodule".to_string(), "sync".to_string()];
    if let Some(path) = path {
        arguments.push("--".to_string());
        arguments.push(path.to_string());
    }
    arguments
}

fn build_submodule_deinit_arguments(path: &str) -> Vec<String> {
    // 步骤1：停用操作显式确认目标路径并清理工作目录。
    vec![
        "submodule".to_string(),
        "deinit".to_string(),
        "-f".to_string(),
        "--".to_string(),
        path.to_string(),
    ]
}

fn build_submodule_remove_arguments(path: &str) -> Vec<String> {
    // 步骤1：从父仓库索引移除已经停用并备份的子模块。
    vec!["rm".to_string(), "-f".to_string(), "--".to_string(), path.to_string()]
}

fn parse_git_lfs_track_output(output: &str) -> Vec<String> {
    // 步骤1：提取 git lfs track 输出中的模式部分，忽略标题行。
    let mut patterns = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Listing tracked patterns") {
            continue;
        }
        let pattern = match line.split_once(" (") {
            Some((value, _)) => value.trim(),
            None => line,
        };
        if !pattern.is_empty() {
            patterns.push(pattern.to_string());
        }
    }
    patterns
}

fn build_lfs_track_arguments(pattern: &str) -> Vec<String> {
    // 步骤1：LFS 跟踪模式作为独立参数传递，避免 shell 展开通配符。
    vec!["lfs".to_string(), "track".to_string(), pattern.to_string()]
}

fn build_lfs_sync_arguments(action: &str, remote: Option<&str>) -> Vec<String> {
    // 步骤1：支持 pull 和 push 两种 LFS 同步动作，可选指定 Remote。
    let mut arguments = vec!["lfs".to_string(), action.to_string()];
    if let Some(remote) = remote {
        arguments.push(remote.to_string());
    }
    arguments
}

fn build_lfs_untrack_arguments(pattern: &str) -> Vec<String> {
    // 步骤1：取消跟踪模式仍作为独立参数传递，避免通配符展开。
    vec!["lfs".to_string(), "untrack".to_string(), pattern.to_string()]
}

fn build_lfs_lock_arguments(action: &str, path: &str, force: bool) -> Vec<String> {
    // 步骤1：锁定和解锁共用固定参数结构，强制标记只允许用于解锁。
    let mut arguments = vec!["lfs".to_string(), action.to_string()];
    if action == "unlock" && force {
        arguments.push("--force".to_string());
    }
    arguments.push(path.to_string());
    arguments
}

fn build_lfs_push_arguments(remote: &str, reference: Option<&str>, all: bool) -> Vec<String> {
    // 步骤1：LFS Push 必须包含 Remote，并在全量模式和明确 ref 之间二选一。
    let mut arguments = vec!["lfs".to_string(), "push".to_string()];
    if all {
        arguments.push("--all".to_string());
    }
    arguments.push(remote.to_string());
    if let Some(reference) = reference {
        arguments.push(reference.to_string());
    }
    arguments
}

fn build_worktree_management_arguments(
    action: &str,
    path: &str,
    target: Option<&str>,
) -> Result<Vec<String>, String> {
    // 步骤1：无路径动作使用固定命令，路径动作按 Git 要求追加目标。
    if action == "prune" {
        return Ok(vec!["worktree".to_string(), "prune".to_string()]);
    }
    if action == "repair" {
        let mut arguments = vec!["worktree".to_string(), "repair".to_string()];
        if !path.is_empty() {
            arguments.push(path.to_string());
        }
        return Ok(arguments);
    }
    if action == "lock" || action == "unlock" {
        return Ok(vec!["worktree".to_string(), action.to_string(), path.to_string()]);
    }
    if action == "move" {
        let target = target.filter(|value| !value.is_empty()).ok_or("move target required")?;
        return Ok(vec![
            "worktree".to_string(),
            "move".to_string(),
            path.to_string(),
            target.to_string(),
        ]);
    }
    Err("invalid worktree action".to_string())
}
async fn git_clean_preview_paths(root: PathBuf) -> Result<Vec<String>, String> {
    // 步骤1：dry-run 默认遵守 .gitignore，并要求 Git 输出可读的非 ASCII 路径。
    let arguments = vec![
        "-c".to_string(),
        "core.quotePath=false".to_string(),
        "clean".to_string(),
        "-nd".to_string(),
    ];
    let output = run_git_output(root, arguments).await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("git clean preview failed".to_string());
        }
        return Err(stderr);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_git_clean_preview_output(&stdout))
}

pub async fn workspace_git_clean_preview(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：返回 Git dry-run 的真实待清理路径。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    match git_clean_preview_paths(root).await {
        Ok(paths) => Json(GitCleanPreviewResponse { paths }).into_response(),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_clean(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitCleanBody>,
) -> Response {
    // 步骤1：限制选择数量并验证仓库相对路径。
    if body.paths.is_empty() || body.paths.len() > MAX_GIT_STATUS_FILES {
        return json_err(StatusCode::BAD_REQUEST, "clean paths required");
    }
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let paths = try_res!(validate_git_paths(&root, &body.paths));

    // 步骤2：重新 dry-run，拒绝任何不在当前预览中的路径。
    let preview_paths = match git_clean_preview_paths(root.clone()).await {
        Ok(paths) => paths,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    for path in &paths {
        if !preview_paths.contains(path) {
            return json_err(StatusCode::CONFLICT, "clean preview changed; refresh required");
        }
    }

    // 步骤3：清理前先备份当前内容，避免误删后完全无法找回。
    if let Err(error) = backup_git_paths(root.clone(), &paths, "clean").await {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error);
    }

    // 步骤4：执行受路径约束的清理，并记录为可查看的 Git 命令。
    let arguments = build_git_clean_arguments(&paths);
    match run_git_tracked_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_backups(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：读取当前仓库公共 Git 目录中的结构化备份清单。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let common_directory = match git_common_directory(root).await {
        Ok(path) => path,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    match read_git_backups(&common_directory) {
        Ok(backups) => Json(GitBackupsResponse { backups }).into_response(),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_backup_restore(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitBackupActionBody>,
) -> Response {
    // 步骤1：恢复会覆盖现有路径，因此要求显式确认和服务端生成的备份名称。
    if !body.confirm {
        return json_err(StatusCode::BAD_REQUEST, "backup restore confirmation required");
    }
    let name = try_res!(validate_git_backup_name(&body.name));
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let common_directory = match git_common_directory(root.clone()).await {
        Ok(path) => path,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let backup_directory = common_directory.join("dinotty-backups").join(&name);
    let manifest_content = match std::fs::read(backup_directory.join("manifest.json")) {
        Ok(content) => content,
        Err(error) => return json_err(StatusCode::NOT_FOUND, &error.to_string()),
    };
    let manifest = match serde_json::from_slice::<GitBackupEntry>(&manifest_content) {
        Ok(manifest) if manifest.name == name => manifest,
        Ok(_) => return json_err(StatusCode::BAD_REQUEST, "backup manifest mismatch"),
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error.to_string()),
    };

    // 步骤2：校验清单路径并锁定仓库，恢复前再次备份当前内容，确保恢复动作本身可撤销。
    let mut restore_paths = Vec::new();
    for path in &manifest.paths {
        restore_paths.push(path.clone());
    }
    for path in &manifest.missing_paths {
        if !restore_paths.contains(path) {
            restore_paths.push(path.clone());
        }
    }
    let restore_paths = try_res!(validate_git_paths(&root, &restore_paths));
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;
    if let Err(error) = backup_git_paths(root.clone(), &restore_paths, "before-restore").await {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error);
    }

    // 步骤3：先清理当前路径，再复制备份快照；原本不存在的路径保持删除状态。
    for path in &restore_paths {
        let destination = try_res!(normalize_join(&root, path));
        if destination.is_dir() {
            if let Err(error) = std::fs::remove_dir_all(&destination) {
                return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
            }
        } else if destination.exists() {
            if let Err(error) = std::fs::remove_file(&destination) {
                return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
            }
        }
    }
    for path in &manifest.paths {
        let destination = match normalize_join(&root, path) {
            Ok(path) => path,
            Err(response) => return response,
        };
        let source = backup_directory.join("data").join(path);
        if let Err(error) = copy_path_recursively(&source, &destination) {
            return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error);
        }
    }
    Json(serde_json::json!({ "ok": true, "restored": manifest.paths })).into_response()
}

pub async fn workspace_git_backup_delete(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitBackupActionBody>,
) -> Response {
    // 步骤1：删除备份要求确认，并将目标限定到 Git 公共目录下的单级目录。
    if !body.confirm {
        return json_err(StatusCode::BAD_REQUEST, "backup delete confirmation required");
    }
    let name = try_res!(validate_git_backup_name(&body.name));
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let common_directory = match git_common_directory(root).await {
        Ok(path) => path,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let backup_directory = common_directory.join("dinotty-backups").join(name);
    match std::fs::remove_dir_all(backup_directory) {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            json_err(StatusCode::NOT_FOUND, &error.to_string())
        }
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

pub async fn workspace_git_worktrees(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：读取 worktree porcelain 输出，避免人工解析对齐列。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let arguments = vec!["worktree".to_string(), "list".to_string(), "--porcelain".to_string()];
    match run_git_output(root.clone(), arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut worktrees = parse_git_worktree_output(&stdout);
            let current_root = canonical_or_original(&root);
            for worktree in &mut worktrees {
                let worktree_root = PathBuf::from(&worktree.path);
                worktree.current = canonical_or_original(&worktree_root) == current_root;
                if !worktree.prunable && worktree_root.exists() {
                    let status_arguments = vec![
                        "status".to_string(),
                        "--porcelain".to_string(),
                        "--untracked-files=all".to_string(),
                    ];
                    if let Ok(status_output) = run_git_output(worktree_root, status_arguments).await
                    {
                        worktree.dirty = !status_output.stdout.is_empty();
                    }
                }
            }
            Json(GitWorktreesResponse { worktrees }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_worktree_create(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitWorktreeCreateBody>,
) -> Response {
    // 步骤1：验证目录、分支和起点后创建 worktree。
    let directory = try_res!(validate_worktree_directory(&body.directory));
    let branch = try_res!(validate_optional_git_name(
        if body.branch.trim().is_empty() { None } else { Some(body.branch.as_str()) },
        "branch",
    ));
    let start_point = try_res!(validate_optional_git_name(
        if body.start_point.trim().is_empty() { None } else { Some(body.start_point.as_str()) },
        "start point",
    ));
    let arguments =
        build_worktree_create_arguments(&directory, branch.as_deref(), start_point.as_deref());
    run_git_action(&manager, &query, arguments).await
}

pub async fn workspace_git_worktree_remove(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitWorktreeRemoveBody>,
) -> Response {
    // 步骤1：删除用户从 worktree 列表中明确选择的路径。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let path = body.path.trim();
    if path.is_empty() || path.starts_with('-') || path.chars().any(char::is_control) {
        return json_err(StatusCode::BAD_REQUEST, "worktree path required");
    }
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;

    // 步骤2：重新读取 worktree 列表，确认目标仍然存在且不是当前仓库根。
    let list_arguments =
        vec!["worktree".to_string(), "list".to_string(), "--porcelain".to_string()];
    let list_output = match run_git_output(root.clone(), list_arguments).await {
        Ok(output) if output.status.success() => output,
        Ok(output) => return git_command_response(&output),
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let list_stdout = String::from_utf8_lossy(&list_output.stdout);
    let worktrees = parse_git_worktree_output(&list_stdout);
    let selected_path = try_res!(select_removable_worktree_path(&root, &worktrees, path));

    // 步骤3：强制删除必须由界面二次确认，并先备份目标 Worktree 的改动文件。
    if body.force && !body.confirm_force {
        return json_err(StatusCode::BAD_REQUEST, "force worktree removal confirmation required");
    }
    if body.force {
        let selected_root = PathBuf::from(&selected_path);
        let status_arguments = vec![
            "status".to_string(),
            "--short".to_string(),
            "-z".to_string(),
            "--untracked-files=all".to_string(),
        ];
        let status_output = match run_git_output(selected_root.clone(), status_arguments).await {
            Ok(output) if output.status.success() => output,
            Ok(output) => return git_command_response(&output),
            Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
        };
        let status_text = String::from_utf8_lossy(&status_output.stdout);
        let parsed_status = parse_status_output(&status_text);
        let mut changed_paths = Vec::new();
        for file in parsed_status.files {
            changed_paths.push(file.path);
        }
        if !changed_paths.is_empty() {
            if let Err(error) =
                backup_git_paths(selected_root, &changed_paths, "worktree-remove").await
            {
                return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error);
            }
        }
    }

    // 步骤4：只把 Git 列表里的原始路径传给 remove，避免路径展示与实际删除不一致。
    let arguments = build_worktree_remove_arguments(&selected_path, body.force);
    match run_git_tracked_output_locked(root, arguments, None, Vec::new()).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_worktree_action(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitWorktreeActionBody>,
) -> Response {
    // 步骤1：验证动作和路径文本，移动目标沿用 Worktree 路径校验。
    let path = body.path.trim();
    if !path.is_empty() && (path.starts_with('-') || path.chars().any(char::is_control)) {
        return json_err(StatusCode::BAD_REQUEST, "invalid worktree path");
    }
    let action = body.action.trim();
    let target = if body.target.trim().is_empty() {
        None
    } else {
        Some(try_res!(validate_worktree_directory(&body.target)))
    };
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;
    let selected_path = if action == "lock" || action == "unlock" || action == "move" {
        let list_arguments =
            vec!["worktree".to_string(), "list".to_string(), "--porcelain".to_string()];
        let output = match run_git_output(root.clone(), list_arguments).await {
            Ok(output) if output.status.success() => output,
            Ok(output) => return git_command_response(&output),
            Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
        };
        let output_text = String::from_utf8_lossy(&output.stdout);
        let worktrees = parse_git_worktree_output(&output_text);
        try_res!(select_existing_worktree_path(&worktrees, path))
    } else {
        path.to_string()
    };
    let arguments =
        match build_worktree_management_arguments(action, &selected_path, target.as_deref()) {
            Ok(arguments) => arguments,
            Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
        };
    match run_git_tracked_output_locked(root, arguments, None, Vec::new()).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_submodules(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：读取子模块状态；没有子模块时 Git 返回空列表。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let arguments = vec!["submodule".to_string(), "status".to_string(), "--recursive".to_string()];
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let submodules = parse_git_submodule_status_output(&stdout);
            Json(GitSubmodulesResponse { submodules }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_submodule_update(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitSubmoduleUpdateBody>,
) -> Response {
    // 步骤1：可选校验单个子模块路径，再执行 update。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let path = if body.path.trim().is_empty() {
        None
    } else {
        let paths = try_res!(validate_git_paths(&root, &[body.path]));
        Some(paths[0].clone())
    };
    let arguments = build_submodule_update_arguments(
        path.as_deref(),
        body.initialize,
        body.recursive,
        body.remote,
    );
    match run_git_tracked_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn validate_new_repository_path(value: &str) -> Result<String, Response> {
    // 步骤1：新增子模块只能位于仓库内部，不允许绝对路径和父目录分量。
    let value = value.trim().replace('\\', "/");
    if value.is_empty()
        || value.starts_with('-')
        || Path::new(&value).is_absolute()
        || Path::new(&value)
            .components()
            .any(|component| component == std::path::Component::ParentDir)
    {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid repository path"));
    }
    Ok(value)
}

pub async fn workspace_git_submodule_add(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitSubmoduleAddBody>,
) -> Response {
    // 步骤1：校验 URL、仓库内路径和可选分支后添加子模块。
    let url = match validate_clone_url(&body.url) {
        Ok(url) => url,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    let path = try_res!(validate_new_repository_path(&body.path));
    let branch = try_res!(validate_optional_git_name(
        if body.branch.trim().is_empty() { None } else { Some(body.branch.as_str()) },
        "branch",
    ));
    let arguments = build_submodule_add_arguments(&url, &path, branch.as_deref());
    run_git_action(&manager, &query, arguments).await
}

pub async fn workspace_git_submodule_sync(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitSubmoduleActionBody>,
) -> Response {
    // 步骤1：同步全部或一个现有子模块的 URL 配置。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let path = if body.path.trim().is_empty() {
        None
    } else {
        let paths = try_res!(validate_git_paths(&root, &[body.path]));
        Some(paths[0].clone())
    };
    let arguments = build_submodule_sync_arguments(path.as_deref());
    match run_git_tracked_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

async fn run_destructive_submodule_action(
    manager: &SessionManager,
    query: &PaneQuery,
    body: GitSubmoduleActionBody,
    remove: bool,
) -> Response {
    // 步骤1：停用和移除都要求确认，并在操作前备份现有目录。
    if !body.confirm {
        return json_err(StatusCode::BAD_REQUEST, "submodule confirmation required");
    }
    let root = match get_git_root(manager, &query.pane_id, query.repository.as_deref()) {
        Ok(root) => root,
        Err(response) => return response,
    };
    let paths = match validate_git_paths(&root, &[body.path]) {
        Ok(paths) => paths,
        Err(response) => return response,
    };
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;
    if let Err(error) = backup_git_paths(root.clone(), &paths, "submodule").await {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error);
    }
    let output = match run_git_tracked_output_locked(
        root.clone(),
        build_submodule_deinit_arguments(&paths[0]),
        None,
        Vec::new(),
    )
    .await
    {
        Ok(output) => output,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    if !output.status.success() || !remove {
        return git_command_response(&output);
    }
    match run_git_tracked_output_locked(
        root,
        build_submodule_remove_arguments(&paths[0]),
        None,
        Vec::new(),
    )
    .await
    {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_submodule_deinit(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitSubmoduleActionBody>,
) -> Response {
    run_destructive_submodule_action(&manager, &query, body, false).await
}

pub async fn workspace_git_submodule_remove(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitSubmoduleActionBody>,
) -> Response {
    run_destructive_submodule_action(&manager, &query, body, true).await
}

pub async fn workspace_git_lfs_tracks(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：读取 LFS 跟踪模式，Git LFS 不存在时返回真实错误。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let arguments = vec!["lfs".to_string(), "track".to_string()];
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let patterns = parse_git_lfs_track_output(&stdout);
            Json(GitLfsTrackResponse { patterns }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_lfs_track(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitLfsTrackBody>,
) -> Response {
    // 步骤1：添加单个 LFS 跟踪模式。
    let pattern = body.pattern.trim();
    if pattern.is_empty() || pattern.starts_with('-') || pattern.chars().any(char::is_control) {
        return json_err(StatusCode::BAD_REQUEST, "lfs pattern required");
    }
    let arguments = build_lfs_track_arguments(pattern);
    run_git_action(&manager, &query, arguments).await
}

pub async fn workspace_git_lfs_untrack(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitLfsTrackBody>,
) -> Response {
    // 步骤1：取消经过长度和控制字符校验的 LFS 模式。
    let pattern = body.pattern.trim();
    if pattern.is_empty() || pattern.len() > 500 || pattern.chars().any(char::is_control) {
        return json_err(StatusCode::BAD_REQUEST, "lfs pattern required");
    }
    run_git_action(&manager, &query, build_lfs_untrack_arguments(pattern)).await
}

pub async fn workspace_git_lfs_locks(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：使用 LFS JSON 输出读取锁，避免解析对齐文本。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let arguments = vec!["lfs".to_string(), "locks".to_string(), "--json".to_string()];
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let value: serde_json::Value =
                serde_json::from_slice(&output.stdout).unwrap_or_else(|_| serde_json::json!({}));
            let mut locks = Vec::new();
            if let Some(raw_locks) = value.get("locks").and_then(serde_json::Value::as_array) {
                for raw_lock in raw_locks {
                    let id = raw_lock
                        .get("id")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let path = raw_lock
                        .get("path")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let owner = raw_lock
                        .get("owner")
                        .and_then(|owner| owner.get("name"))
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if !path.is_empty() {
                        locks.push(GitLfsLockEntry { id, path, owner });
                    }
                }
            }
            Json(GitLfsLocksResponse { locks }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

async fn run_lfs_lock_action(
    manager: &SessionManager,
    query: &PaneQuery,
    body: GitLfsLockBody,
    action: &str,
) -> Response {
    // 步骤1：锁操作只接受仓库内现有路径，强制标记仅由解锁接口使用。
    let root = match get_git_root(manager, &query.pane_id, query.repository.as_deref()) {
        Ok(root) => root,
        Err(response) => return response,
    };
    let paths = match validate_git_paths(&root, &[body.path]) {
        Ok(paths) => paths,
        Err(response) => return response,
    };
    let arguments = build_lfs_lock_arguments(action, &paths[0], body.force);
    match run_git_tracked_output(root, arguments).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_lfs_lock(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitLfsLockBody>,
) -> Response {
    run_lfs_lock_action(&manager, &query, body, "lock").await
}

pub async fn workspace_git_lfs_unlock(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitLfsLockBody>,
) -> Response {
    run_lfs_lock_action(&manager, &query, body, "unlock").await
}

pub async fn workspace_git_lfs_pull(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitFetchBody>,
) -> Response {
    // 步骤1：拉取 LFS 对象，可选指定 Remote。
    let remote = try_res!(validate_optional_git_name(body.remote.as_deref(), "remote"));
    let arguments = build_lfs_sync_arguments("pull", remote.as_deref());
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_lfs_push(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitLfsPushBody>,
) -> Response {
    // 步骤1：LFS Push 要求明确 Remote，并要求 ref 或全量模式二选一。
    let remote = try_res!(validate_git_name(&body.remote, "remote"));
    let reference = try_res!(validate_optional_git_name(
        if body.reference.trim().is_empty() { None } else { Some(body.reference.as_str()) },
        "reference",
    ));
    if !body.all && reference.is_none() {
        return json_err(StatusCode::BAD_REQUEST, "lfs reference required");
    }
    let arguments = build_lfs_push_arguments(&remote, reference.as_deref(), body.all);
    run_git_remote_command(&manager, &query, arguments).await
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

async fn git_common_directory(root: PathBuf) -> Result<PathBuf, String> {
    // 步骤1：读取 Git 公共目录，兼容普通仓库和 worktree。
    let arguments = vec!["rev-parse".to_string(), "--git-common-dir".to_string()];
    let output = run_git_output(root.clone(), arguments).await?;
    if !output.status.success() {
        return Err(git_command_error_message(&output.stdout, &output.stderr));
    }
    let raw_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw_path.is_empty() {
        return Err("git common directory not found".to_string());
    }
    let path = PathBuf::from(&raw_path);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(root.join(path))
    }
}

fn copy_path_recursively(source: &Path, destination: &Path) -> Result<(), String> {
    // 步骤1：拒绝符号链接和重解析路径，避免备份越出仓库或形成递归环。
    let metadata = std::fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("symbolic links cannot be backed up safely".to_string());
    }
    if metadata.is_dir() {
        std::fs::create_dir_all(destination).map_err(|error| error.to_string())?;
        let entries = std::fs::read_dir(source).map_err(|error| error.to_string())?;
        for entry_result in entries {
            let entry = entry_result.map_err(|error| error.to_string())?;
            let child_source = entry.path();
            let child_destination = destination.join(entry.file_name());
            copy_path_recursively(&child_source, &child_destination)?;
        }
        return Ok(());
    }

    // 步骤2：普通文件复制前先创建父目录。
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::copy(source, destination).map_err(|error| error.to_string())?;
    Ok(())
}

fn git_backup_path_size(path: &Path) -> Result<u64, String> {
    // 步骤1：递归统计真实文件大小，并拒绝可能越界的符号链接。
    let metadata = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("symbolic links cannot be backed up safely".to_string());
    }
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    let mut total = 0u64;
    for entry_result in std::fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry_result.map_err(|error| error.to_string())?;
        total = total.saturating_add(git_backup_path_size(&entry.path())?);
        if total > MAX_GIT_BACKUP_BYTES {
            return Err("backup is larger than 512 MiB".to_string());
        }
    }
    Ok(total)
}

async fn backup_git_paths(
    root: PathBuf,
    paths: &[String],
    reason: &str,
) -> Result<PathBuf, String> {
    // 步骤1：在 Git 公共目录下建立 Dinotty 备份目录，避免被 git clean 清理。
    let common_directory = git_common_directory(root.clone()).await?;
    let backup_directory = common_directory.join("dinotty-backups").join(format!(
        "{reason}-{}-{}",
        git_command_timestamp(),
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&backup_directory).map_err(|error| error.to_string())?;

    // 步骤2：复制前统计总量，避免安全备份反向占满磁盘。
    let mut backup_size = 0u64;
    let mut backed_up_paths = Vec::new();
    let mut missing_paths = Vec::new();
    for path in paths {
        let source = normalize_join(&root, path).map_err(response_to_string)?;
        if !source.exists() {
            missing_paths.push(path.clone());
            continue;
        }
        backup_size = backup_size.saturating_add(git_backup_path_size(&source)?);
        if backup_size > MAX_GIT_BACKUP_BYTES {
            return Err("backup is larger than 512 MiB".to_string());
        }
        let relative_destination = Path::new(path);
        let destination = backup_directory.join("data").join(relative_destination);
        copy_path_recursively(&source, &destination)?;
        backed_up_paths.push(path.clone());
    }

    // 步骤3：写入恢复清单，界面只使用服务端生成的备份名称。
    let name = backup_directory.file_name().unwrap_or_default().to_string_lossy().to_string();
    let manifest = GitBackupEntry {
        name,
        reason: reason.to_string(),
        created_at: git_command_timestamp(),
        paths: backed_up_paths,
        missing_paths,
        size: backup_size,
    };
    let manifest_content =
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    std::fs::write(backup_directory.join("manifest.json"), manifest_content)
        .map_err(|error| error.to_string())?;
    Ok(backup_directory)
}

fn validate_git_backup_name(value: &str) -> Result<String, Response> {
    // 步骤1：备份名称只能来自列表中的简单目录名，禁止路径分隔符和父目录。
    let name = value.trim();
    if name.is_empty()
        || name.starts_with('.')
        || !name.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid backup name"));
    }
    Ok(name.to_string())
}

fn read_git_backups(common_directory: &Path) -> Result<Vec<GitBackupEntry>, String> {
    // 步骤1：只读取包含有效清单的 Dinotty 备份目录。
    let backups_directory = common_directory.join("dinotty-backups");
    if !backups_directory.exists() {
        return Ok(Vec::new());
    }
    let mut backups = Vec::new();
    for entry_result in std::fs::read_dir(backups_directory).map_err(|error| error.to_string())? {
        let entry = entry_result.map_err(|error| error.to_string())?;
        let manifest_path = entry.path().join("manifest.json");
        let Ok(content) = std::fs::read(&manifest_path) else { continue };
        let Ok(manifest) = serde_json::from_slice::<GitBackupEntry>(&content) else { continue };
        backups.push(manifest);
    }
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

fn response_to_string(response: Response) -> String {
    // 步骤1：内部备份只需要简短错误，避免把 Axum 响应结构泄露到日志。
    format!("request failed with status {}", response.status())
}

async fn create_safety_branch_locked(root: PathBuf, reason: &str) -> Result<String, String> {
    // 步骤1：破坏性历史操作前保存当前 HEAD 引用。
    let branch = format!("dinotty-safety/{reason}-{}", git_command_timestamp());
    let arguments = vec!["branch".to_string(), branch.clone(), "HEAD".to_string()];
    let output = run_git_tracked_output_locked(root, arguments, None, Vec::new()).await?;
    if !output.status.success() {
        return Err(git_command_error_message(&output.stdout, &output.stderr));
    }
    Ok(branch)
}
fn git_command_tracker() -> &'static Mutex<GitCommandTracker> {
    // 步骤1：所有 Web 与桌面请求共享同一份进程记录和取消状态。
    GIT_COMMAND_TRACKER.get_or_init(|| Mutex::new(GitCommandTracker::default()))
}

fn git_command_timestamp() -> u64 {
    // 步骤1：用 Unix 毫秒记录开始和结束时间，便于前端稳定排序。
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn git_command_records_for_root(tracker: &GitCommandTracker, root: &Path) -> Vec<GitCommandRecord> {
    // 步骤1：只复制当前仓库的记录，避免多仓库面板互相泄露操作信息。
    let mut records = Vec::new();
    for record in &tracker.records {
        if record.root == root {
            records.push(record.clone());
        }
    }
    records
}

fn request_git_command_cancellation(
    tracker: &mut GitCommandTracker,
    root: &Path,
    id: &str,
) -> bool {
    // 步骤1：命令 ID 和仓库都匹配时才设置取消标记。
    for cancellation in &tracker.cancellations {
        if cancellation.id == id && cancellation.root == root {
            cancellation.requested.store(true, Ordering::SeqCst);
            return true;
        }
    }
    false
}

pub async fn workspace_git_command_log(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：确认当前面板仓库，再读取该仓库最近的命令记录。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let tracker = git_command_tracker().lock().unwrap_or_else(|error| error.into_inner());
    let commands = git_command_records_for_root(&tracker, &root);
    Json(GitCommandLogResponse { commands }).into_response()
}

pub async fn workspace_git_command_cancel(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitCommandCancelBody>,
) -> Response {
    // 步骤1：确认仓库和命令 ID，不允许跨仓库取消进程。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    if body.id.trim().is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "command id required");
    }
    let mut tracker = git_command_tracker().lock().unwrap_or_else(|error| error.into_inner());
    if !request_git_command_cancellation(&mut tracker, &root, body.id.trim()) {
        return json_err(StatusCode::NOT_FOUND, "running command not found");
    }

    // 步骤2：实际进程由执行线程结束，接口立即确认取消请求已送达。
    Json(serde_json::json!({ "ok": true })).into_response()
}

fn sanitize_git_command(arguments: &[String]) -> String {
    // 步骤1：逐参数生成展示命令，Remote URL 和提交说明始终脱敏。
    let mut sanitized_arguments = Vec::new();
    let clone_command = arguments.first().map(String::as_str) == Some("clone");
    let mut clone_url_index: Option<usize> = None;
    if clone_command {
        // 步骤2：克隆 URL 是选项结束标记后的首个位置参数，不能按固定索引判断。
        let mut options_ended = false;
        for (index, argument) in arguments.iter().enumerate().skip(1) {
            if argument == "--" {
                options_ended = true;
                continue;
            }
            if options_ended || !argument.starts_with('-') {
                clone_url_index = Some(index);
                break;
            }
        }
    }
    let remote_command = arguments.first().map(String::as_str) == Some("remote");
    let remote_action = arguments.get(1).map(String::as_str).unwrap_or("");
    let mut redact_next_message = false;
    for (index, argument) in arguments.iter().enumerate() {
        let redacts_clone_url = clone_url_index == Some(index);
        let redacts_remote_url = remote_command
            && ((remote_action == "add" && index >= 3)
                || (remote_action == "set-url" && index == arguments.len() - 1));
        if redacts_clone_url || redacts_remote_url {
            sanitized_arguments.push("[redacted-url]".to_string());
        } else if redact_next_message {
            sanitized_arguments.push("[redacted-message]".to_string());
            redact_next_message = false;
        } else {
            sanitized_arguments.push(argument.to_string());
            if argument == "-m" || argument == "--message" {
                redact_next_message = true;
            }
        }
    }
    let mut command = String::from("git");
    for argument in sanitized_arguments {
        command.push(' ');
        command.push_str(&argument);
    }
    command
}

fn redact_git_output(value: &str) -> String {
    // 步骤1：逐个查找带协议的 URL，只处理主机名前的凭据片段。
    let mut redacted = value.to_string();
    let mut search_start = 0usize;
    loop {
        let Some(relative_scheme_end) = redacted[search_start..].find("://") else { break };
        let credentials_start = search_start + relative_scheme_end + 3;
        let remaining = &redacted[credentials_start..];
        let mut credentials_end = None;
        for (offset, character) in remaining.char_indices() {
            if character == '@' {
                credentials_end = Some(credentials_start + offset);
                break;
            }
            if character == '/'
                || character.is_whitespace()
                || character == '\''
                || character == '"'
            {
                break;
            }
        }

        // 步骤2：存在凭据时替换为固定标记，否则继续扫描下一个 URL。
        if let Some(credentials_end) = credentials_end {
            redacted.replace_range(credentials_start..credentials_end, "[redacted]");
            search_start = credentials_start + "[redacted]".len() + 1;
        } else {
            search_start = credentials_start;
        }
        if search_start >= redacted.len() {
            break;
        }
    }
    redacted
}

fn truncate_git_command_output(value: &str) -> String {
    // 步骤1：最多保留两千个字符，避免长期日志无限占用内存。
    let mut output = String::new();
    let mut character_count = 0;
    for character in value.chars() {
        if character_count >= 2_000 {
            output.push_str("\n[output truncated]");
            break;
        }
        output.push(character);
        character_count += 1;
    }
    output
}

fn update_running_git_command_output(tracker: &mut GitCommandTracker, id: &str, output: &str) {
    // 步骤1：只更新仍在运行的匹配命令，避免轮询结果覆盖最终状态。
    for record in &mut tracker.records {
        if record.id == id && record.status == "running" {
            record.output = truncate_git_command_output(output);
            break;
        }
    }
}

fn read_git_command_output(stdout_path: &Path, stderr_path: &Path) -> String {
    // 步骤1：读取进程当前已写出的标准输出和错误输出。
    let stdout = std::fs::read(stdout_path).unwrap_or_default();
    let stderr = std::fs::read(stderr_path).unwrap_or_default();
    let stdout_text = String::from_utf8_lossy(&stdout);
    let stderr_text = String::from_utf8_lossy(&stderr);

    // 步骤2：按最终日志相同的顺序合并两路输出。
    let mut display_output = stdout_text.trim().to_string();
    if !stderr_text.trim().is_empty() {
        if !display_output.is_empty() {
            display_output.push('\n');
        }
        display_output.push_str(stderr_text.trim());
    }
    redact_git_output(&display_output)
}

fn finish_tracked_git_command(
    id: &str,
    status: &str,
    output: &str,
    cancellation_requested: &Arc<AtomicBool>,
) {
    // 步骤1：更新匹配记录并移除活动取消令牌。
    let mut tracker = git_command_tracker().lock().unwrap_or_else(|error| error.into_inner());
    for record in &mut tracker.records {
        if record.id == id {
            record.status = status.to_string();
            record.finished_at = Some(git_command_timestamp());
            record.output = truncate_git_command_output(output);
            break;
        }
    }
    let mut cancellation_index = 0;
    while cancellation_index < tracker.cancellations.len() {
        if Arc::ptr_eq(&tracker.cancellations[cancellation_index].requested, cancellation_requested)
        {
            tracker.cancellations.remove(cancellation_index);
            break;
        }
        cancellation_index += 1;
    }
}

fn terminate_git_process_tree(child: &mut std::process::Child) {
    // 步骤1：Windows 终止整个 Git/SSH 子进程树，其他平台终止当前 Git 进程。
    if cfg!(windows) {
        let process_id = child.id().to_string();
        let mut command = std::process::Command::new("taskkill");
        command.no_window();
        let _ = command.args(["/PID", &process_id, "/T", "/F"]).output();
    } else {
        let _ = child.kill();
    }
}

async fn run_git_tracked_output(
    root: PathBuf,
    arguments: Vec<String>,
) -> Result<std::process::Output, String> {
    // 步骤1：同一仓库的写命令串行执行，避免 index.lock 和状态竞争。
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;
    run_git_tracked_output_locked(root, arguments, None, Vec::new()).await
}

async fn run_git_tracked_output_with_input(
    root: PathBuf,
    arguments: Vec<String>,
    input: Vec<u8>,
) -> Result<std::process::Output, String> {
    // 步骤1：带标准输入的写命令复用相同仓库锁，避免 Patch 与其他操作竞争。
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;
    run_git_tracked_output_locked(root, arguments, Some(input), Vec::new()).await
}

async fn run_git_tracked_output_locked(
    root: PathBuf,
    arguments: Vec<String>,
    input: Option<Vec<u8>>,
    environment: Vec<(String, String)>,
) -> Result<std::process::Output, String> {
    // 步骤1：命令执行前写入运行记录和取消令牌；调用方已经持有仓库操作锁。
    let command_id = uuid::Uuid::new_v4().to_string();
    let cancellation_requested = Arc::new(AtomicBool::new(false));
    {
        let mut tracker = git_command_tracker().lock().unwrap_or_else(|error| error.into_inner());
        tracker.records.push_front(GitCommandRecord {
            id: command_id.clone(),
            command: sanitize_git_command(&arguments),
            status: "running".to_string(),
            started_at: git_command_timestamp(),
            finished_at: None,
            output: String::new(),
            root: root.clone(),
        });
        while tracker.records.len() > 100 {
            tracker.records.pop_back();
        }
        tracker.cancellations.push(GitCommandCancellation {
            id: command_id.clone(),
            root: root.clone(),
            requested: cancellation_requested.clone(),
        });
    }

    // 步骤2：把输出写入临时文件并轮询进程，使取消请求可以及时生效。
    let worker_cancellation = cancellation_requested.clone();
    let worker_command_id = command_id.clone();
    let result = tokio::task::spawn_blocking(move || {
        let stdout_file = tempfile::NamedTempFile::new().map_err(|error| error.to_string())?;
        let stderr_file = tempfile::NamedTempFile::new().map_err(|error| error.to_string())?;
        let stdout_handle = stdout_file.reopen().map_err(|error| error.to_string())?;
        let stderr_handle = stderr_file.reopen().map_err(|error| error.to_string())?;
        let mut command = git_command();
        command.args(arguments).current_dir(root);
        for (name, value) in environment {
            command.env(name, value);
        }
        if input.is_some() {
            command.stdin(Stdio::piped());
        } else {
            command.stdin(Stdio::null());
        }
        let mut child = command
            .stdout(Stdio::from(stdout_handle))
            .stderr(Stdio::from(stderr_handle))
            .spawn()
            .map_err(|error| error.to_string())?;
        if let Some(input) = input {
            use std::io::Write;
            let mut stdin = child.stdin.take().ok_or("git stdin unavailable".to_string())?;
            stdin.write_all(&input).map_err(|error| error.to_string())?;
        }
        let status = loop {
            if worker_cancellation.load(Ordering::SeqCst) {
                terminate_git_process_tree(&mut child);
                break child.wait().map_err(|error| error.to_string())?;
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    let display_output =
                        read_git_command_output(stdout_file.path(), stderr_file.path());
                    if !display_output.is_empty() {
                        let mut tracker =
                            git_command_tracker().lock().unwrap_or_else(|error| error.into_inner());
                        update_running_git_command_output(
                            &mut tracker,
                            &worker_command_id,
                            &display_output,
                        );
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(error) => return Err(error.to_string()),
            }
        };
        let stdout = std::fs::read(stdout_file.path()).map_err(|error| error.to_string())?;
        let stderr = std::fs::read(stderr_file.path()).map_err(|error| error.to_string())?;
        Ok(std::process::Output { status, stdout, stderr })
    })
    .await;

    // 步骤3：统一更新成功、失败或取消状态，并返回原始 Git 输出。
    match result {
        Ok(Ok(output)) => {
            let cancelled = cancellation_requested.load(Ordering::SeqCst);
            let status = if cancelled {
                "cancelled"
            } else if output.status.success() {
                "success"
            } else {
                "failed"
            };
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let mut display_output = stdout.trim().to_string();
            if !stderr.trim().is_empty() {
                if !display_output.is_empty() {
                    display_output.push('\n');
                }
                display_output.push_str(stderr.trim());
            }
            let display_output = redact_git_output(&display_output);
            finish_tracked_git_command(
                &command_id,
                status,
                &display_output,
                &cancellation_requested,
            );
            Ok(output)
        }
        Ok(Err(error)) => {
            finish_tracked_git_command(&command_id, "failed", &error, &cancellation_requested);
            Err(error)
        }
        Err(error) => {
            let error_message = error.to_string();
            finish_tracked_git_command(
                &command_id,
                "failed",
                &error_message,
                &cancellation_requested,
            );
            Err(error_message)
        }
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
    run_git_tracked_output(root, arguments).await
}

fn git_command_response(output: &std::process::Output) -> Response {
    // 步骤1：成功时返回 Git 的简短输出，便于提交后显示摘要。
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stdout.is_empty() { stderr } else { stdout };
        let message = redact_git_output(&message);
        return Json(serde_json::json!({ "ok": true, "output": message })).into_response();
    }

    // 步骤2：失败时合并两路输出，部分 Git 命令只会把失败原因写入 stdout。
    let message = git_command_error_message(&output.stdout, &output.stderr);
    json_err(StatusCode::BAD_REQUEST, &message)
}

fn git_command_error_message(stdout: &[u8], stderr: &[u8]) -> String {
    // 步骤1：优先显示标准错误，再补充标准输出中的上下文。
    let stdout_message = String::from_utf8_lossy(stdout).trim().to_string();
    let stderr_message = String::from_utf8_lossy(stderr).trim().to_string();
    let mut message = stderr_message;
    if !stdout_message.is_empty() {
        if !message.is_empty() {
            message.push('\n');
        }
        message.push_str(&stdout_message);
    }

    // 步骤2：只有 Git 确实没有返回任何文字时才使用通用兜底提示。
    if message.is_empty() {
        return "git command failed".to_string();
    }
    append_git_error_hint(redact_git_output(&message))
}

fn append_git_error_hint(mut message: String) -> String {
    // 步骤1：按常见 Git 失败文本追加中文处理建议，保留原始输出方便排查。
    let lower_message = message.to_lowercase();
    let hint = if lower_message.contains("authentication failed")
        || lower_message.contains("could not read username")
        || lower_message.contains("permission denied")
        || lower_message.contains("repository not found")
    {
        Some("Dinotty 提示：远程认证失败，请检查凭据助手、SSH key、仓库地址或账号权限。")
    } else if lower_message.contains("no upstream branch")
        || lower_message.contains("no tracking information")
    {
        Some("Dinotty 提示：当前分支没有 upstream，请先发布分支或在远程管理里设置跟踪分支。")
    } else if lower_message.contains("non-fast-forward")
        || lower_message.contains("fetch first")
        || lower_message.contains("rejected")
    {
        Some("Dinotty 提示：远程有本地没有的提交，请先 Fetch/Pull 并处理冲突后再 Push。")
    } else if lower_message.contains("local changes")
        || lower_message.contains("would be overwritten")
        || lower_message.contains("working tree clean")
    {
        Some("Dinotty 提示：工作区状态不满足该操作，请先提交、暂存、储藏或丢弃相关改动。")
    } else {
        None
    };

    // 步骤2：避免重复追加同一提示。
    if let Some(hint) = hint {
        if !message.contains(hint) {
            message.push('\n');
            message.push_str(hint);
        }
    }
    message
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

    // 步骤2：执行暂存并写入统一命令日志。
    match run_git_tracked_output(root, arguments).await {
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
    match run_git_tracked_output(root, arguments).await {
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
    match run_git_tracked_output(root, arguments).await {
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

    // 步骤2：丢弃前先备份当前内容，降低误操作造成的不可逆损失。
    if let Err(error) = backup_git_paths(root.clone(), &[path.clone()], "discard").await {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error);
    }

    // 步骤3：未跟踪文件直接删除，已跟踪文件交给 Git 恢复工作区版本。
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

    // 步骤4：恢复已跟踪文件的工作区版本。
    let arguments = vec!["restore".to_string(), "--worktree".to_string(), "--".to_string(), path];
    match run_git_tracked_output(root, arguments).await {
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
    match run_git_tracked_output(root, arguments).await {
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

pub async fn workspace_git_stash_diff(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<GitStashDiffQuery>,
) -> Response {
    // 步骤1：验证仓库和 Stash 引用，再读取包含未跟踪文件的完整补丁。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let reference = try_res!(validate_stash_reference(&query.reference));
    let arguments = vec![
        "stash".to_string(),
        "show".to_string(),
        "--patch".to_string(),
        "--include-untracked".to_string(),
        "--no-color".to_string(),
        reference,
    ];
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            if output.stdout.len() > MAX_GIT_DIFF_OUTPUT {
                return json_err(StatusCode::PAYLOAD_TOO_LARGE, "stash diff too large");
            }
            let patch = String::from_utf8_lossy(&output.stdout).into_owned();
            Json(serde_json::json!({ "patch": patch })).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn build_stash_save_arguments(
    message: &str,
    include_untracked: bool,
    keep_index: bool,
    staged_only: bool,
    paths: &[String],
) -> Vec<String> {
    // 步骤1：按开关追加未跟踪文件、保留暂存区和仅暂存模式。
    let mut arguments = vec!["stash".to_string(), "push".to_string()];
    if include_untracked {
        arguments.push("--include-untracked".to_string());
    }
    if keep_index {
        arguments.push("--keep-index".to_string());
    }
    if staged_only {
        arguments.push("--staged".to_string());
    }

    // 步骤2：说明位于路径分隔符之前，选中文件位于 -- 之后。
    if !message.is_empty() {
        arguments.push("-m".to_string());
        arguments.push(message.to_string());
    }
    if !paths.is_empty() {
        arguments.push("--".to_string());
        for path in paths {
            arguments.push(path.clone());
        }
    }
    arguments
}

pub async fn workspace_git_stash_save(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitStashSaveBody>,
) -> Response {
    // 步骤1：验证选择模式和文件路径，禁止仅暂存模式与显式路径混用。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    if body.staged_only && !body.paths.is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "staged stash cannot include paths");
    }
    if body.staged_only && body.include_untracked {
        return json_err(StatusCode::BAD_REQUEST, "staged stash cannot include untracked files");
    }
    let paths = if body.paths.is_empty() {
        Vec::new()
    } else {
        try_res!(validate_git_paths(&root, &body.paths))
    };
    let message = body.message.trim();
    let arguments = build_stash_save_arguments(
        message,
        body.include_untracked,
        body.keep_index,
        body.staged_only,
        &paths,
    );

    // 步骤2：执行保存并返回 Git 的真实提示。
    match run_git_tracked_output(root, arguments).await {
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
    match run_git_tracked_output(root, arguments).await {
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
        match run_git_tracked_output(root.clone(), checkout_arguments).await {
            Ok(output) if output.status.success() => {}
            Ok(output) => return git_command_response(&output),
            Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
        }
    }
    let add_arguments = vec!["add".to_string(), "--".to_string(), path];
    match run_git_tracked_output(root, add_arguments).await {
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
    let check_arguments =
        vec!["ls-files".to_string(), "--unmerged".to_string(), "--".to_string(), path.clone()];
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
    match run_git_tracked_output(root, add_arguments).await {
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
    match run_git_tracked_output(root, arguments).await {
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

pub async fn workspace_git_rebase_candidates(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：只读取当前 HEAD 的第一父提交链，避免把其他分支历史放入重写范围。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let arguments = vec![
        "log".to_string(),
        "--first-parent".to_string(),
        "--max-count=31".to_string(),
        "--date=iso-strict".to_string(),
        "--decorate=short".to_string(),
        "--pretty=format:%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%D%x00%s%x1e".to_string(),
        "HEAD".to_string(),
    ];
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            // 步骤2：遇到根提交或合并提交即停止，只返回可安全线性重写的最新连续范围。
            let stdout = String::from_utf8_lossy(&output.stdout);
            let parsed_commits = parse_log_output(&stdout);
            let mut commits = Vec::new();
            for commit in parsed_commits {
                if commit.parents.len() != 1 {
                    break;
                }
                commits.push(commit);
                if commits.len() >= 30 {
                    break;
                }
            }
            Json(GitRebaseCandidatesResponse { commits }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_rebase_plan(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitRebasePlanBody>,
) -> Response {
    // 步骤1：历史重写必须由界面明确确认，并限制单次计划规模。
    if !body.confirm_rewrite {
        return json_err(StatusCode::BAD_REQUEST, "history rewrite confirmation required");
    }
    if body.entries.is_empty() || body.entries.len() > 30 {
        return json_err(StatusCode::BAD_REQUEST, "invalid rebase plan size");
    }
    let upstream = try_res!(validate_commit_hash(&body.upstream));
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));

    // 步骤2：执行受控交互式 Rebase，并返回 Git 的真实冲突或成功信息。
    match run_rebase_plan(root, upstream, body.entries).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn validate_rebase_plan_entries(entries: &[GitRebasePlanEntry]) -> Result<(), String> {
    // 步骤1：逐项校验提交、动作和 Reword 说明，并拒绝重复提交。
    let mut validated_commits = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let commit = validate_commit_hash(&entry.commit).map_err(|_| "invalid rebase commit")?;
        if validated_commits.contains(&commit) {
            return Err("duplicate rebase commit".to_string());
        }
        validated_commits.push(commit);

        let valid_action = entry.action == "pick"
            || entry.action == "squash"
            || entry.action == "fixup"
            || entry.action == "reword";
        if !valid_action {
            return Err("invalid rebase action".to_string());
        }
        if index == 0 && (entry.action == "squash" || entry.action == "fixup") {
            return Err("first rebase action cannot combine with a previous commit".to_string());
        }
        if entry.action == "reword" && entry.message.trim().is_empty() {
            return Err("reword message required".to_string());
        }
        if entry.message.len() > 10_000 {
            return Err("reword message too long".to_string());
        }
    }
    Ok(())
}

fn quote_shell_path(path: &Path) -> String {
    // 步骤1：使用 POSIX 单引号规则保护 Rebase todo 中由 shell 执行的受控文件路径。
    let normalized_path = path.to_string_lossy().replace('\\', "/");
    let escaped_path = normalized_path.replace('\'', "'\"'\"'");
    format!("'{escaped_path}'")
}

fn build_rebase_todo(
    entries: &[GitRebasePlanEntry],
    plan_directory: &Path,
) -> Result<String, String> {
    // 步骤1：按界面顺序生成 todo，Squash 和 Fixup 直接使用 Git 原生命令。
    let mut todo = String::new();
    for (index, entry) in entries.iter().enumerate() {
        let command = if entry.action == "reword" { "pick" } else { entry.action.as_str() };
        todo.push_str(command);
        todo.push(' ');
        todo.push_str(&entry.commit);
        todo.push('\n');

        // 步骤2：Reword 通过受控消息文件执行 amend，避免把用户文本拼入 shell 命令。
        if entry.action == "reword" {
            let message_path = plan_directory.join(format!("message-{index}.txt"));
            std::fs::write(&message_path, entry.message.trim())
                .map_err(|error| error.to_string())?;
            todo.push_str("exec git commit --amend --no-verify -F ");
            todo.push_str(&quote_shell_path(&message_path));
            todo.push('\n');
        }
    }
    Ok(todo)
}

async fn validate_rebase_plan_range(
    root: PathBuf,
    upstream: &str,
    entries: &[GitRebasePlanEntry],
) -> Result<(), String> {
    // 步骤1：读取上游到 HEAD 的线性提交，确保计划没有遗漏或混入其他分支提交。
    let revision_range = format!("{upstream}..HEAD");
    let arguments = vec![
        "rev-list".to_string(),
        "--reverse".to_string(),
        "--first-parent".to_string(),
        revision_range.clone(),
    ];
    let output = run_git_output(root.clone(), arguments).await?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let expected_commits: Vec<&str> = stdout.lines().collect();
    if expected_commits.len() != entries.len() {
        return Err("rebase plan must include every commit from upstream to HEAD".to_string());
    }
    for expected_commit in expected_commits {
        let mut found = false;
        for entry in entries {
            if entry.commit == expected_commit {
                found = true;
                break;
            }
        }
        if !found {
            return Err("rebase plan contains commits outside the current HEAD range".to_string());
        }
    }

    // 步骤2：显式拒绝范围内的合并提交，避免普通交互式 Rebase 意外压平分支结构。
    let merge_arguments = vec!["rev-list".to_string(), "--merges".to_string(), revision_range];
    let merge_output = run_git_output(root, merge_arguments).await?;
    if !merge_output.status.success() {
        return Err(String::from_utf8_lossy(&merge_output.stderr).trim().to_string());
    }
    if !merge_output.stdout.is_empty() {
        return Err("rebase plan cannot rewrite merge commits".to_string());
    }
    Ok(())
}

async fn run_rebase_plan(
    root: PathBuf,
    upstream: String,
    entries: Vec<GitRebasePlanEntry>,
) -> Result<std::process::Output, String> {
    // 步骤1：校验字段后锁定仓库，使范围验证和历史改写之间不会插入其他写操作。
    validate_rebase_plan_entries(&entries)?;
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;
    validate_rebase_plan_range(root.clone(), &upstream, &entries).await?;

    // 步骤2：读取实际 Git 目录，拒绝覆盖正在进行的 Rebase。
    let git_directory_arguments = vec!["rev-parse".to_string(), "--absolute-git-dir".to_string()];
    let git_directory_output = run_git_output(root.clone(), git_directory_arguments).await?;
    if !git_directory_output.status.success() {
        return Err(String::from_utf8_lossy(&git_directory_output.stderr).trim().to_string());
    }
    let git_directory_text =
        String::from_utf8_lossy(&git_directory_output.stdout).trim().to_string();
    let git_directory = PathBuf::from(git_directory_text);
    if git_directory.join("rebase-merge").exists() || git_directory.join("rebase-apply").exists() {
        return Err("a rebase operation is already in progress".to_string());
    }

    // 步骤3：把 todo 和 Reword 消息写入 Git 目录，冲突暂停后仍可继续使用。
    let plan_directory = git_directory.join("dinotty-rebase-plan");
    if plan_directory.exists() {
        std::fs::remove_dir_all(&plan_directory).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(&plan_directory).map_err(|error| error.to_string())?;
    let todo = build_rebase_todo(&entries, &plan_directory)?;
    let todo_path = plan_directory.join("todo.txt");
    std::fs::write(&todo_path, todo).map_err(|error| error.to_string())?;

    // 步骤4：让 Git 的序列编辑器用受控 todo 替换默认计划，再启动交互式 Rebase。
    let sequence_editor = if cfg!(windows) {
        let editor_path = plan_directory.join("sequence-editor.ps1");
        let editor_script = concat!(
            "param([string]$TargetPath)\n",
            "Copy-Item -LiteralPath $env:DINOTTY_REBASE_TODO -Destination $TargetPath -Force\n"
        );
        std::fs::write(&editor_path, editor_script).map_err(|error| error.to_string())?;
        let normalized_editor_path = editor_path.to_string_lossy().replace('\\', "/");
        format!(
            "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{normalized_editor_path}\""
        )
    } else {
        format!("cp {}", quote_shell_path(&todo_path))
    };
    let environment = vec![
        ("GIT_SEQUENCE_EDITOR".to_string(), sequence_editor),
        ("DINOTTY_REBASE_TODO".to_string(), todo_path.to_string_lossy().into_owned()),
    ];
    let arguments = vec!["rebase".to_string(), "-i".to_string(), upstream];
    let output = run_git_tracked_output_locked(root, arguments, None, environment).await?;

    // 步骤5：成功后清理计划文件；冲突失败时保留文件供继续操作使用。
    if output.status.success() {
        std::fs::remove_dir_all(&plan_directory).map_err(|error| error.to_string())?;
    }
    Ok(output)
}

pub async fn workspace_git_cherry_pick(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitCherryPickBody>,
) -> Response {
    // 步骤1：优先读取批量提交，并兼容原有的单提交请求字段。
    let mut requested_commits = body.commits;
    if requested_commits.is_empty() {
        if let Some(commit) = body.commit {
            requested_commits.push(commit);
        }
    }
    if requested_commits.is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "at least one commit is required");
    }

    // 步骤2：逐个验证提交 ID，保持请求顺序生成一次 Cherry-pick 命令。
    let mut commits = Vec::new();
    for requested_commit in requested_commits {
        let commit = try_res!(validate_commit_hash(&requested_commit));
        commits.push(commit);
    }
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    match run_cherry_pick_sequence(root, &commits).await {
        Ok(result) if result.output.status.success() && result.skipped_count == commits.len() => {
            Json(serde_json::json!({
                "ok": true,
                "result_code": "nothing_to_cherry_pick",
            }))
            .into_response()
        }
        Ok(result) => git_command_response(&result.output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn build_cherry_pick_arguments(commits: &[String]) -> Vec<String> {
    // 步骤1：固定子命令放在首位，再按用户选择顺序追加每个提交。
    let mut arguments = vec!["cherry-pick".to_string()];
    for commit in commits {
        arguments.push(commit.to_string());
    }
    arguments
}

struct GitCherryPickSequenceResult {
    output: std::process::Output,
    skipped_count: usize,
}

async fn run_cherry_pick_sequence(
    root: PathBuf,
    commits: &[String],
) -> Result<GitCherryPickSequenceResult, String> {
    // 步骤1：整个 Cherry-pick 序列共用仓库锁，避免跳过间隙插入其他写操作。
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;
    let arguments = build_cherry_pick_arguments(commits);
    let mut output =
        run_git_tracked_output_locked(root.clone(), arguments, None, Vec::new()).await?;
    let mut skipped_count = 0usize;

    // 步骤2：提交改动已经存在时跳过当前项，让 Git 自动继续处理序列中的下一项。
    while git_cherry_pick_requires_skip(&output) && skipped_count < commits.len() {
        let skip_arguments = vec!["cherry-pick".to_string(), "--skip".to_string()];
        output =
            run_git_tracked_output_locked(root.clone(), skip_arguments, None, Vec::new()).await?;
        skipped_count += 1;
    }
    Ok(GitCherryPickSequenceResult { output, skipped_count })
}

fn git_cherry_pick_requires_skip(output: &std::process::Output) -> bool {
    // 步骤1：只识别 Git 明确要求执行 --skip 的空提交状态，冲突和 Hook 错误继续返回失败。
    if output.status.success() {
        return false;
    }
    let stdout_message = String::from_utf8_lossy(&output.stdout);
    let stderr_message = String::from_utf8_lossy(&output.stderr);
    stdout_message.contains("please use 'git cherry-pick --skip'")
        || stderr_message.contains("please use 'git cherry-pick --skip'")
}

pub async fn workspace_git_revert_commit(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitCommitActionBody>,
) -> Response {
    // 步骤1：验证提交 ID，并创建不打开编辑器的反向提交。
    let commit = try_res!(validate_commit_hash(&body.commit));
    let arguments = build_revert_commit_arguments(&commit);
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    match run_git_tracked_output(root, arguments).await {
        Ok(output)
            if !output.status.success()
                && git_revert_has_no_changes(&output.stdout, &output.stderr) =>
        {
            // 步骤2：目标提交的改动已被还原时无需再创建空提交，按无操作成功返回。
            Json(serde_json::json!({
                "ok": true,
                "result_code": "nothing_to_revert",
            }))
            .into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn build_revert_commit_arguments(commit: &str) -> Vec<String> {
    // 步骤1：固定关闭提交说明编辑器，再追加已验证的提交 ID。
    vec!["revert".to_string(), "--no-edit".to_string(), commit.to_string()]
}

fn git_revert_has_no_changes(stdout: &[u8], stderr: &[u8]) -> bool {
    // 步骤1：存在标准错误时仍按真实失败处理，避免把 Hook 等错误误判为成功。
    let stderr_message = String::from_utf8_lossy(stderr);
    if !stderr_message.trim().is_empty() {
        return false;
    }

    // 步骤2：Git 在目标改动已不存在时只向 stdout 输出固定提示并返回退出码 1。
    let stdout_message = String::from_utf8_lossy(stdout);
    for line in stdout_message.lines() {
        if line.trim() == "nothing to commit, working tree clean" {
            return true;
        }
    }
    false
}

async fn run_hard_reset(root: PathBuf, target: String) -> Result<std::process::Output, String> {
    // 步骤1：整个保护和重置流程共用一把仓库锁，防止其他面板操作插入中间状态。
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;
    create_safety_branch_locked(root.clone(), "reset").await?;

    // 步骤2：检测受跟踪的暂存和工作区改动；存在改动时保存到独立 Stash。
    let status_arguments =
        vec!["status".to_string(), "--porcelain".to_string(), "--untracked-files=no".to_string()];
    let status_output = run_git_output(root.clone(), status_arguments).await?;
    if !status_output.status.success() {
        return Err(git_command_error_message(&status_output.stdout, &status_output.stderr));
    }
    if !status_output.stdout.is_empty() {
        let stash_message = format!("Dinotty Hard Reset 安全备份 {}", git_command_timestamp());
        let stash_arguments =
            vec!["stash".to_string(), "push".to_string(), "-m".to_string(), stash_message];
        let stash_output =
            run_git_tracked_output_locked(root.clone(), stash_arguments, None, Vec::new()).await?;
        if !stash_output.status.success() {
            return Err(git_command_error_message(&stash_output.stdout, &stash_output.stderr));
        }
    }

    // 步骤3：保护信息均已落盘后执行 Hard Reset，失败时仍保留安全分支和 Stash。
    let reset_arguments = vec!["reset".to_string(), "--hard".to_string(), target];
    run_git_tracked_output_locked(root, reset_arguments, None, Vec::new()).await
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
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let output = if mode == "hard" {
        run_hard_reset(root, target).await
    } else {
        let arguments = vec!["reset".to_string(), format!("--{mode}"), target];
        run_git_tracked_output(root, arguments).await
    };
    match output {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
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

    // 步骤2：按优先级识别操作，并读取目标提交和 Rebase 进度。
    let mut operation = None;
    let mut target = None;
    let mut progress_current = None;
    let mut progress_total = None;
    let rebase_merge_directory = git_dir.join("rebase-merge");
    let rebase_apply_directory = git_dir.join("rebase-apply");
    if rebase_merge_directory.exists() {
        operation = Some("rebase".to_string());
        target = read_git_state_text(&rebase_merge_directory.join("stopped-sha"));
        if target.is_none() {
            target = read_git_state_text(&rebase_merge_directory.join("onto"));
        }
        progress_current = read_git_state_number(&rebase_merge_directory.join("msgnum"));
        progress_total = read_git_state_number(&rebase_merge_directory.join("end"));
    } else if rebase_apply_directory.exists() {
        operation = Some("rebase".to_string());
        target = read_git_state_text(&rebase_apply_directory.join("original-commit"));
        progress_current = read_git_state_number(&rebase_apply_directory.join("next"));
        progress_total = read_git_state_number(&rebase_apply_directory.join("last"));
    } else if git_dir.join("MERGE_HEAD").exists() {
        operation = Some("merge".to_string());
        target = read_git_state_text(&git_dir.join("MERGE_HEAD"));
    } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
        operation = Some("cherry-pick".to_string());
        target = read_git_state_text(&git_dir.join("CHERRY_PICK_HEAD"));
    } else if git_dir.join("REVERT_HEAD").exists() {
        operation = Some("revert".to_string());
        target = read_git_state_text(&git_dir.join("REVERT_HEAD"));
    } else if git_dir.join("BISECT_START").exists() {
        operation = Some("bisect".to_string());
        target = read_git_state_text(&git_dir.join("BISECT_EXPECTED_REV"));
        if target.is_none() {
            target = read_git_state_text(&git_dir.join("BISECT_START"));
        }
    } else if let Some((sequencer_operation, sequencer_target)) = read_sequencer_operation(&git_dir)
    {
        operation = Some(sequencer_operation);
        target = Some(sequencer_target);
    }
    Json(GitOperationStateResponse { operation, target, progress_current, progress_total })
        .into_response()
}

fn read_sequencer_operation(git_dir: &Path) -> Option<(String, String)> {
    // 步骤1：读取批量 Cherry-pick 或 Revert 剩余计划，兼容 HEAD 标记被 Reset 清除的状态。
    let todo_path = git_dir.join("sequencer").join("todo");
    let todo = std::fs::read_to_string(todo_path).ok()?;
    for line in todo.lines() {
        let mut fields = line.split_whitespace();
        let action = fields.next()?;
        let target = fields.next()?;
        if action == "pick" {
            return Some(("cherry-pick".to_string(), target.to_string()));
        }
        if action == "revert" {
            return Some(("revert".to_string(), target.to_string()));
        }
    }
    None
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
    let valid_action = action == "continue"
        || action == "abort"
        || action == "quit"
        || (action == "skip" && operation != "merge");
    if !valid_operation || !valid_action {
        return json_err(StatusCode::BAD_REQUEST, "invalid operation action");
    }
    let arguments = vec![operation.to_string(), format!("--{action}")];
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    match run_git_tracked_output(root.clone(), arguments).await {
        Ok(output) => {
            // 步骤2：继续完成或中止成功后清理 Dinotty 保存的 Rebase 计划文件。
            if output.status.success() {
                let git_dir_arguments =
                    vec!["rev-parse".to_string(), "--absolute-git-dir".to_string()];
                if let Ok(git_dir_output) = run_git_output(root, git_dir_arguments).await {
                    if git_dir_output.status.success() {
                        let git_dir_text = String::from_utf8_lossy(&git_dir_output.stdout);
                        let plan_directory =
                            PathBuf::from(git_dir_text.trim()).join("dinotty-rebase-plan");
                        if plan_directory.exists() {
                            let _ = std::fs::remove_dir_all(plan_directory);
                        }
                    }
                }
            }
            git_command_response(&output)
        }
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_reflog(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：读取最近一百条 HEAD 引用日志，保留选择器、提交和操作说明。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let arguments = vec![
        "reflog".to_string(),
        "show".to_string(),
        "--max-count=100".to_string(),
        "--date=iso-strict".to_string(),
        "--format=%gd%x00%H%x00%h%x00%gs%x00%cI%x1e".to_string(),
        "HEAD".to_string(),
    ];
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            Json(GitReflogResponse { entries: parse_reflog_output(&stdout) }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_config(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：并行读取仓库级与全局配置，界面据此明确展示当前作用域。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let local_future = read_git_config_scope(root.clone(), "--local");
    let global_future = read_git_config_scope(root, "--global");
    let (local_result, global_result) = tokio::join!(local_future, global_future);
    let local = match local_result {
        Ok(configuration) => configuration,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let global = match global_result {
        Ok(configuration) => configuration,
        Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    Json(GitConfigResponse { local, global }).into_response()
}

pub async fn workspace_git_config_update(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitConfigUpdateBody>,
) -> Response {
    // 步骤1：验证作用域和值，并生成固定白名单命令。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let commands = match build_git_config_update_commands(&body) {
        Ok(commands) => commands,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };

    // 步骤2：全局配置跨仓库共用固定锁，本地配置使用仓库锁。
    let lock_key = if body.scope == "global" {
        PathBuf::from("dinotty-global-git-config")
    } else {
        root.clone()
    };
    let operation_lock = git_repository_operation_lock(&lock_key);
    let _operation_guard = operation_lock.lock().await;

    // 步骤3：逐项写入配置；取消一个原本不存在的键视为成功。
    for arguments in commands {
        let unsets_value = arguments.iter().any(|argument| argument == "--unset-all");
        let output =
            match run_git_tracked_output_locked(root.clone(), arguments, None, Vec::new()).await {
                Ok(output) => output,
                Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
            };
        let missing_unset_value = unsets_value && output.status.code() == Some(5);
        if !output.status.success() && !missing_unset_value {
            return git_command_response(&output);
        }
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

pub async fn workspace_git_diagnostics(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：在阻塞线程依次检查常用 Git 生态工具，避免占用异步请求线程。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let result = tokio::task::spawn_blocking(move || {
        let mut tools = Vec::new();
        tools.push(run_git_diagnostic_tool(&root, "git", "git", &["--version"]));
        tools.push(run_git_diagnostic_tool(&root, "ssh", "ssh", &["-V"]));
        tools.push(run_git_diagnostic_tool(&root, "gpg", "gpg", &["--version"]));
        tools.push(run_git_diagnostic_tool(&root, "lfs", "git", &["lfs", "version"]));
        tools.push(run_git_diagnostic_tool(&root, "gh", "gh", &["--version"]));
        tools.push(run_git_diagnostic_tool(&root, "glab", "glab", &["--version"]));
        tools
    })
    .await;
    match result {
        Ok(tools) => Json(GitDiagnosticsResponse { tools }).into_response(),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
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
    match run_git_tracked_output(root, arguments).await {
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
    // 步骤1：验证分支名，再依据用户明确选择使用安全删除或强制删除。
    let name = try_res!(validate_git_name(&body.name, "branch"));
    let arguments = build_branch_delete_arguments(&name, body.force);
    run_git_remote_command(&manager, &query, arguments).await
}

fn build_branch_delete_arguments(name: &str, force: bool) -> Vec<String> {
    // 步骤1：默认使用小写 -d 保护未合并分支，只有明确强制时才使用大写 -D。
    let delete_flag = if force { "-D" } else { "-d" };
    vec!["branch".to_string(), delete_flag.to_string(), name.to_string()]
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

fn build_upstream_set_arguments(remote: &str, branch: &str, remote_branch: &str) -> Vec<String> {
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

    // 步骤2：在同一仓库锁内顺序更新，任一步失败立即返回真实 Git 错误。
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;
    let mut last_output = None;
    for arguments in commands {
        let output =
            match run_git_tracked_output_locked(root.clone(), arguments, None, Vec::new()).await {
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
    // 步骤1：限制单页数量，并验证可选的文件路径。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let limit = query.limit.clamp(1, 200);
    let requested_count = limit + 1;
    let search = query.search.as_deref().unwrap_or("").trim().to_string();
    let search_active = !search.is_empty();
    let mut history_path = None;
    if let Some(path) = query.path.as_deref() {
        if !path.trim().is_empty() {
            let paths = try_res!(validate_git_paths(&root, &[path.to_string()]));
            history_path = Some(paths[0].clone());
        }
    }

    // 步骤2：搜索时分块扫描全部历史，普通列表只读取当前页和一条探测记录。
    if search_active {
        let mut commits = Vec::new();
        let mut matched_count = 0usize;
        let mut scan_skip = 0usize;
        let scan_count = 1_000usize;
        loop {
            let arguments = build_git_log_arguments(history_path.as_deref(), scan_count, scan_skip);
            let output = match run_git_output(root.clone(), arguments).await {
                Ok(output) if output.status.success() => output,
                Ok(output) => return git_command_response(&output),
                Err(error) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
            };
            let stdout = String::from_utf8_lossy(&output.stdout);
            let parsed_commits = parse_log_output(&stdout);
            let parsed_count = parsed_commits.len();
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
            if commits.len() >= requested_count || parsed_count < scan_count {
                break;
            }
            scan_skip += parsed_count;
        }
        let has_more = commits.len() > limit;
        commits.truncate(limit);
        return Json(GitLogResponse { commits, has_more }).into_response();
    }

    let arguments = build_git_log_arguments(history_path.as_deref(), requested_count, query.skip);
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut commits = parse_log_output(&stdout);
            let has_more = commits.len() > limit;
            commits.truncate(limit);
            Json(GitLogResponse { commits, has_more }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn build_git_log_arguments(path: Option<&str>, max_count: usize, skip: usize) -> Vec<String> {
    // 步骤1：普通历史覆盖全部引用，文件历史从当前分支跟随重命名。
    let mut arguments = vec![
        "log".to_string(),
        "--topo-order".to_string(),
        "--date=iso-strict".to_string(),
        "--decorate=short".to_string(),
        "--pretty=format:%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%D%x00%s%x1e".to_string(),
        format!("--max-count={max_count}"),
        format!("--skip={skip}"),
    ];
    if path.is_some() {
        arguments.push("--follow".to_string());
    } else {
        arguments.push("--all".to_string());
    }
    if let Some(path) = path {
        arguments.push("--".to_string());
        arguments.push(path.to_string());
    }
    arguments
}

fn build_git_sync_preview_arguments(range: &str) -> Vec<String> {
    // 步骤1：使用与历史记录相同的稳定字段格式，并限制单侧最多返回一百条提交。
    vec![
        "log".to_string(),
        "--topo-order".to_string(),
        "--date=iso-strict".to_string(),
        "--decorate=short".to_string(),
        "--pretty=format:%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%D%x00%s%x1e".to_string(),
        "--max-count=100".to_string(),
        range.to_string(),
    ]
}

async fn read_git_sync_preview(
    root: PathBuf,
    range: &str,
) -> Result<Vec<GitCommitSummary>, String> {
    // 步骤1：读取指定同步方向的提交，并把 Git 失败结果原样交给接口层处理。
    let arguments = build_git_sync_preview_arguments(range);
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            Ok(parse_log_output(&stdout))
        }
        Ok(output) => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        Err(error) => Err(error),
    }
}

pub async fn workspace_git_sync_preview(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
) -> Response {
    // 步骤1：读取当前仓库相对上游的传入提交。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let incoming = match read_git_sync_preview(root.clone(), "HEAD..@{upstream}").await {
        Ok(commits) => commits,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };

    // 步骤2：读取当前仓库相对上游的传出提交并返回两个方向。
    let outgoing = match read_git_sync_preview(root, "@{upstream}..HEAD").await {
        Ok(commits) => commits,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    Json(GitSyncPreviewResponse { incoming, outgoing }).into_response()
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

fn build_fetch_arguments(remote: Option<&str>, all: bool) -> Vec<String> {
    // 步骤1：始终清理失效引用，并按选项获取全部或指定 Remote。
    let mut arguments = vec!["fetch".to_string(), "--prune".to_string()];
    if all {
        arguments.push("--all".to_string());
    } else if let Some(remote) = remote {
        arguments.push(remote.to_string());
    }
    arguments
}

fn build_pull_arguments(
    remote: Option<&str>,
    branch: Option<&str>,
    strategy: &str,
) -> Result<Vec<String>, String> {
    // 步骤1：把三种明确的整合策略转换为 Git 参数。
    let strategy_argument = match strategy {
        "ff-only" => "--ff-only",
        "rebase" => "--rebase",
        "merge" => "--no-rebase",
        _ => return Err("invalid pull strategy".to_string()),
    };
    let mut arguments = vec!["pull".to_string(), strategy_argument.to_string()];

    // 步骤2：Remote 与分支存在时按顺序追加；空值继续使用已配置的 Upstream。
    if let Some(remote) = remote {
        arguments.push(remote.to_string());
        if let Some(branch) = branch {
            arguments.push(branch.to_string());
        }
    }
    Ok(arguments)
}

fn build_push_arguments(
    remote: Option<&str>,
    branch: Option<&str>,
    remote_branch: Option<&str>,
    push_tags: bool,
    force_with_lease: bool,
) -> Vec<String> {
    // 步骤1：危险推送只允许 force-with-lease，并把所有选项放在 Remote 之前。
    let mut arguments = vec!["push".to_string()];
    if force_with_lease {
        arguments.push("--force-with-lease".to_string());
    }
    if push_tags {
        arguments.push("--tags".to_string());
    }

    // 步骤2：显式 Remote 存在时追加本地到远程分支的 refspec。
    if let Some(remote) = remote {
        arguments.push(remote.to_string());
        if let Some(branch) = branch {
            let target_branch = remote_branch.unwrap_or(branch);
            arguments.push(format!("{branch}:{target_branch}"));
        }
    }
    arguments
}

fn build_remote_branch_delete_arguments(remote: &str, branch: &str) -> Vec<String> {
    // 步骤1：使用 Git 的显式 --delete 形式删除远程分支。
    vec!["push".to_string(), remote.to_string(), "--delete".to_string(), branch.to_string()]
}

fn build_remote_tag_delete_arguments(remote: &str, tag: &str) -> Vec<String> {
    // 步骤1：远程标签删除使用完整 refs/tags 路径，避免和分支名混淆。
    vec!["push".to_string(), remote.to_string(), "--delete".to_string(), format!("refs/tags/{tag}")]
}

fn build_remote_tag_push_arguments(remote: &str, tag: &str) -> Vec<String> {
    // 步骤1：单标签推送使用完整源和目标引用，避免把其他本地标签一并推送。
    let reference = format!("refs/tags/{tag}");
    vec!["push".to_string(), remote.to_string(), format!("{reference}:{reference}")]
}

fn parse_remote_tag_output(output: &str) -> Vec<GitTagEntry> {
    // 步骤1：逐行读取 ls-remote 的对象 ID 和完整标签引用。
    let mut tags = Vec::new();
    for line in output.lines() {
        let Some((target, reference)) = line.split_once('\t') else { continue };
        let Some(name) = reference.strip_prefix("refs/tags/") else { continue };
        tags.push(GitTagEntry {
            name: name.to_string(),
            target: target.to_string(),
            created_at: String::new(),
            subject: String::new(),
        });
    }
    tags
}

fn build_bisect_arguments(action: &str, revision: Option<&str>) -> Result<Vec<String>, String> {
    // 步骤1：只接受 Git Bisect 的固定状态动作。
    if action != "start"
        && action != "good"
        && action != "bad"
        && action != "skip"
        && action != "reset"
    {
        return Err("invalid bisect action".to_string());
    }
    let mut arguments = vec!["bisect".to_string(), action.to_string()];
    if let Some(revision) = revision {
        arguments.push(revision.to_string());
    }
    Ok(arguments)
}

fn build_patch_apply_arguments(check: bool, three_way: bool) -> Vec<String> {
    // 步骤1：Patch 只允许预检或三方合并选项，并始终从标准输入读取。
    let mut arguments = vec!["apply".to_string()];
    if check {
        arguments.push("--check".to_string());
    } else if three_way {
        arguments.push("--3way".to_string());
    }
    arguments.push("--whitespace=warn".to_string());
    arguments.push("-".to_string());
    arguments
}
fn validate_optional_git_name(
    value: Option<&str>,
    label: &str,
) -> Result<Option<String>, Response> {
    // 步骤1：空选项保持为空，非空选项复用统一 Git 名称校验。
    match value {
        Some(value) if !value.trim().is_empty() => validate_git_name(value, label).map(Some),
        _ => Ok(None),
    }
}

pub async fn workspace_git_fetch(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitFetchBody>,
) -> Response {
    // 步骤1：验证可选 Remote，并构造带清理选项的 Fetch 命令。
    let remote = try_res!(validate_optional_git_name(body.remote.as_deref(), "remote"));
    let arguments = build_fetch_arguments(remote.as_deref(), body.all);
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_pull(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitPullBody>,
) -> Response {
    // 步骤1：验证可选 Remote 和分支，分支不能脱离 Remote 单独出现。
    let remote = try_res!(validate_optional_git_name(body.remote.as_deref(), "remote"));
    let branch = try_res!(validate_optional_git_name(body.branch.as_deref(), "remote branch"));
    if remote.is_none() && branch.is_some() {
        return json_err(StatusCode::BAD_REQUEST, "remote required for branch");
    }
    let arguments = match build_pull_arguments(remote.as_deref(), branch.as_deref(), &body.strategy)
    {
        Ok(value) => value,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_push(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitPushBody>,
) -> Response {
    // 步骤1：验证 Remote、本地分支和远程分支，并拒绝无 Remote 的显式 refspec。
    let remote = try_res!(validate_optional_git_name(body.remote.as_deref(), "remote"));
    let branch = try_res!(validate_optional_git_name(body.branch.as_deref(), "branch"));
    let remote_branch =
        try_res!(validate_optional_git_name(body.remote_branch.as_deref(), "remote branch"));
    if remote.is_none() && (branch.is_some() || remote_branch.is_some()) {
        return json_err(StatusCode::BAD_REQUEST, "remote required for branch");
    }
    if body.force_with_lease && !body.confirm_force_with_lease {
        return json_err(StatusCode::BAD_REQUEST, "force-with-lease confirmation required");
    }
    let arguments = build_push_arguments(
        remote.as_deref(),
        branch.as_deref(),
        remote_branch.as_deref(),
        body.push_tags,
        body.force_with_lease,
    );
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_remote_branch_delete(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitRemoteBranchDeleteBody>,
) -> Response {
    // 步骤1：验证 Remote 和分支后执行专用删除命令。
    let remote = try_res!(validate_git_name(&body.remote, "remote"));
    let branch = try_res!(validate_git_name(&body.branch, "remote branch"));
    let arguments = build_remote_branch_delete_arguments(&remote, &branch);
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_remote_tag_delete(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitRemoteTagDeleteBody>,
) -> Response {
    // 步骤1：验证 Remote 和标签名后删除远程标签。
    let remote = try_res!(validate_git_name(&body.remote, "remote"));
    let tag = try_res!(validate_git_name(&body.tag, "tag"));
    let arguments = build_remote_tag_delete_arguments(&remote, &tag);
    run_git_remote_command(&manager, &query, arguments).await
}

pub async fn workspace_git_remote_tags(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<GitRemoteTagsQuery>,
) -> Response {
    // 步骤1：读取指定 Remote 的真实标签引用，不混入本地标签。
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    let remote = try_res!(validate_git_name(&query.remote, "remote"));
    let arguments =
        vec!["ls-remote".to_string(), "--tags".to_string(), "--refs".to_string(), remote];
    match run_git_output(root, arguments).await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            Json(GitTagsResponse { tags: parse_remote_tag_output(&stdout) }).into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub async fn workspace_git_remote_tag_push(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitRemoteTagActionBody>,
) -> Response {
    // 步骤1：只推送用户选中的一个本地标签。
    let remote = try_res!(validate_git_name(&body.remote, "remote"));
    let tag = try_res!(validate_git_name(&body.tag, "tag"));
    run_git_remote_command(&manager, &query, build_remote_tag_push_arguments(&remote, &tag)).await
}

pub async fn workspace_git_bisect(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitBisectBody>,
) -> Response {
    // 步骤1：校验可选修订版本并执行固定 Bisect 动作。
    let revision = try_res!(validate_optional_git_name(
        if body.revision.trim().is_empty() { None } else { Some(body.revision.as_str()) },
        "revision",
    ));
    let arguments = match build_bisect_arguments(&body.action, revision.as_deref()) {
        Ok(arguments) => arguments,
        Err(error) => return json_err(StatusCode::BAD_REQUEST, &error),
    };
    run_git_action(&manager, &query, arguments).await
}

fn parse_patch_numstat_paths(output: &[u8]) -> Result<Vec<String>, String> {
    // 步骤1：按 NUL 分隔读取普通路径；重命名记录会把旧、新路径放在后续两个字段中。
    let fields: Vec<&[u8]> = output.split(|byte| *byte == 0).collect();
    let mut paths = Vec::new();
    let mut field_index = 0usize;
    while field_index < fields.len() {
        let field = fields[field_index];
        field_index += 1;
        if field.is_empty() {
            continue;
        }
        let mut tab_positions = Vec::new();
        for (index, byte) in field.iter().enumerate() {
            if *byte == b'\t' {
                tab_positions.push(index);
                if tab_positions.len() == 2 {
                    break;
                }
            }
        }
        if tab_positions.len() != 2 {
            return Err("invalid patch path output".to_string());
        }
        let path_bytes = &field[tab_positions[1] + 1..];
        if path_bytes.is_empty() {
            for _ in 0..2 {
                if field_index >= fields.len() || fields[field_index].is_empty() {
                    return Err("invalid patch rename output".to_string());
                }
                let path = std::str::from_utf8(fields[field_index])
                    .map_err(|error| error.to_string())?
                    .to_string();
                if !paths.contains(&path) {
                    paths.push(path);
                }
                field_index += 1;
            }
        } else {
            let path =
                std::str::from_utf8(path_bytes).map_err(|error| error.to_string())?.to_string();
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
        if paths.len() > MAX_GIT_STATUS_FILES {
            return Err("patch contains too many paths".to_string());
        }
    }
    if paths.is_empty() {
        return Err("patch contains no paths".to_string());
    }
    Ok(paths)
}

async fn apply_patch_with_backup(
    root: PathBuf,
    patch: Vec<u8>,
    check: bool,
    three_way: bool,
) -> Result<std::process::Output, String> {
    // 步骤1：预检不修改仓库，仍通过受跟踪执行器提供日志和取消能力。
    if check {
        let arguments = build_patch_apply_arguments(true, false);
        return run_git_tracked_output_with_input(root, arguments, patch).await;
    }

    // 步骤2：应用流程共用仓库锁，先让 Git 解析真实受影响路径，再创建安全备份。
    let operation_lock = git_repository_operation_lock(&root);
    let _operation_guard = operation_lock.lock().await;
    let numstat_arguments =
        vec!["apply".to_string(), "--numstat".to_string(), "-z".to_string(), "-".to_string()];
    let numstat_output = run_git_tracked_output_locked(
        root.clone(),
        numstat_arguments,
        Some(patch.clone()),
        Vec::new(),
    )
    .await?;
    if !numstat_output.status.success() {
        return Err(git_command_error_message(&numstat_output.stdout, &numstat_output.stderr));
    }
    let raw_paths = parse_patch_numstat_paths(&numstat_output.stdout)?;
    let paths = validate_git_paths(&root, &raw_paths).map_err(response_to_string)?;
    backup_git_paths(root.clone(), &paths, "patch-apply").await?;

    // 步骤3：备份完成后应用普通或三方 Patch，失败时保留备份供用户恢复。
    let arguments = build_patch_apply_arguments(false, three_way);
    run_git_tracked_output_locked(root, arguments, Some(patch), Vec::new()).await
}

pub async fn workspace_git_patch_apply(
    State(manager): State<Arc<SessionManager>>,
    Query(query): Query<PaneQuery>,
    Json(body): Json<GitPatchApplyBody>,
) -> Response {
    // 步骤1：限制 Patch 体积并拒绝互斥选项。
    if body.patch.trim().is_empty() || body.patch.len() > MAX_GIT_DIFF_OUTPUT {
        return json_err(StatusCode::BAD_REQUEST, "invalid patch content");
    }
    if body.check && body.three_way {
        return json_err(StatusCode::BAD_REQUEST, "patch options conflict");
    }
    let root = try_res!(get_git_root(&manager, &query.pane_id, query.repository.as_deref()));
    match apply_patch_with_backup(root, body.patch.into_bytes(), body.check, body.three_way).await {
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
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
    let mut arguments =
        vec!["apply".to_string(), "--recount".to_string(), "--whitespace=nowarn".to_string()];
    if action == "stage" || action == "unstage" {
        arguments.push("--cached".to_string());
    }
    if action == "unstage" || action == "discard" {
        arguments.push("--reverse".to_string());
    }
    if action != "stage" && action != "unstage" && action != "discard" {
        return Err("invalid hunk action".to_string());
    }

    // 步骤2：通过受跟踪执行器传递 Patch，统一提供仓库互斥、日志和取消能力。
    run_git_tracked_output_with_input(root, arguments, patch.into_bytes()).await
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
        let mut arguments =
            vec!["diff".to_string(), "--no-ext-diff".to_string(), "--no-color".to_string()];
        if body.staged {
            arguments.push("--cached".to_string());
        }
        if body.ignore_whitespace {
            arguments.push("--ignore-all-space".to_string());
        }
        arguments.push("--".to_string());
        arguments.push(file_path.clone());
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

    // 步骤3：客户端必须基于当前 Patch 操作，避免文件变化后序号指向另一个 Hunk。
    let current_version = git_content_version(&full_patch);
    if body.content_version.is_empty() || body.content_version != current_version {
        return json_err(StatusCode::CONFLICT, "diff changed; refresh required");
    }

    // 步骤4：局部撤销会改写工作区，执行前复用文件备份保护。
    if body.action == "discard" {
        if let Err(error) =
            backup_git_paths(root.clone(), &[file_path.clone()], "hunk-discard").await
        {
            return json_err(StatusCode::INTERNAL_SERVER_ERROR, &error);
        }
    }

    // 步骤5：只提取指定 hunk，并按暂存、取消暂存或撤销动作应用。
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
        let content_version = git_content_version(&diff_text);
        return Json(serde_json::json!({
            "patch": diff_text,
            "content_version": content_version
        }))
        .into_response();
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
            let content_version = git_content_version(&diff_text);
            Json(serde_json::json!({
                "patch": diff_text,
                "content_version": content_version
            }))
            .into_response()
        }
        Ok(output) => git_command_response(&output),
        Err(error) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        append_git_ignore_pattern, apply_patch_with_backup, apply_unified_diff_hunk,
        build_bisect_arguments, build_branch_create_arguments, build_branch_delete_arguments,
        build_branch_switch_arguments, build_cherry_pick_arguments, build_commit_arguments,
        build_fetch_arguments, build_git_clean_arguments, build_git_config_update_commands,
        build_git_log_arguments, build_git_sync_preview_arguments, build_lfs_lock_arguments,
        build_lfs_push_arguments, build_lfs_sync_arguments, build_lfs_track_arguments,
        build_lfs_untrack_arguments, build_patch_apply_arguments, build_pull_arguments,
        build_push_arguments, build_remote_add_arguments, build_remote_branch_delete_arguments,
        build_remote_delete_arguments, build_remote_tag_delete_arguments,
        build_remote_tag_push_arguments, build_remote_update_arguments,
        build_revert_commit_arguments, build_reverted_content, build_stash_save_arguments,
        build_submodule_add_arguments, build_submodule_deinit_arguments,
        build_submodule_remove_arguments, build_submodule_sync_arguments,
        build_submodule_update_arguments, build_upstream_set_arguments,
        build_upstream_unset_arguments, build_worktree_create_arguments,
        build_worktree_management_arguments, build_worktree_remove_arguments,
        cleanup_incomplete_clone, clone_git_repository, contains_conflict_markers,
        discover_git_repositories, extract_unified_diff_hunk, git_clean_preview_paths, git_command,
        git_command_error_message, git_command_records_for_root, git_command_tracker,
        git_commit_matches_search, git_content_version, git_ignore_literal_pattern,
        git_repository_operation_lock, git_revert_has_no_changes, initialize_git_repository,
        parse_branch_output, parse_git_blame_output, parse_git_clean_preview_output,
        parse_git_config_output, parse_git_lfs_track_output, parse_git_submodule_status_output,
        parse_git_worktree_output, parse_log_output, parse_reflog_output, parse_remote_output,
        parse_remote_tag_output, parse_stash_output, parse_status_output, parse_tag_output,
        read_conflict_stage, read_git_backups, read_sequencer_operation, redact_git_output,
        request_git_command_cancellation, resolve_git_file_context, run_cherry_pick_sequence,
        run_git_output, run_hard_reset, run_rebase_plan, sanitize_git_command,
        select_existing_worktree_path, select_removable_worktree_path, unstage_git_paths,
        update_running_git_command_output, validate_clone_directory, validate_clone_url,
        validate_git_candidate_path, validate_initial_branch, validate_worktree_directory,
        GitCommandCancellation, GitCommandRecord, GitCommandTracker, GitConfigUpdateBody,
        GitRebasePlanEntry, GitWorktreeEntry,
    };
    use std::{
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
    };

    fn run_test_git(root: &Path, arguments: &[&str]) {
        // 步骤1：在临时仓库执行 Git 命令，并在失败时输出真实 stderr。
        let output = git_command().args(arguments).current_dir(root).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    }

    fn commit_test_file(root: &Path, file_name: &str, content: &str, message: &str) -> String {
        // 步骤1：写入并提交一个独立文件，避免历史重排测试产生内容冲突。
        std::fs::write(root.join(file_name), content).unwrap();
        run_test_git(root, &["add", file_name]);
        run_test_git(root, &["commit", "-m", message]);

        // 步骤2：返回刚创建提交的完整对象 ID，供 Rebase 计划精确引用。
        let output = git_command().args(["rev-parse", "HEAD"]).current_dir(root).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout).trim().to_string()
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
        run_test_git(temporary_directory.path(), &["config", "user.email", "test@example.com"]);
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
        run_test_git(temporary_directory.path(), &["config", "user.email", "test@example.com"]);
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
    fn parses_nul_status_paths_without_corrupting_special_names() {
        // 步骤1：NUL 输出中的换行、引号和箭头都是文件名原文，不是记录分隔符。
        let output = concat!(
            "## main\0",
            " M quote\"name.txt\0",
            "?? line\nbreak.txt\0",
            "R  new -> name.txt\0",
            "old -> name.txt\0",
        );
        let parsed = parse_status_output(output);
        assert_eq!(parsed.files.len(), 3);
        assert_eq!(parsed.files[0].path, "quote\"name.txt");
        assert_eq!(parsed.files[1].path, "line\nbreak.txt");
        assert_eq!(parsed.files[2].path, "new -> name.txt");
        assert_eq!(parsed.files[2].status, "renamed");
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
    fn parses_reflog_records_with_actions_and_messages() {
        // 步骤1：准备包含提交和 Reset 的引用日志记录。
        let output = "HEAD@{0}\0aaaaaaaa\0aaaaaaa\0commit: add feature\02026-07-17T10:00:00+08:00\x1eHEAD@{1}\0bbbbbbbb\0bbbbbbb\0reset: moving to HEAD~1\02026-07-17T09:00:00+08:00\x1e";
        let entries = parse_reflog_output(output);

        // 步骤2：确认动作与说明被拆分，恢复仍使用不可歧义的完整提交 ID。
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].selector, "HEAD@{0}");
        assert_eq!(entries[0].hash, "aaaaaaaa");
        assert_eq!(entries[0].action, "commit");
        assert_eq!(entries[0].message, "add feature");
        assert_eq!(entries[1].action, "reset");
        assert_eq!(entries[1].message, "moving to HEAD~1");
    }

    #[test]
    fn parses_and_builds_whitelisted_git_configuration() {
        // 步骤1：解析 Git 真实的 key 换行 value NUL 输出，忽略界面不管理的其他键。
        let output = "user.name\nAlice\0user.email\nalice@example.com\0credential.helper\nmanager-core\0commit.gpgsign\ntrue\0core.autocrlf\ntrue\0";
        let configuration = parse_git_config_output(output);
        assert_eq!(configuration.user_name, "Alice");
        assert_eq!(configuration.user_email, "alice@example.com");
        assert_eq!(configuration.credential_helper, "manager-core");
        assert!(configuration.gpg_sign);

        // 步骤2：更新命令只能包含固定配置键，空签名密钥转换为取消配置。
        let body = GitConfigUpdateBody {
            scope: "local".to_string(),
            user_name: "Alice New".to_string(),
            user_email: "new@example.com".to_string(),
            credential_helper: "manager-core".to_string(),
            default_branch: "main".to_string(),
            gpg_sign: false,
            signing_key: String::new(),
        };
        let commands = build_git_config_update_commands(&body).unwrap();
        assert_eq!(
            commands[0],
            vec!["config", "--local", "--replace-all", "user.name", "Alice New"]
        );
        assert_eq!(commands[5], vec!["config", "--local", "--unset-all", "user.signingkey"]);
    }

    #[test]
    fn sanitizes_sensitive_git_command_log_values() {
        // 步骤1：Remote URL 和提交说明必须脱敏，避免日志泄露凭据或正文。
        let remote_arguments = vec![
            "remote".to_string(),
            "add".to_string(),
            "origin".to_string(),
            "https://user:secret@example.com/repository.git".to_string(),
        ];
        assert_eq!(sanitize_git_command(&remote_arguments), "git remote add origin [redacted-url]");
        let commit_arguments =
            vec!["commit".to_string(), "-m".to_string(), "private message".to_string()];
        assert_eq!(sanitize_git_command(&commit_arguments), "git commit -m [redacted-message]");

        let clone_arguments = vec![
            "clone".to_string(),
            "--progress".to_string(),
            "--".to_string(),
            "https://user:secret@example.com/repository.git".to_string(),
            "repository".to_string(),
        ];
        assert_eq!(
            sanitize_git_command(&clone_arguments),
            "git clone --progress -- [redacted-url] repository"
        );

        // 步骤2：不含敏感值的同步命令保留完整参数，便于排查。
        let fetch_arguments =
            vec!["fetch".to_string(), "--prune".to_string(), "origin".to_string()];
        assert_eq!(sanitize_git_command(&fetch_arguments), "git fetch --prune origin");
    }

    #[test]
    fn parses_git_blame_porcelain_lines() {
        // 步骤1：准备两行带作者、时间和提交说明的 porcelain 输出。
        let output = concat!(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1\n",
            "author Alice Zhang\n",
            "author-mail <alice@example.com>\n",
            "author-time 1721181600\n",
            "summary Add first line\n",
            "filename src/main.rs\n",
            "\tfirst line\n",
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1\n",
            "author Bob Li\n",
            "author-mail <bob@example.com>\n",
            "author-time 1721268000\n",
            "summary Update second line\n",
            "filename src/main.rs\n",
            "\tsecond line\n",
        );

        // 步骤2：每个源码行应保留行号、内容和可跳转的提交元数据。
        let lines = parse_git_blame_output(output);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].line_number, 1);
        assert_eq!(lines[0].content, "first line");
        assert_eq!(lines[0].short_hash, "aaaaaaaa");
        assert_eq!(lines[0].author_name, "Alice Zhang");
        assert_eq!(lines[0].author_email, "alice@example.com");
        assert_eq!(lines[0].authored_at, 1_721_181_600);
        assert_eq!(lines[0].summary, "Add first line");
        assert_eq!(lines[1].line_number, 2);
        assert_eq!(lines[1].content, "second line");
    }

    #[test]
    fn appends_literal_git_ignore_pattern_once() {
        // 步骤1：追加包含 Gitignore 特殊字符的字面路径并补齐换行。
        let content = "target/\n";
        let pattern = "/build/\\[draft\\].txt";
        let updated = append_git_ignore_pattern(content, pattern);
        assert_eq!(updated, "target/\n/build/\\[draft\\].txt\n");

        // 步骤2：相同规则已经存在时不得重复写入。
        assert_eq!(append_git_ignore_pattern(&updated, pattern), updated);
    }

    #[test]
    fn creates_rooted_literal_git_ignore_patterns() {
        // 步骤1：文件路径中的通配、空格和注释字符必须按字面量转义。
        assert_eq!(
            git_ignore_literal_pattern("build/[draft] #1.txt", false),
            "/build/\\[draft\\]\\ \\#1.txt"
        );

        // 步骤2：目录规则以斜杠结尾，只忽略该仓库内的目标目录。
        assert_eq!(git_ignore_literal_pattern("cache", true), "/cache/");
    }

    #[test]
    fn parses_clean_preview_and_builds_scoped_clean_command() {
        // 步骤1：解析 Git dry-run 输出，保留目录和带空格的文件名。
        let output = "Would remove build/\nWould remove notes draft.txt\n";
        let paths = parse_git_clean_preview_output(output);
        assert_eq!(paths, vec!["build/", "notes draft.txt"]);

        // 步骤2：实际清理只作用于明确选择的路径，并使用参数分隔符。
        assert_eq!(
            build_git_clean_arguments(&paths),
            vec!["clean", "-fd", "--", "build/", "notes draft.txt"]
        );
    }

    #[tokio::test]
    async fn cleans_only_selected_untracked_paths() {
        // 步骤1：建立临时仓库并创建两个带空格的未跟踪文件。
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        run_test_git(root, &["init"]);
        let selected_path = root.join("remove me.txt");
        let retained_path = root.join("keep me.txt");
        std::fs::write(&selected_path, "remove").unwrap();
        std::fs::write(&retained_path, "keep").unwrap();

        // 步骤2：dry-run 必须返回两项，实际命令只传入选中的一项。
        let preview_paths = git_clean_preview_paths(root.to_path_buf()).await.unwrap();
        assert!(preview_paths.contains(&"remove me.txt".to_string()));
        assert!(preview_paths.contains(&"keep me.txt".to_string()));
        let selected_paths = vec!["remove me.txt".to_string()];
        let arguments = build_git_clean_arguments(&selected_paths);
        let output = run_git_output(root.to_path_buf(), arguments).await.unwrap();
        assert!(output.status.success());

        // 步骤3：选中项已删除，未选项必须完整保留。
        assert!(!selected_path.exists());
        assert!(retained_path.exists());
    }

    #[test]
    fn filters_git_command_records_by_repository() {
        // 步骤1：构造两个仓库的命令记录，模拟多仓库工作区。
        let first_root = PathBuf::from("first-repository");
        let second_root = PathBuf::from("second-repository");
        let mut tracker = GitCommandTracker::default();
        tracker.records.push_back(GitCommandRecord {
            id: "first-command".to_string(),
            command: "git fetch origin".to_string(),
            status: "running".to_string(),
            started_at: 1,
            finished_at: None,
            output: String::new(),
            root: first_root.clone(),
        });
        tracker.records.push_back(GitCommandRecord {
            id: "second-command".to_string(),
            command: "git push origin main".to_string(),
            status: "success".to_string(),
            started_at: 2,
            finished_at: Some(3),
            output: "done".to_string(),
            root: second_root,
        });

        // 步骤2：查询第一个仓库时不得泄露第二个仓库的记录。
        let records = git_command_records_for_root(&tracker, &first_root);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, "first-command");
    }

    #[test]
    fn updates_running_git_command_output_before_completion() {
        // 步骤1：运行中的克隆进度应立即写入对应命令记录。
        let root = PathBuf::from("repository");
        let mut tracker = GitCommandTracker::default();
        tracker.records.push_back(GitCommandRecord {
            id: "clone-command".to_string(),
            command: "git clone --progress -- [redacted-url] app".to_string(),
            status: "running".to_string(),
            started_at: 1,
            finished_at: None,
            output: String::new(),
            root,
        });
        update_running_git_command_output(&mut tracker, "clone-command", "Receiving objects: 25%");
        assert_eq!(tracker.records[0].output, "Receiving objects: 25%");
    }

    #[test]
    fn rebuilds_reverted_content_from_head_without_deleting_neighbor_lines() {
        // 步骤1：撤销删除操作时应把 HEAD 行插回当前位置，而不是覆盖下一行。
        let reverted = build_reverted_content("one\ntwo\nthree\n", "one\nthree\n", 2, 2).unwrap();
        assert_eq!(reverted, "one\ntwo\nthree\n");

        // 步骤2：越出当前差异范围的旧请求必须被拒绝。
        assert!(build_reverted_content("one\n", "one\n", 20, 20).is_err());
        assert_eq!(git_content_version("same"), git_content_version("same"));
        assert_ne!(git_content_version("before"), git_content_version("after"));
    }

    #[test]
    fn builds_non_interactive_revert_command() {
        // 步骤1：还原提交必须关闭编辑器，并把已验证的提交 ID 作为独立参数传入。
        let arguments = build_revert_commit_arguments("abcdef12");
        assert_eq!(arguments, vec!["revert", "--no-edit", "abcdef12"]);
    }

    #[test]
    fn preserves_stdout_when_a_git_command_fails_without_stderr() {
        // 步骤1：部分 Git 失败说明只写入 stdout，界面仍应获得真实原因。
        let message = git_command_error_message(
            b"On branch main\nnothing to commit, working tree clean\n",
            b"",
        );
        assert!(message.starts_with("On branch main\nnothing to commit, working tree clean"));
        assert!(message.contains("Dinotty 提示"));
    }

    #[test]
    fn recognizes_a_commit_that_is_already_reverted() {
        // 步骤1：Git 的无改动提示表示目标状态已经满足，不应再显示为命令错误。
        assert!(git_revert_has_no_changes(
            b"On branch main\nnothing to commit, working tree clean\n",
            b"",
        ));
        assert!(!git_revert_has_no_changes(
            b"On branch main\nnothing to commit, working tree clean\n",
            b"hook failed\n",
        ));
    }

    #[test]
    fn rejects_existing_targets_that_resolve_outside_the_workspace() {
        // 步骤1：真实路径不在工作区内时，即使词法路径看似合法也必须拒绝。
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        assert!(validate_git_candidate_path(workspace.path(), outside.path()).is_err());
        assert!(validate_git_candidate_path(workspace.path(), workspace.path()).is_ok());
    }

    #[test]
    fn builds_file_history_with_rename_following() {
        // 步骤1：文件历史只从当前历史跟随重命名，普通历史继续覆盖全部引用。
        let file_arguments = build_git_log_arguments(Some("src/new-name.rs"), 51, 0);
        assert!(file_arguments.contains(&"--follow".to_string()));
        assert!(!file_arguments.contains(&"--all".to_string()));
        let all_arguments = build_git_log_arguments(None, 51, 0);
        assert!(all_arguments.contains(&"--all".to_string()));
    }

    #[test]
    fn removes_an_incomplete_clone_destination() {
        // 步骤1：取消或失败的克隆目录必须清理，确保相同目录可以直接重试。
        let workspace = tempfile::tempdir().unwrap();
        let destination = workspace.path().join("partial-clone");
        std::fs::create_dir(&destination).unwrap();
        std::fs::write(destination.join("partial.pack"), "partial").unwrap();
        cleanup_incomplete_clone(&destination).unwrap();
        assert!(!destination.exists());
    }

    #[test]
    fn requests_git_command_cancellation_only_in_same_repository() {
        // 步骤1：构造一个运行中命令及其取消令牌。
        let first_root = PathBuf::from("first-repository");
        let second_root = PathBuf::from("second-repository");
        let requested = Arc::new(AtomicBool::new(false));
        let mut tracker = GitCommandTracker::default();
        tracker.cancellations.push(GitCommandCancellation {
            id: "command-id".to_string(),
            root: first_root.clone(),
            requested: requested.clone(),
        });

        // 步骤2：其他仓库不能取消该命令，所属仓库可以发出取消请求。
        assert!(!request_git_command_cancellation(&mut tracker, &second_root, "command-id"));
        assert!(!requested.load(Ordering::SeqCst));
        assert!(request_git_command_cancellation(&mut tracker, &first_root, "command-id"));
        assert!(requested.load(Ordering::SeqCst));
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
        let create_arguments = build_branch_create_arguments("feature/history", Some("abcdef12"));
        assert_eq!(create_arguments, vec!["switch", "-c", "feature/history", "abcdef12"]);
    }

    #[test]
    fn builds_safe_and_force_branch_delete_arguments() {
        // 步骤1：普通删除只允许 Git 删除已合并分支。
        assert_eq!(
            build_branch_delete_arguments("feature/done", false),
            vec!["branch", "-d", "feature/done"]
        );

        // 步骤2：用户明确选择强制删除时才使用大写 -D。
        assert_eq!(
            build_branch_delete_arguments("feature/unfinished", true),
            vec!["branch", "-D", "feature/unfinished"]
        );
    }

    #[test]
    fn builds_multi_commit_cherry_pick_arguments_in_request_order() {
        // 步骤1：多个提交必须按用户选择顺序附加到同一个 Cherry-pick 命令。
        let commits = vec!["bbbbbbbb".to_string(), "aaaaaaaa".to_string()];
        assert_eq!(
            build_cherry_pick_arguments(&commits),
            vec!["cherry-pick", "bbbbbbbb", "aaaaaaaa"]
        );
    }

    #[tokio::test]
    async fn skips_an_already_applied_commit_and_finishes_the_cherry_pick_sequence() {
        // 步骤1：建立来源分支的两个提交，并让主分支预先包含第一个提交的改动。
        let temporary_directory = tempfile::tempdir().unwrap();
        let root = temporary_directory.path();
        run_test_git(root, &["init", "-b", "main"]);
        run_test_git(root, &["config", "user.name", "Test User"]);
        run_test_git(root, &["config", "user.email", "test@example.com"]);
        commit_test_file(root, "base.txt", "base", "base");
        run_test_git(root, &["switch", "-c", "source"]);
        let first_commit = commit_test_file(root, "first.txt", "first", "first");
        let second_commit = commit_test_file(root, "second.txt", "second", "second");
        run_test_git(root, &["switch", "main"]);
        run_test_git(root, &["cherry-pick", &first_commit]);

        // 步骤2：批量挑拣时自动跳过空提交，继续应用后续提交并清理序列状态。
        let commits = vec![first_commit, second_commit];
        let result = run_cherry_pick_sequence(root.to_path_buf(), &commits).await.unwrap();
        assert!(result.output.status.success());
        assert_eq!(result.skipped_count, 1);
        assert_eq!(std::fs::read_to_string(root.join("second.txt")).unwrap(), "second");
        assert!(!root.join(".git").join("sequencer").exists());
        assert!(!root.join(".git").join("CHERRY_PICK_HEAD").exists());
    }

    #[test]
    fn detects_cherry_pick_from_a_sequencer_todo_without_head_marker() {
        // 步骤1：模拟 Reset 后只剩 sequencer/todo 的批量 Cherry-pick 状态。
        let temporary_directory = tempfile::tempdir().unwrap();
        let sequencer_directory = temporary_directory.path().join("sequencer");
        std::fs::create_dir(&sequencer_directory).unwrap();
        std::fs::write(sequencer_directory.join("todo"), "pick abcdef1234567890 selected commit\n")
            .unwrap();

        // 步骤2：操作检测仍应返回 Cherry-pick 和待处理提交 ID。
        let operation = read_sequencer_operation(temporary_directory.path());
        assert_eq!(operation, Some(("cherry-pick".to_string(), "abcdef1234567890".to_string())));
    }

    #[tokio::test]
    async fn rewrites_linear_history_with_reorder_squash_fixup_and_reword() {
        // 步骤1：建立基础提交和四个互不冲突的线性提交，并记录每个提交 ID。
        let temporary_directory = tempfile::tempdir().unwrap();
        run_test_git(temporary_directory.path(), &["init"]);
        run_test_git(temporary_directory.path(), &["config", "user.name", "Test User"]);
        run_test_git(temporary_directory.path(), &["config", "user.email", "test@example.com"]);
        let base_commit = commit_test_file(temporary_directory.path(), "base.txt", "base", "base");
        let first_commit =
            commit_test_file(temporary_directory.path(), "first.txt", "first", "first");
        let second_commit =
            commit_test_file(temporary_directory.path(), "second.txt", "second", "second");
        let third_commit =
            commit_test_file(temporary_directory.path(), "third.txt", "third", "third");
        let fourth_commit =
            commit_test_file(temporary_directory.path(), "fourth.txt", "fourth", "fourth");

        // 步骤2：重排中间提交，把两个提交分别 Squash 和 Fixup，并修改最后提交说明。
        let entries = vec![
            GitRebasePlanEntry::new(second_commit, "pick", ""),
            GitRebasePlanEntry::new(first_commit, "squash", ""),
            GitRebasePlanEntry::new(third_commit, "fixup", ""),
            GitRebasePlanEntry::new(fourth_commit, "reword", "renamed fourth"),
        ];
        let output =
            run_rebase_plan(temporary_directory.path().to_path_buf(), base_commit, entries)
                .await
                .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));

        // 步骤3：确认四条提交被折叠为两条，且 Reword 说明生效。
        let subjects_output = git_command()
            .args(["log", "--format=%s", "-2"])
            .current_dir(temporary_directory.path())
            .output()
            .unwrap();
        let subjects = String::from_utf8_lossy(&subjects_output.stdout);
        let subject_lines: Vec<&str> = subjects.lines().collect();
        assert_eq!(subject_lines, vec!["renamed fourth", "second"]);
    }

    #[tokio::test]
    async fn reads_base_current_and_incoming_conflict_stages() {
        // 步骤1：建立两个分支并在同一行制造真实合并冲突。
        let temporary_directory = tempfile::tempdir().unwrap();
        run_test_git(temporary_directory.path(), &["init"]);
        run_test_git(temporary_directory.path(), &["config", "user.name", "Test User"]);
        run_test_git(temporary_directory.path(), &["config", "user.email", "test@example.com"]);
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
        run_test_git(source_directory.path(), &["config", "user.email", "test@example.com"]);
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

        // 步骤3：克隆必须写入工作区命令日志，并隐藏源仓库地址。
        let tracker = git_command_tracker().lock().unwrap_or_else(|error| error.into_inner());
        let records = git_command_records_for_root(&tracker, workspace_directory.path());
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].command, "git clone --progress -- [redacted-url] cloned");
        assert_eq!(records[0].status, "success");
    }

    #[test]
    fn validates_repository_setup_inputs() {
        // 步骤1：允许常规分支、远程地址和单层工作区子目录。
        assert_eq!(validate_initial_branch("main").unwrap(), "main");
        assert_eq!(
            validate_clone_url("https://example.com/team/app.git").unwrap(),
            "https://example.com/team/app.git"
        );
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
                vec!["remote", "set-url", "--push", "upstream", "git@example.com:upstream.git"],
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
    fn builds_configurable_remote_sync_arguments() {
        // 步骤1：Fetch 支持指定 Remote 或清理全部 Remote。
        assert_eq!(
            build_fetch_arguments(Some("origin"), false),
            vec!["fetch", "--prune", "origin"]
        );
        assert_eq!(build_fetch_arguments(Some("origin"), true), vec!["fetch", "--prune", "--all"]);

        // 步骤2：Pull 按用户策略和目标远程分支生成明确参数。
        assert_eq!(
            build_pull_arguments(Some("origin"), Some("release"), "rebase").unwrap(),
            vec!["pull", "--rebase", "origin", "release"]
        );
        assert!(build_pull_arguments(None, None, "invalid").is_err());

        // 步骤3：Push 使用 force-with-lease、明确 refspec 和标签选项。
        assert_eq!(
            build_push_arguments(Some("origin"), Some("main"), Some("release"), true, true),
            vec!["push", "--force-with-lease", "--tags", "origin", "main:release"]
        );
        assert_eq!(
            build_remote_branch_delete_arguments("origin", "obsolete"),
            vec!["push", "origin", "--delete", "obsolete"]
        );
    }

    #[test]
    fn builds_incoming_and_outgoing_sync_preview_ranges() {
        // 步骤1：传入提交从当前 HEAD 到上游，传出提交从上游到当前 HEAD。
        let incoming = build_git_sync_preview_arguments("HEAD..@{upstream}");
        let outgoing = build_git_sync_preview_arguments("@{upstream}..HEAD");
        assert!(incoming.contains(&"HEAD..@{upstream}".to_string()));
        assert!(outgoing.contains(&"@{upstream}..HEAD".to_string()));

        // 步骤2：两个命令都限制数量并使用稳定的 NUL 字段格式。
        assert!(incoming.contains(&"--max-count=100".to_string()));
        assert!(outgoing.contains(&"--max-count=100".to_string()));
        assert!(incoming.iter().any(contains_git_log_format));
        assert!(outgoing.iter().any(contains_git_log_format));
    }

    fn contains_git_log_format(argument: &String) -> bool {
        // 步骤1：识别用于解析稳定提交字段的格式参数。
        argument.starts_with("--pretty=format:")
    }

    #[test]
    fn builds_selective_stash_save_arguments() {
        // 步骤1：全部保存时支持说明、未跟踪文件和保留暂存区。
        assert_eq!(
            build_stash_save_arguments("before experiment", true, true, false, &[]),
            vec!["stash", "push", "--include-untracked", "--keep-index", "-m", "before experiment"]
        );

        // 步骤2：仅暂存模式和选中文件模式生成互不混淆的参数。
        assert_eq!(
            build_stash_save_arguments("", false, false, true, &[]),
            vec!["stash", "push", "--staged"]
        );
        assert_eq!(
            build_stash_save_arguments(
                "",
                false,
                false,
                false,
                &["src/a.ts".to_string(), "src/b.ts".to_string()]
            ),
            vec!["stash", "push", "--", "src/a.ts", "src/b.ts"]
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

    #[test]
    fn parses_worktrees_and_builds_worktree_commands() {
        // 步骤1：解析 Git worktree porcelain 输出。
        let output = concat!(
            "worktree C:/repo\n",
            "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
            "branch refs/heads/main\n",
            "\n",
            "worktree C:/repo-feature\n",
            "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
            "detached\n",
            "locked reason\n",
            "\n",
        );
        let worktrees = parse_git_worktree_output(output);
        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[0].branch, "main");
        assert!(worktrees[1].detached);
        assert!(worktrees[1].locked);

        // 步骤2：确认创建和删除命令只由固定参数组成。
        assert_eq!(
            build_worktree_create_arguments("../feature", Some("feature/ui"), Some("main")),
            vec!["worktree", "add", "-b", "feature/ui", "../feature", "main"]
        );
        assert_eq!(
            build_worktree_remove_arguments("C:/repo-feature", true),
            vec!["worktree", "remove", "--force", "C:/repo-feature"]
        );
        assert_eq!(validate_worktree_directory("../repo-feature").unwrap(), "../repo-feature");
        assert_eq!(
            build_worktree_management_arguments("lock", "C:/repo-feature", None).unwrap(),
            vec!["worktree", "lock", "C:/repo-feature"]
        );
        assert_eq!(
            build_worktree_management_arguments(
                "move",
                "C:/repo-feature",
                Some("D:/work/repo-feature")
            )
            .unwrap(),
            vec!["worktree", "move", "C:/repo-feature", "D:/work/repo-feature"]
        );
        assert_eq!(
            build_worktree_management_arguments("prune", "", None).unwrap(),
            vec!["worktree", "prune"]
        );

        // 步骤3：删除前必须从当前 worktree 列表中选择，并拒绝当前仓库根。
        let temporary_directory = tempfile::tempdir().unwrap();
        let root = temporary_directory.path().join("repo");
        let linked = temporary_directory.path().join("repo-feature");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&linked).unwrap();
        let root_text = root.to_string_lossy().into_owned();
        let linked_text = linked.to_string_lossy().into_owned();
        let removable_worktrees = vec![
            GitWorktreeEntry {
                path: root_text.clone(),
                head: "aaaaaaaa".to_string(),
                branch: "main".to_string(),
                detached: false,
                locked: false,
                prunable: false,
                dirty: false,
                current: true,
            },
            GitWorktreeEntry {
                path: linked_text.clone(),
                head: "bbbbbbbb".to_string(),
                branch: "feature".to_string(),
                detached: false,
                locked: false,
                prunable: false,
                dirty: true,
                current: false,
            },
        ];
        let selected =
            select_removable_worktree_path(&root, &removable_worktrees, &linked_text).unwrap();
        assert_eq!(selected, linked_text);
        assert!(select_removable_worktree_path(&root, &removable_worktrees, &root_text).is_err());
        assert!(select_removable_worktree_path(&root, &removable_worktrees, "missing").is_err());
        assert_eq!(
            select_existing_worktree_path(&removable_worktrees, &linked_text).unwrap(),
            linked_text
        );
        assert!(select_existing_worktree_path(&removable_worktrees, "missing").is_err());
    }

    #[tokio::test]
    async fn hard_reset_preserves_head_and_tracked_changes() {
        // 步骤1：建立两个提交，并同时准备暂存和未暂存的受跟踪改动。
        let temporary_directory = tempfile::tempdir().unwrap();
        let root = temporary_directory.path();
        run_test_git(root, &["init", "-b", "main"]);
        run_test_git(root, &["config", "user.name", "Test User"]);
        run_test_git(root, &["config", "user.email", "test@example.com"]);
        run_test_git(root, &["config", "core.autocrlf", "false"]);
        let initial_commit = commit_test_file(root, "tracked.txt", "initial\n", "initial");
        let latest_commit = commit_test_file(root, "latest.txt", "latest\n", "latest");
        std::fs::write(root.join("tracked.txt"), "staged change\n").unwrap();
        run_test_git(root, &["add", "tracked.txt"]);
        std::fs::write(root.join("latest.txt"), "working change\n").unwrap();

        // 步骤2：Hard Reset 后内容回到目标提交，原 HEAD 和两类改动均可恢复。
        let output = run_hard_reset(root.to_path_buf(), initial_commit).await.unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(std::fs::read_to_string(root.join("tracked.txt")).unwrap(), "initial\n");
        assert!(!root.join("latest.txt").exists());
        let safety_output = git_command()
            .args(["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads"])
            .current_dir(root)
            .output()
            .unwrap();
        let safety_refs = String::from_utf8_lossy(&safety_output.stdout);
        assert!(safety_refs.contains(&latest_commit));
        assert!(safety_refs.contains("refs/heads/dinotty-safety/reset-"));
        let stash_output = git_command()
            .args(["stash", "show", "--name-only", "stash@{0}"])
            .current_dir(root)
            .output()
            .unwrap();
        let stash_paths = String::from_utf8_lossy(&stash_output.stdout);
        assert!(stash_paths.contains("tracked.txt"));
        assert!(stash_paths.contains("latest.txt"));
    }

    #[tokio::test]
    async fn patch_apply_backs_up_existing_and_new_paths() {
        // 步骤1：生成同时修改已有文件和新增文件的真实 Patch。
        let temporary_directory = tempfile::tempdir().unwrap();
        let root = temporary_directory.path();
        run_test_git(root, &["init", "-b", "main"]);
        run_test_git(root, &["config", "user.name", "Test User"]);
        run_test_git(root, &["config", "user.email", "test@example.com"]);
        run_test_git(root, &["config", "core.autocrlf", "false"]);
        commit_test_file(root, "existing.txt", "before\n", "initial");
        std::fs::write(root.join("existing.txt"), "after\n").unwrap();
        std::fs::write(root.join("new.txt"), "new file\n").unwrap();
        run_test_git(root, &["add", "-N", "new.txt"]);
        let patch_output = git_command()
            .args(["diff", "--", "existing.txt", "new.txt"])
            .current_dir(root)
            .output()
            .unwrap();
        let patch = patch_output.stdout;
        run_test_git(root, &["reset", "--hard", "HEAD"]);

        // 步骤2：应用前创建结构化备份，清单记录原本不存在的新文件。
        let output =
            apply_patch_with_backup(root.to_path_buf(), patch, false, false).await.unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(std::fs::read_to_string(root.join("existing.txt")).unwrap(), "after\n");
        assert_eq!(std::fs::read_to_string(root.join("new.txt")).unwrap(), "new file\n");
        let backups = read_git_backups(&root.join(".git")).unwrap();
        assert_eq!(backups.len(), 1);
        assert!(backups[0].paths.contains(&"existing.txt".to_string()));
        assert!(backups[0].missing_paths.contains(&"new.txt".to_string()));
    }

    #[test]
    fn parses_submodules_and_builds_submodule_update_commands() {
        // 步骤1：覆盖未初始化、已变更和冲突三类子模块状态。
        let output = concat!(
            "-aaaaaaaa libs/empty (heads/main)\n",
            "+bbbbbbbb libs/changed (v1.0.0)\n",
            "Ucccccccc libs/conflict\n",
            " dddddddd libs/my module (heads/main)\n",
        );
        let submodules = parse_git_submodule_status_output(output);
        assert_eq!(submodules.len(), 4);
        assert_eq!(submodules[0].status, "uninitialized");
        assert_eq!(submodules[1].status, "changed");
        assert_eq!(submodules[2].status, "conflict");
        assert_eq!(submodules[3].path, "libs/my module");
        assert_eq!(submodules[3].description, "(heads/main)");

        // 步骤2：确认更新命令按界面选项追加参数和路径。
        assert_eq!(
            build_submodule_update_arguments(Some("libs/empty"), true, true, false),
            vec!["submodule", "update", "--init", "--recursive", "--", "libs/empty"]
        );
        assert_eq!(
            build_submodule_add_arguments(
                "https://example.com/library.git",
                "libs/my module",
                Some("develop")
            ),
            vec![
                "submodule",
                "add",
                "-b",
                "develop",
                "https://example.com/library.git",
                "libs/my module"
            ]
        );
        assert_eq!(
            build_submodule_sync_arguments(Some("libs/my module")),
            vec!["submodule", "sync", "--", "libs/my module"]
        );
        assert_eq!(
            build_submodule_deinit_arguments("libs/my module"),
            vec!["submodule", "deinit", "-f", "--", "libs/my module"]
        );
        assert_eq!(
            build_submodule_remove_arguments("libs/my module"),
            vec!["rm", "-f", "--", "libs/my module"]
        );
    }

    #[test]
    fn parses_lfs_tracks_and_builds_lfs_commands() {
        // 步骤1：解析 git lfs track 输出中的模式。
        let output =
            "Listing tracked patterns\n*.psd (.gitattributes)\nassets/** (.gitattributes)\n";
        let patterns = parse_git_lfs_track_output(output);
        assert_eq!(patterns, vec!["*.psd", "assets/**"]);

        // 步骤2：确认 track 和同步命令不会经过 shell 展开。
        assert_eq!(build_lfs_track_arguments("*.zip"), vec!["lfs", "track", "*.zip"]);
        assert_eq!(build_lfs_sync_arguments("pull", Some("origin")), vec!["lfs", "pull", "origin"]);
        assert_eq!(
            build_lfs_push_arguments("origin", Some("main"), false),
            vec!["lfs", "push", "origin", "main"]
        );
        assert_eq!(
            build_lfs_push_arguments("origin", None, true),
            vec!["lfs", "push", "--all", "origin"]
        );
        assert_eq!(build_lfs_untrack_arguments("*.zip"), vec!["lfs", "untrack", "*.zip"]);
        assert_eq!(
            build_lfs_lock_arguments("lock", "assets/model.bin", false),
            vec!["lfs", "lock", "assets/model.bin"]
        );
        assert_eq!(
            build_lfs_lock_arguments("unlock", "assets/model.bin", true),
            vec!["lfs", "unlock", "--force", "assets/model.bin"]
        );
    }

    #[test]
    fn resolves_files_against_the_nearest_nested_repository() {
        // 步骤1：在工作区中建立嵌套仓库和测试文件。
        let temporary_directory = tempfile::tempdir().unwrap();
        let nested_root = temporary_directory.path().join("apps/web");
        std::fs::create_dir_all(nested_root.join("src")).unwrap();
        run_test_git(&nested_root, &["init"]);
        std::fs::write(nested_root.join("src/main.ts"), "export {}\n").unwrap();

        // 步骤2：文件 Git 上下文必须选择嵌套仓库，并返回仓库内相对路径。
        let (git_root, relative_path) =
            resolve_git_file_context(temporary_directory.path(), "apps/web/src/main.ts").unwrap();
        assert_eq!(git_root.canonicalize().unwrap(), nested_root.canonicalize().unwrap());
        assert_eq!(relative_path, "src/main.ts");
    }

    #[test]
    fn redacts_credentials_from_git_command_output() {
        // 步骤1：错误输出中的 URL 用户名、密码和令牌不能进入命令日志。
        let output = "fatal: unable to access 'https://alice:secret@example.com/team/repo.git'\nhttps://token@example.com/repo.git";
        let redacted = redact_git_output(output);
        assert!(!redacted.contains("alice"));
        assert!(!redacted.contains("secret"));
        assert!(!redacted.contains("token@"));
        assert!(redacted.contains("https://[redacted]@example.com"));

        // 步骤2：接口错误信息也必须经过同一脱敏逻辑。
        let error_message = git_command_error_message(
            b"",
            b"fatal: https://alice:secret@example.com/team/repo.git failed",
        );
        assert!(!error_message.contains("alice"));
        assert!(!error_message.contains("secret"));
        assert!(error_message.contains("https://[redacted]@example.com"));
    }

    #[test]
    fn reuses_operation_locks_per_repository() {
        // 步骤1：同一仓库路径必须复用同一个异步锁。
        let first_root = PathBuf::from("C:/repo-one");
        let first_lock = git_repository_operation_lock(&first_root);
        let repeated_lock = git_repository_operation_lock(&first_root);
        assert!(Arc::ptr_eq(&first_lock, &repeated_lock));

        // 步骤2：不同仓库使用独立锁，互不阻塞。
        let second_lock = git_repository_operation_lock(Path::new("C:/repo-two"));
        assert!(!Arc::ptr_eq(&first_lock, &second_lock));

        // 步骤3：同一仓库的主工作树和链接 Worktree 必须共享公共目录锁。
        let temporary_directory = tempfile::tempdir().unwrap();
        let repository_root = temporary_directory.path().join("repository");
        let linked_root = temporary_directory.path().join("linked");
        std::fs::create_dir_all(&repository_root).unwrap();
        run_test_git(&repository_root, &["init", "-b", "main"]);
        run_test_git(&repository_root, &["config", "user.name", "Test User"]);
        run_test_git(&repository_root, &["config", "user.email", "test@example.com"]);
        commit_test_file(&repository_root, "README.md", "main\n", "initial");
        run_test_git(
            &repository_root,
            &["worktree", "add", "-b", "feature", linked_root.to_string_lossy().as_ref()],
        );
        let repository_lock = git_repository_operation_lock(&repository_root);
        let worktree_lock = git_repository_operation_lock(&linked_root);
        assert!(Arc::ptr_eq(&repository_lock, &worktree_lock));
    }

    #[test]
    fn builds_remote_tag_delete_and_explains_common_errors() {
        // 步骤1：远程标签删除使用完整标签引用。
        assert_eq!(
            build_remote_tag_delete_arguments("origin", "v1.0.0"),
            vec!["push", "origin", "--delete", "refs/tags/v1.0.0"]
        );
        assert_eq!(
            build_remote_tag_push_arguments("origin", "v1.0.0"),
            vec!["push", "origin", "refs/tags/v1.0.0:refs/tags/v1.0.0"]
        );
        let remote_tags =
            parse_remote_tag_output("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v1.0.0\n");
        assert_eq!(remote_tags.len(), 1);
        assert_eq!(remote_tags[0].name, "v1.0.0");
        assert_eq!(remote_tags[0].target, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

        // 步骤2：常见远程错误保留原文并追加中文提示。
        let message = git_command_error_message(b"", b"fatal: Authentication failed");
        assert!(message.contains("Authentication failed"));
        assert!(message.contains("远程认证失败"));
    }

    #[test]
    fn builds_bisect_and_patch_commands_from_fixed_actions() {
        // 步骤1：Bisect 只接受固定动作，并按需追加经过校验的修订版本。
        assert_eq!(build_bisect_arguments("start", None).unwrap(), vec!["bisect", "start"]);
        assert_eq!(
            build_bisect_arguments("good", Some("abc1234")).unwrap(),
            vec!["bisect", "good", "abc1234"]
        );
        assert!(build_bisect_arguments("unknown", None).is_err());

        // 步骤2：Patch 应用支持预检和三方合并，但不接受任意参数。
        assert_eq!(
            build_patch_apply_arguments(true, false),
            vec!["apply", "--check", "--whitespace=warn", "-"]
        );
        assert_eq!(
            build_patch_apply_arguments(false, true),
            vec!["apply", "--3way", "--whitespace=warn", "-"]
        );
    }
}

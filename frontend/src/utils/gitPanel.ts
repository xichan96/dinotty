export interface GitFileEntry {
  path: string
  status: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  unstaged: boolean
  conflict: boolean
}

export interface GitDiffSelection {
  filePath: string
  staged: boolean
  untracked: boolean
  conflict?: boolean
}

export interface GitRemoteEntry {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface GitRepositoryEntry {
  path: string
  name: string
}

export function appendGitRepository(query: URLSearchParams, repository?: string): void {
  // 步骤1：只有选择了嵌套仓库时才添加参数，保持根仓库请求向后兼容。
  if (repository) query.set('repository', repository)
}

export function getGitFileName(path: string): string {
  // 步骤1：统一路径分隔符后返回最后一段文件名。
  const normalizedPath = path.replace(/\\/g, '/')
  const pathParts = normalizedPath.split('/')
  return pathParts[pathParts.length - 1] || normalizedPath
}

export function getGitDirectory(path: string): string {
  // 步骤1：去掉文件名，仅保留用于辅助识别的目录。
  const normalizedPath = path.replace(/\\/g, '/')
  const separatorIndex = normalizedPath.lastIndexOf('/')
  if (separatorIndex < 0) {
    return ''
  }
  return normalizedPath.slice(0, separatorIndex)
}

export function mapGitFileEntry(rawFile: Record<string, unknown>): GitFileEntry {
  // 步骤1：兼容旧版接口只返回 status 的数据。
  const status = String(rawFile.status || 'modified')
  const stagedByStatus = status.startsWith('staged_') || status === 'renamed'
  const unstagedByStatus = !stagedByStatus || status === 'untracked'

  // 步骤2：优先使用新版接口的 index/worktree 双状态字段。
  return {
    path: String(rawFile.path || ''),
    status,
    indexStatus: String(rawFile.index_status ?? (stagedByStatus ? 'M' : ' ')),
    worktreeStatus: String(rawFile.worktree_status ?? (unstagedByStatus ? 'M' : ' ')),
    staged: typeof rawFile.staged === 'boolean' ? rawFile.staged : stagedByStatus,
    unstaged: typeof rawFile.unstaged === 'boolean' ? rawFile.unstaged : unstagedByStatus,
    conflict: rawFile.conflict === true,
  }
}

export function mapGitRemoteEntry(rawRemote: Record<string, unknown>): GitRemoteEntry {
  // 步骤1：把后端 snake_case 字段转换成前端统一的 camelCase 字段。
  return {
    name: String(rawRemote.name || ''),
    fetchUrl: String(rawRemote.fetch_url || ''),
    pushUrl: String(rawRemote.push_url || ''),
  }
}

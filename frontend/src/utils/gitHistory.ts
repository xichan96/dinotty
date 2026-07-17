export interface GitCommitEntry {
  hash: string
  shortHash: string
  authorName: string
  authorEmail: string
  authoredAt: string
  parents: string[]
  subject: string
}

export type GitHistorySelection =
  | {
      kind: 'commit'
      hash: string
      shortHash: string
      subject: string
      authorName: string
      authoredAt: string
      path: string | null
    }
  | {
      kind: 'compare'
      base: string
      target: string
    }

export function mapGitCommitEntry(rawCommit: Record<string, unknown>): GitCommitEntry {
  // 步骤1：逐个转换提交字段，并过滤无效父提交值。
  const parents: string[] = []
  if (Array.isArray(rawCommit.parents)) {
    for (const parent of rawCommit.parents) {
      const parentHash = String(parent || '')
      if (parentHash) parents.push(parentHash)
    }
  }
  return {
    hash: String(rawCommit.hash || ''),
    shortHash: String(rawCommit.short_hash || ''),
    authorName: String(rawCommit.author_name || ''),
    authorEmail: String(rawCommit.author_email || ''),
    authoredAt: String(rawCommit.authored_at || ''),
    parents,
    subject: String(rawCommit.subject || ''),
  }
}

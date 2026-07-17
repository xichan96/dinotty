export interface GitCommitEntry {
  hash: string
  shortHash: string
  authorName: string
  authorEmail: string
  authoredAt: string
  parents: string[]
  decorations: string[]
  subject: string
}

export interface GitGraphSegment {
  fromLane: number
  toLane: number
}

export interface GitGraphRow {
  lane: number
  laneCount: number
  segments: GitGraphSegment[]
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
  const decorations: string[] = []
  if (Array.isArray(rawCommit.decorations)) {
    for (const rawDecoration of rawCommit.decorations) {
      const decoration = String(rawDecoration || '').trim()
      if (decoration) decorations.push(decoration)
    }
  }
  return {
    hash: String(rawCommit.hash || ''),
    shortHash: String(rawCommit.short_hash || ''),
    authorName: String(rawCommit.author_name || ''),
    authorEmail: String(rawCommit.author_email || ''),
    authoredAt: String(rawCommit.authored_at || ''),
    parents,
    decorations,
    subject: String(rawCommit.subject || ''),
  }
}

export function buildGitGraphRows(commits: GitCommitEntry[]): GitGraphRow[] {
  // 步骤1：activeLanes 保存当前行上方仍需继续连接的提交 hash。
  const rows: GitGraphRow[] = []
  const activeLanes: string[] = []
  for (const commit of commits) {
    let lane = activeLanes.indexOf(commit.hash)
    if (lane < 0) {
      activeLanes.push(commit.hash)
      lane = activeLanes.length - 1
    }
    const lanesBefore = activeLanes.slice()
    activeLanes.splice(lane, 1)
    const segments: GitGraphSegment[] = []

    // 步骤2：每个父提交占用或复用一条下行泳道，合并提交会产生多条连接。
    let insertionLane = lane
    for (const parentHash of commit.parents) {
      let parentLane = activeLanes.indexOf(parentHash)
      if (parentLane < 0) {
        activeLanes.splice(insertionLane, 0, parentHash)
        parentLane = insertionLane
        insertionLane += 1
      }
      segments.push({ fromLane: lane, toLane: parentLane })
    }

    // 步骤3：当前提交之外的活跃泳道继续穿过本行，必要时移动到新的位置。
    for (let laneIndex = 0; laneIndex < lanesBefore.length; laneIndex += 1) {
      if (laneIndex === lane) continue
      const activeHash = lanesBefore[laneIndex]
      const targetLane = activeLanes.indexOf(activeHash)
      if (targetLane >= 0) {
        segments.push({ fromLane: laneIndex, toLane: targetLane })
      }
    }
    rows.push({
      lane,
      laneCount: Math.max(lanesBefore.length, activeLanes.length, 1),
      segments,
    })
  }
  return rows
}

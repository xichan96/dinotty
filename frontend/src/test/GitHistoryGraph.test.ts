import { describe, expect, it } from 'vitest'
import { buildGitGraphRows, type GitCommitEntry } from '../utils/gitHistory'

function createCommit(hash: string, parents: string[]): GitCommitEntry {
  // 步骤1：只提供图谱布局需要的稳定提交字段。
  return {
    hash,
    shortHash: hash,
    authorName: 'Test',
    authorEmail: 'test@example.com',
    authoredAt: '2026-07-17T10:00:00+08:00',
    parents,
    decorations: [],
    subject: hash,
  }
}

describe('Git history graph', function gitHistoryGraphSuite() {
  it('keeps merge parents on separate lanes until they join', function laysOutMergeGraph() {
    // 步骤1：构造 A 合并 B、C，随后 B、C 都回到 D 的提交拓扑。
    const commits = [
      createCommit('A', ['B', 'C']),
      createCommit('B', ['D']),
      createCommit('C', ['D']),
      createCommit('D', []),
    ]

    // 步骤2：确认合并后出现第二泳道，C 位于第二泳道并最终连接回 D。
    const rows = buildGitGraphRows(commits)
    expect(rows).toHaveLength(4)
    expect(rows[0].lane).toBe(0)
    expect(rows[0].laneCount).toBe(2)
    expect(rows[2].lane).toBe(1)
    expect(rows[2].segments).toContainEqual({ fromLane: 1, toLane: 0 })
    expect(rows[3].lane).toBe(0)
  })
})

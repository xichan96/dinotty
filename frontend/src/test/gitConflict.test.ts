import { describe, expect, it } from 'vitest'
import { buildResolvedConflictContent, parseConflictContent } from '../utils/gitConflict'

describe('Git conflict parser', function gitConflictParserSuite() {
  it('parses standard and diff3 conflict blocks', function parsesConflictBlocks() {
    // 步骤1：准备同时包含普通文本和 diff3 base 区域的冲突内容。
    const content =
      'before\n<<<<<<< HEAD\ncurrent value\n||||||| base\nbase value\n=======\nincoming value\n>>>>>>> feature\nafter\n'
    const segments = parseConflictContent(content)

    // 步骤2：确认三方内容、标签和普通文本都被完整保留。
    expect(segments).toHaveLength(3)
    expect(segments[1]).toMatchObject({
      type: 'conflict',
      current: 'current value\n',
      base: 'base value\n',
      incoming: 'incoming value\n',
      currentLabel: 'HEAD',
      incomingLabel: 'feature',
      resolution: 'unresolved',
    })
  })

  it('builds content only after every conflict is resolved', function buildsResolvedContent() {
    // 步骤1：解析一个冲突块并确认未解决时拒绝生成最终内容。
    const segments = parseConflictContent(
      'before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> feature\nafter\n'
    )
    expect(buildResolvedConflictContent(segments)).toBeNull()

    // 步骤2：采用两边内容后生成不含冲突标记的结果。
    const conflict = segments[1]
    if (conflict.type !== 'conflict') throw new Error('Missing conflict segment')
    conflict.resolution = 'both'
    conflict.result = `${conflict.current}${conflict.incoming}`
    expect(buildResolvedConflictContent(segments)).toBe('before\ncurrent\nincoming\nafter\n')
  })

  it('rejects malformed content that still contains conflict markers', function rejectsMarkers() {
    // 步骤1：未闭合的冲突块会作为原始文本保留，但绝不能被标记为已解决。
    const segments = parseConflictContent('before\n<<<<<<< HEAD\ncurrent without ending\n')
    expect(buildResolvedConflictContent(segments)).toBeNull()
  })
})

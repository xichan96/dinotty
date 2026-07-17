export interface GitConflictTextSegment {
  type: 'text'
  content: string
}

export interface GitConflictBlockSegment {
  type: 'conflict'
  currentLabel: string
  incomingLabel: string
  current: string
  base: string
  incoming: string
  resolution: 'unresolved' | 'current' | 'incoming' | 'both' | 'manual'
  result: string
}

export type GitConflictSegment = GitConflictTextSegment | GitConflictBlockSegment

function splitLinesWithEndings(content: string): string[] {
  // 步骤1：逐个保留换行符拆分，合并结果才能维持原始文件结构。
  const lines: string[] = []
  let startIndex = 0
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '\n') continue
    lines.push(content.slice(startIndex, index + 1))
    startIndex = index + 1
  }
  if (startIndex < content.length) {
    lines.push(content.slice(startIndex))
  }
  return lines
}

function markerText(line: string): string {
  // 步骤1：只移除标记行自己的换行，不改变冲突内容的换行。
  return line.replace(/\r?\n$/, '')
}

export function parseConflictContent(content: string): GitConflictSegment[] {
  // 步骤1：普通文本持续累积，遇到当前分支标记时再开始解析冲突块。
  const lines = splitLinesWithEndings(content)
  const segments: GitConflictSegment[] = []
  let textContent = ''
  let lineIndex = 0
  while (lineIndex < lines.length) {
    const line = lines[lineIndex]
    const lineMarker = markerText(line)
    if (!lineMarker.startsWith('<<<<<<<')) {
      textContent += line
      lineIndex += 1
      continue
    }
    if (textContent) {
      segments.push({ type: 'text', content: textContent })
      textContent = ''
    }

    // 步骤2：按 current、可选 base、incoming 三个阶段读取完整冲突块。
    const blockStartIndex = lineIndex
    const currentLabel = lineMarker.slice('<<<<<<<'.length).trim()
    let incomingLabel = ''
    let current = ''
    let base = ''
    let incoming = ''
    let phase: 'current' | 'base' | 'incoming' = 'current'
    let blockClosed = false
    lineIndex += 1
    while (lineIndex < lines.length) {
      const blockLine = lines[lineIndex]
      const blockMarker = markerText(blockLine)
      if (blockMarker.startsWith('|||||||') && phase === 'current') {
        phase = 'base'
        lineIndex += 1
        continue
      }
      if (blockMarker === '=======') {
        phase = 'incoming'
        lineIndex += 1
        continue
      }
      if (blockMarker.startsWith('>>>>>>>') && phase === 'incoming') {
        incomingLabel = blockMarker.slice('>>>>>>>'.length).trim()
        blockClosed = true
        lineIndex += 1
        break
      }
      if (phase === 'current') current += blockLine
      if (phase === 'base') base += blockLine
      if (phase === 'incoming') incoming += blockLine
      lineIndex += 1
    }

    // 步骤3：未闭合的块作为原始文本保留，防止损坏用户内容。
    if (!blockClosed) {
      for (let restoreIndex = blockStartIndex; restoreIndex < lineIndex; restoreIndex += 1) {
        textContent += lines[restoreIndex]
      }
      continue
    }
    segments.push({
      type: 'conflict',
      currentLabel,
      incomingLabel,
      current,
      base,
      incoming,
      resolution: 'unresolved',
      result: '',
    })
  }
  if (textContent || segments.length === 0) {
    segments.push({ type: 'text', content: textContent })
  }
  return segments
}

export function buildResolvedConflictContent(segments: GitConflictSegment[]): string | null {
  // 步骤1：只要仍有未解决块就拒绝生成可保存结果。
  let content = ''
  for (const segment of segments) {
    if (segment.type === 'text') {
      content += segment.content
      continue
    }
    if (segment.resolution === 'unresolved') {
      return null
    }
    content += segment.result
  }
  if (containsConflictMarkers(content)) {
    return null
  }
  return content
}

function containsConflictMarkers(content: string): boolean {
  // 步骤1：只识别行首 Git 标记，普通代码字符串中的相似字符不触发误报。
  const lines = content.split('\n')
  for (const line of lines) {
    const marker = line.endsWith('\r') ? line.slice(0, -1) : line
    if (marker.startsWith('<<<<<<<')) return true
    if (marker.startsWith('|||||||')) return true
    if (marker === '=======') return true
    if (marker.startsWith('>>>>>>>')) return true
  }
  return false
}

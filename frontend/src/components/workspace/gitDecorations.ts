import * as monaco from 'monaco-editor'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'

export interface GitChange {
  type: 'added' | 'modified' | 'deleted'
  modifiedStart: number
  modifiedEnd: number
  originalStart?: number
  originalEnd?: number
}

export interface GitDiffData {
  isGitRepo: boolean
  originalContent: string | null
  changes: GitChange[]
  contentVersion: string | null
}

const ADDED_COLOR = '#2ea043'
const MODIFIED_COLOR = '#1976d2'
const DELETED_COLOR = '#d32f2f'

let decorationStylesInjected = false
function injectDecorationStyles() {
  if (decorationStylesInjected) return
  decorationStylesInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .git-gutter-added { border-left: 3px solid ${ADDED_COLOR} !important; cursor: pointer; }
    .git-gutter-modified { border-left: 3px solid ${MODIFIED_COLOR} !important; cursor: pointer; }
    .git-gutter-deleted { cursor: pointer; }
    .git-gutter-deleted::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      border-left: 5px solid ${DELETED_COLOR};
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
    }
    .git-diff-widget-container {
      overflow: hidden;
      border-top: 1px solid ${MODIFIED_COLOR};
      border-bottom: 1px solid ${MODIFIED_COLOR};
      background: #1e1e1e;
    }
    .git-diff-widget-toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 2px 8px;
      background: #1e1e1e;
      border-bottom: 1px solid #2d2d2d;
      min-height: 26px;
    }
    .git-diff-widget-toolbar .diff-info {
      font-size: 12px;
      color: #ccc;
      margin-right: 8px;
      white-space: nowrap;
    }
    .git-diff-widget-toolbar .diff-actions {
      display: flex;
      align-items: center;
      gap: 0;
      margin-left: auto;
    }
    .git-diff-widget-toolbar button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      color: #c5c5c5;
      width: 22px;
      height: 22px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0;
    }
    .git-diff-widget-toolbar button:hover {
      background: rgba(90, 93, 94, 0.31);
    }
    .git-diff-widget-toolbar button:disabled {
      color: #5a5a5a;
      cursor: default;
    }
    .git-diff-widget-toolbar button:disabled:hover {
      background: transparent;
    }
    .git-diff-widget-toolbar button svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    .git-diff-widget-toolbar .diff-separator {
      width: 1px;
      height: 16px;
      background: #424242;
      margin: 0 4px;
    }
  `
  document.head.appendChild(style)
}

export function applyGitDecorations(
  editor: monaco.editor.IStandaloneCodeEditor,
  changes: GitChange[]
): string[] {
  injectDecorationStyles()
  const decorations: monaco.editor.IModelDeltaDecoration[] = []

  for (const c of changes) {
    if (c.type === 'added') {
      decorations.push({
        range: new monaco.Range(c.modifiedStart, 1, c.modifiedEnd, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: 'git-gutter-added',
          overviewRuler: { color: ADDED_COLOR, position: monaco.editor.OverviewRulerLane.Left },
        },
      })
    } else if (c.type === 'modified') {
      decorations.push({
        range: new monaco.Range(c.modifiedStart, 1, c.modifiedEnd, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: 'git-gutter-modified',
          overviewRuler: { color: MODIFIED_COLOR, position: monaco.editor.OverviewRulerLane.Left },
        },
      })
    } else if (c.type === 'deleted') {
      decorations.push({
        range: new monaco.Range(c.modifiedStart, 1, c.modifiedStart, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: 'git-gutter-deleted',
          overviewRuler: { color: DELETED_COLOR, position: monaco.editor.OverviewRulerLane.Left },
        },
      })
    }
  }

  const model = editor.getModel()
  if (!model) return []
  return model.deltaDecorations([], decorations)
}

export function clearGitDecorations(editor: monaco.editor.IStandaloneCodeEditor, ids: string[]) {
  const model = editor.getModel()
  if (model && ids.length) model.deltaDecorations(ids, [])
}

export async function fetchGitDiff(paneId: string, filePath: string): Promise<GitDiffData | null> {
  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: paneId, path: filePath })
    const res = await authFetch(apiUrl(`/api/workspace/git-diff?${q}`))
    if (!res.ok) return null
    const data = await res.json()
    return {
      isGitRepo: data.is_git_repo,
      originalContent: data.original_content ?? null,
      contentVersion: data.content_version ?? null,
      changes: (data.changes || []).map((c: any) => ({
        type: c.type,
        modifiedStart: c.modified_start,
        modifiedEnd: c.modified_end,
        originalStart: c.original_start,
        originalEnd: c.original_end,
      })),
    }
  } catch {
    return null
  }
}

export async function stageLines(
  paneId: string,
  filePath: string,
  startLine: number,
  endLine: number
): Promise<boolean> {
  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: paneId, path: filePath })
    const res = await authFetch(apiUrl(`/api/workspace/git-stage-lines?${q}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_line: startLine, end_line: endLine }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function revertLines(
  paneId: string,
  filePath: string,
  startLine: number,
  endLine: number,
  contentVersion: string
): Promise<boolean> {
  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: paneId, path: filePath })
    const res = await authFetch(apiUrl(`/api/workspace/git-revert-lines?${q}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_line: startLine,
        end_line: endLine,
        content_version: contentVersion,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

interface DiffWidgetCallbacks {
  onStage: (change: GitChange) => void
  onRevert: (change: GitChange) => void
  onClose: () => void
  onNavigate: (change: GitChange) => void
}

function iconBtn(
  svgPath: string,
  title: string,
  onClick: () => void,
  disabled = false
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.title = title
  btn.disabled = disabled
  btn.innerHTML = `<svg viewBox="0 0 16 16"><path d="${svgPath}"/></svg>`
  btn.onclick = (e) => {
    e.stopPropagation()
    onClick()
  }
  return btn
}

export function createDiffWidget(
  editor: monaco.editor.IStandaloneCodeEditor,
  hunk: GitChange,
  originalContent: string,
  allChanges: GitChange[],
  callbacks: DiffWidgetCallbacks
): { dispose: () => void } {
  injectDecorationStyles()

  const container = document.createElement('div')
  container.className = 'git-diff-widget-container'
  container.addEventListener('mousedown', (e) => {
    e.stopPropagation()
  })
  container.addEventListener('mouseup', (e) => {
    e.stopPropagation()
  })
  container.addEventListener('click', (e) => {
    e.stopPropagation()
  })

  const toolbar = document.createElement('div')
  toolbar.className = 'git-diff-widget-toolbar'

  const hunkIdx = allChanges.indexOf(hunk)

  const info = document.createElement('span')
  info.className = 'diff-info'
  info.textContent = `${hunkIdx + 1} of ${allChanges.length} changes`

  const actions = document.createElement('span')
  actions.className = 'diff-actions'

  const prevBtn = iconBtn(
    'M8 3.5L3.5 8 8 12.5V9h4.5V7H8V3.5z',
    'Previous Change (Shift+Alt+F5)',
    () => {
      if (hunkIdx > 0) callbacks.onNavigate(allChanges[hunkIdx - 1])
    },
    hunkIdx <= 0
  )
  const nextBtn = iconBtn(
    'M8 12.5L12.5 8 8 3.5V7H3.5v2H8v3.5z',
    'Next Change (Alt+F5)',
    () => {
      if (hunkIdx < allChanges.length - 1) callbacks.onNavigate(allChanges[hunkIdx + 1])
    },
    hunkIdx >= allChanges.length - 1
  )

  const sep1 = document.createElement('span')
  sep1.className = 'diff-separator'

  // revert: codicon-discard (undo arrow)
  const revertBtn = iconBtn(
    'M3.5 2v4.5H8L5.3 3.8C6.3 3 7.6 2.5 9 2.5c3 0 5.5 2.5 5.5 5.5S12 13.5 9 13.5 3.5 11 3.5 8H2c0 3.9 3.1 7 7 7s7-3.1 7-7-3.1-7-7-7c-1.7 0-3.3.6-4.5 1.7V2H3.5z',
    'Revert Change',
    () => callbacks.onRevert(hunk)
  )

  const sep2 = document.createElement('span')
  sep2.className = 'diff-separator'

  // stage: codicon-add
  const stageBtn = iconBtn('M14 7v1H8v6H7V8H1V7h6V1h1v6h6z', 'Stage Change', () =>
    callbacks.onStage(hunk)
  )

  const sep3 = document.createElement('span')
  sep3.className = 'diff-separator'

  // close: codicon-close
  const closeBtn = iconBtn(
    'M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z',
    'Close',
    () => callbacks.onClose()
  )

  actions.append(prevBtn, nextBtn, sep1, revertBtn, sep2, stageBtn, sep3, closeBtn)
  toolbar.append(info, actions)
  container.appendChild(toolbar)

  const diffContainer = document.createElement('div')
  container.appendChild(diffContainer)

  const origLines = originalContent.split('\n')
  const currentContent = editor.getValue()
  const curLines = currentContent.split('\n')

  let origStart = (hunk.originalStart ?? 1) - 1
  let origEnd = hunk.originalEnd ?? origStart
  let modStart = hunk.modifiedStart - 1
  let modEnd = hunk.modifiedEnd

  const ctxBefore = 3
  const ctxAfter = 3
  const origCtxStart = Math.max(0, origStart - ctxBefore)
  const origCtxEnd = Math.min(origLines.length, origEnd + ctxAfter)
  const modCtxStart = Math.max(0, modStart - ctxBefore)
  const modCtxEnd = Math.min(curLines.length, modEnd + ctxAfter)

  const origText = origLines.slice(origCtxStart, origCtxEnd).join('\n')
  const modText = curLines.slice(modCtxStart, modCtxEnd).join('\n')

  const diffLineCount = Math.max(origCtxEnd - origCtxStart, modCtxEnd - modCtxStart)
  const diffHeightPx = Math.min(Math.max(diffLineCount * 19 + 10, 80), 300)
  diffContainer.style.height = diffHeightPx + 'px'

  const totalHeight = diffHeightPx + 30

  let viewZoneId: string | null = null
  editor.changeViewZones((accessor) => {
    viewZoneId = accessor.addZone({
      afterLineNumber: hunk.modifiedStart - 1,
      heightInPx: totalHeight,
      domNode: container,
      suppressMouseDown: true,
    })
  })

  const diffEditor = monaco.editor.createDiffEditor(diffContainer, {
    readOnly: true,
    renderSideBySide: false,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: 'on',
    glyphMargin: false,
    folding: false,
    renderOverviewRuler: false,
    overviewRulerLanes: 0,
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  })

  const origModel = monaco.editor.createModel(origText, 'plaintext')
  const modModel = monaco.editor.createModel(modText, 'plaintext')
  diffEditor.setModel({ original: origModel, modified: modModel })

  return {
    dispose() {
      diffEditor.dispose()
      origModel.dispose()
      modModel.dispose()
      editor.changeViewZones((accessor) => {
        if (viewZoneId) accessor.removeZone(viewZoneId)
      })
    },
  }
}

export function findChangeAtLine(changes: GitChange[], line: number): GitChange | undefined {
  return changes.find((c) => line >= c.modifiedStart && line <= c.modifiedEnd)
}

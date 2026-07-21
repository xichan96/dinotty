import { ref, type Ref } from 'vue'
import * as monaco from 'monaco-editor'
import { getEditor, whenEditorReady } from './useEditorRegistry'
import type { useEditorSplit } from './useEditorSplit'

export interface SearchMatch {
  filePath: string
  line: number
  column: number
  lineText: string
}

export interface PickerItem {
  id: string
  label: string
  detail?: string
}

export interface CursorGroupEntry {
  leafId: string
  filePath: string
  lineNumber: number
  column: number
}

export interface CursorGroup {
  id: string
  entries: CursorGroupEntry[]
}

type EditorSplitApi = ReturnType<typeof useEditorSplit>

let editorSplitRef: EditorSplitApi | null = null
const broadcastingLeaves = new Set<string>()

const groups = ref<CursorGroup[]>([]) as Ref<CursorGroup[]>
const activeGroupId = ref<string | null>(null)

export function setEditorSplitForCursorGroup(split: EditorSplitApi | null): void {
  editorSplitRef = split
}

export function isCursorBroadcasting(leafId: string): boolean {
  return broadcastingLeaves.has(leafId)
}

function genGroupId(): string {
  return `cg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function createGroupFromSearch(matches: SearchMatch[]): Promise<void> {
  if (!editorSplitRef) throw new Error('editor split not ready')
  if (matches.length === 0) return

  const byFile = new Map<string, SearchMatch[]>()
  for (const m of matches) {
    const arr = byFile.get(m.filePath) ?? []
    arr.push(m)
    byFile.set(m.filePath, arr)
  }

  const files: Array<{ filePath: string; isDir: boolean }> = []
  for (const fp of byFile.keys()) {
    files.push({ filePath: fp, isDir: false })
  }

  const leafIds = editorSplitRef.openFilesInBalancedSplit(files, 'horizontal')
  const fileToLeaf = new Map<string, string>()
  for (let i = 0; i < files.length; i++) {
    fileToLeaf.set(files[i].filePath, leafIds[i])
  }

  const entries: CursorGroupEntry[] = []
  for (const [filePath, fileMatches] of byFile) {
    const leafId = fileToLeaf.get(filePath)
    if (!leafId) continue
    const editor = await whenEditorReady(leafId)
    const selections = fileMatches.map((m) => ({
      selectionStartLineNumber: m.line,
      selectionStartColumn: m.column,
      positionLineNumber: m.line,
      positionColumn: m.column,
    }))
    editor.setSelections(selections)
    const first = fileMatches[0]
    editor.setPosition({ lineNumber: first.line, column: first.column })
    editor.revealLineInCenter(first.line)
    editor.focus()
    for (const m of fileMatches) {
      entries.push({
        leafId,
        filePath,
        lineNumber: m.line,
        column: m.column,
      })
    }
  }

  const group: CursorGroup = { id: genGroupId(), entries }
  groups.value = [...groups.value, group]
  activeGroupId.value = group.id
}

function findGroupForLeaf(leafId: string): CursorGroup | null {
  return groups.value.find((g) => g.entries.some((e) => e.leafId === leafId)) ?? null
}

function broadcastChange(
  sourceLeafId: string,
  changes: readonly monaco.editor.IModelContentChange[],
): void {
  const group = findGroupForLeaf(sourceLeafId)
  if (!group) return
  if (activeGroupId.value !== group.id) return

  for (const entry of group.entries) {
    if (entry.leafId === sourceLeafId) continue
    const editor = getEditor(entry.leafId)
    if (!editor) continue
    const model = editor.getModel()
    if (!model) continue

    broadcastingLeaves.add(entry.leafId)
    try {
      editor.executeEdits(
        'cursor-group-broadcast',
        changes.map((c) => ({
          range: c.range,
          text: c.text,
          forceMoveMarkers: true,
        })),
      )
    } finally {
      broadcastingLeaves.delete(entry.leafId)
    }
  }
}

function applyToGroup(
  groupId: string | null,
  op: 'undo' | 'redo',
): void {
  if (!groupId) return
  const group = groups.value.find((g) => g.id === groupId)
  if (!group) return
  for (const entry of group.entries) {
    const editor = getEditor(entry.leafId)
    if (!editor) continue
    broadcastingLeaves.add(entry.leafId)
    try {
      editor.trigger('cursor-group', op, null)
    } finally {
      broadcastingLeaves.delete(entry.leafId)
    }
  }
}

function groupUndo(): void {
  applyToGroup(activeGroupId.value, 'undo')
}

function groupRedo(): void {
  applyToGroup(activeGroupId.value, 'redo')
}

export function useCursorGroup() {
  return {
    groups,
    activeGroupId,
    broadcastChange,
    groupUndo,
    groupRedo,
    createGroupFromSearch,
  }
}

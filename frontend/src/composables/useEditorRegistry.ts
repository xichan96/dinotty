import * as monaco from 'monaco-editor'

const editors = new Map<string, monaco.editor.IStandaloneCodeEditor>()
const pending = new Map<string, Array<(e: monaco.editor.IStandaloneCodeEditor) => void>>()
let activeLeaf: string | null = null

export function registerEditor(
  leafId: string,
  editor: monaco.editor.IStandaloneCodeEditor,
): void {
  editors.set(leafId, editor)
  const waiters = pending.get(leafId)
  if (waiters) {
    pending.delete(leafId)
    for (const w of waiters) w(editor)
  }
}

export function unregisterEditor(leafId: string): void {
  editors.delete(leafId)
  pending.delete(leafId)
  if (activeLeaf === leafId) activeLeaf = null
}

export function getEditor(
  leafId: string,
): monaco.editor.IStandaloneCodeEditor | null {
  return editors.get(leafId) ?? null
}

export function setActiveLeaf(leafId: string | null): void {
  activeLeaf = leafId
}

export function getActiveLeaf(): string | null {
  return activeLeaf
}

export function whenEditorReady(
  leafId: string,
): Promise<monaco.editor.IStandaloneCodeEditor> {
  const existing = editors.get(leafId)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const arr = pending.get(leafId) ?? []
    arr.push(resolve)
    pending.set(leafId, arr)
  })
}

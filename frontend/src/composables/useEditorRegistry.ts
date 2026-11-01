import { shallowReactive, type Ref } from 'vue'
import type * as monaco from 'monaco-editor'

/** Live state a mounted EditorPane exposes to its workspace. */
export interface EditorPaneState {
  filePath: () => string | null
  isDirty: () => boolean
  meta: Ref<any | null>
  editorText: Ref<string>
  editorBaseline: Ref<string>
  diskChanged: Ref<boolean>
  reloadFromDisk: () => Promise<void>
  markDiskChanged: () => void
}

const editors = new Map<string, monaco.editor.IStandaloneCodeEditor>()
// Reactive so active-pane computeds re-evaluate when a pane registers/unregisters.
const paneStates = shallowReactive(new Map<string, EditorPaneState>())
const pending = new Map<string, Array<(e: monaco.editor.IStandaloneCodeEditor) => void>>()
let activeLeaf: string | null = null

export function registerEditor(leafId: string, editor: monaco.editor.IStandaloneCodeEditor): void {
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

export function getEditor(leafId: string): monaco.editor.IStandaloneCodeEditor | null {
  return editors.get(leafId) ?? null
}

export function setActiveLeaf(leafId: string | null): void {
  activeLeaf = leafId
}

export function getActiveLeaf(): string | null {
  return activeLeaf
}

export function whenEditorReady(leafId: string): Promise<monaco.editor.IStandaloneCodeEditor> {
  const existing = editors.get(leafId)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const arr = pending.get(leafId) ?? []
    arr.push(resolve)
    pending.set(leafId, arr)
  })
}

export function registerEditorPaneState(leafId: string, state: EditorPaneState): void {
  paneStates.set(leafId, state)
}

export function unregisterEditorPaneState(leafId: string): void {
  paneStates.delete(leafId)
}

export function getEditorPaneState(leafId: string): EditorPaneState | null {
  return paneStates.get(leafId) ?? null
}

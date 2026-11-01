import { ref, type Ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import { workspaceErrorFromResponse, workspaceErrorKind } from './useFileWorkspaceBoot'
import type { DirEntry } from '../components/workspace/TreeRows'

export interface InlineCreateState {
  parentRel: string
  kind: 'file' | 'dir'
  /** Kept so a failed commit can restore exactly what the user typed. */
  value?: string
  error?: string
}

export interface InlineRenameState {
  rel: string
  isDir: boolean
  value?: string
  error?: string
}

export interface InlineCreateRenameOptions {
  paneId: Ref<string>
  cwdLabel: Ref<string>
  selectedRel: Ref<string | null>
  selectedIsDir: Ref<boolean>
  childCache: Ref<Record<string, DirEntry[]>>
  expanded: Ref<Set<string>>
  parentRelPath: (rel: string) => string
  ensureChildren: (rel: string) => Promise<void>
  onSelectFile: (rel: string) => Promise<void> | void
  onSelectDir: (rel: string) => void
  t: (key: string) => string
}

export interface InlineCreateRename {
  inlineCreate: Ref<InlineCreateState | null>
  inlineRename: Ref<InlineRenameState | null>
  startNewFile: () => void
  startNewFolder: () => void
  onInlineCreateCommit: (name: string) => Promise<void>
  onInlineCreateCancel: () => void
  onInlineRenameCommit: (newName: string) => Promise<void>
  onInlineRenameCancel: () => void
}

function baseName(rel: string): string {
  return rel.split('/').pop() || rel
}

export function useInlineCreateRename(opts: InlineCreateRenameOptions): InlineCreateRename {
  const {
    paneId,
    cwdLabel,
    selectedRel,
    selectedIsDir,
    childCache,
    expanded,
    parentRelPath,
    ensureChildren,
    onSelectFile,
    onSelectDir,
    t,
  } = opts

  const inlineCreate = ref<InlineCreateState | null>(null)
  const inlineRename = ref<InlineRenameState | null>(null)

  function newItemParentRel(): string {
    if (selectedIsDir.value && selectedRel.value) return selectedRel.value
    if (!selectedIsDir.value && selectedRel.value) return parentRelPath(selectedRel.value)
    return ''
  }

  function startNewFile(): void {
    const parentRel = newItemParentRel()
    inlineCreate.value = { parentRel, kind: 'file', value: '', error: '' }
    expanded.value = new Set([...expanded.value, parentRel])
    void ensureChildren(parentRel)
  }

  function startNewFolder(): void {
    const parentRel = newItemParentRel()
    inlineCreate.value = { parentRel, kind: 'dir', value: '', error: '' }
    expanded.value = new Set([...expanded.value, parentRel])
    void ensureChildren(parentRel)
  }

  function createErrorText(e: unknown, kind: 'file' | 'dir'): string {
    switch (workspaceErrorKind(e)) {
      case 'conflict':
        return kind === 'dir'
          ? t('filePreview.errFolderExists')
          : t('filePreview.errFileExists')
      case 'forbidden':
        return t('filePreview.errPermission')
      case 'notFound':
        return t('filePreview.errNotFound')
      case 'network':
        return t('filePreview.errNetwork')
      default:
        return t('filePreview.errCreateFailed')
    }
  }

  function renameErrorText(e: unknown): string {
    switch (workspaceErrorKind(e)) {
      case 'conflict':
        return t('filePreview.errRenameExists')
      case 'forbidden':
        return t('filePreview.errPermission')
      case 'notFound':
        return t('filePreview.errNotFound')
      case 'network':
        return t('filePreview.errNetwork')
      default:
        return t('filePreview.errRenameFailed')
    }
  }

  async function onInlineCreateCommit(name: string): Promise<void> {
    const state = inlineCreate.value
    if (!state) return
    const trimmed = name.trim()
    if (!trimmed) {
      inlineCreate.value = null
      return
    }
    const { parentRel, kind } = state
    // Keep the row mounted while the request runs; only a success closes it.
    // The object identity marks this request: if the user cancels or starts a
    // different create meanwhile, the response must not touch the new state.
    inlineCreate.value = { ...state, value: trimmed, error: '' }
    const requestState = inlineCreate.value
    try {
      await getApiBase()
      const q = new URLSearchParams({ pane_id: paneId.value, parent: parentRel })
      if (cwdLabel.value) q.set('cwd', cwdLabel.value)
      const res = await authFetch(apiUrl(`/api/workspace/create?${q}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name: trimmed }),
      })
      if (!res.ok) throw await workspaceErrorFromResponse(res)
      const data = await res.json()
      if (inlineCreate.value !== requestState) return
      inlineCreate.value = null
      const rel = data.rel as string
      const next = { ...childCache.value }
      delete next[parentRel]
      childCache.value = next
      try {
        await ensureChildren(parentRel)
      } catch {}
      if (kind === 'file') await onSelectFile(rel)
      else {
        expanded.value = new Set([...expanded.value, rel])
        onSelectDir(rel)
        void ensureChildren(rel)
      }
    } catch (e) {
      if (inlineCreate.value !== requestState) return
      inlineCreate.value = {
        ...requestState,
        value: trimmed,
        error: createErrorText(e, kind),
      }
    }
  }

  function onInlineCreateCancel(): void {
    inlineCreate.value = null
  }

  async function onInlineRenameCommit(newName: string): Promise<void> {
    const state = inlineRename.value
    if (!state) return
    const trimmed = newName.trim()
    if (!trimmed) {
      inlineRename.value = null
      return
    }
    const { rel, isDir } = state
    // The input is prefilled with the current name; committing it unchanged is
    // a no-op (the backend would report a 409 against the entry itself).
    if (trimmed === (state.value || baseName(rel))) {
      inlineRename.value = null
      return
    }
    inlineRename.value = { ...state, value: trimmed, error: '' }
    const requestState = inlineRename.value
    try {
      await getApiBase()
      const q = new URLSearchParams({ pane_id: paneId.value, path: rel })
      if (cwdLabel.value) q.set('cwd', cwdLabel.value)
      const res = await authFetch(apiUrl(`/api/workspace/rename?${q}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: trimmed }),
      })
      if (!res.ok) throw await workspaceErrorFromResponse(res)
      const data = await res.json()
      if (inlineRename.value !== requestState) return
      inlineRename.value = null
      const newRel = data.rel as string
      const parentRel = parentRelPath(rel)
      const next = { ...childCache.value }
      delete next[parentRel]
      if (isDir) {
        for (const k of Object.keys(next)) {
          if (k === rel || k.startsWith(`${rel}/`)) delete next[k]
        }
      }
      childCache.value = next
      try {
        await ensureChildren(parentRel)
      } catch {}
      if (selectedRel.value === rel) {
        if (isDir) onSelectDir(newRel)
        else await onSelectFile(newRel)
      }
    } catch (e) {
      if (inlineRename.value !== requestState) return
      inlineRename.value = {
        ...requestState,
        value: trimmed,
        error: renameErrorText(e),
      }
    }
  }

  function onInlineRenameCancel(): void {
    inlineRename.value = null
  }

  return {
    inlineCreate,
    inlineRename,
    startNewFile,
    startNewFolder,
    onInlineCreateCommit,
    onInlineCreateCancel,
    onInlineRenameCommit,
    onInlineRenameCancel,
  }
}

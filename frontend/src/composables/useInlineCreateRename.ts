import { ref, type Ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import type { DirEntry } from '../components/workspace/TreeRows'

export interface InlineCreateState {
  parentRel: string
  kind: 'file' | 'dir'
}

export interface InlineRenameState {
  rel: string
  isDir: boolean
}

export interface InlineCreateRenameOptions {
  paneId: Ref<string>
  cwdLabel: Ref<string>
  selectedRel: Ref<string | null>
  selectedIsDir: Ref<boolean>
  childCache: Ref<Record<string, DirEntry[]>>
  expanded: Ref<Set<string>>
  previewErr: Ref<string>
  parentRelPath: (rel: string) => string
  ensureChildren: (rel: string) => Promise<void>
  onSelectFile: (rel: string) => Promise<void> | void
  onSelectDir: (rel: string) => void
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

export function useInlineCreateRename(opts: InlineCreateRenameOptions): InlineCreateRename {
  const {
    paneId,
    cwdLabel,
    selectedRel,
    selectedIsDir,
    childCache,
    expanded,
    previewErr,
    parentRelPath,
    ensureChildren,
    onSelectFile,
    onSelectDir,
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
    inlineCreate.value = { parentRel, kind: 'file' }
    expanded.value = new Set([...expanded.value, parentRel])
    void ensureChildren(parentRel)
  }

  function startNewFolder(): void {
    const parentRel = newItemParentRel()
    inlineCreate.value = { parentRel, kind: 'dir' }
    expanded.value = new Set([...expanded.value, parentRel])
    void ensureChildren(parentRel)
  }

  async function onInlineCreateCommit(name: string): Promise<void> {
    if (!inlineCreate.value) return
    if (!name) {
      inlineCreate.value = null
      return
    }
    const { parentRel, kind } = inlineCreate.value
    inlineCreate.value = null
    await getApiBase()
    const q = new URLSearchParams({ pane_id: paneId.value, parent: parentRel })
    if (cwdLabel.value) q.set('cwd', cwdLabel.value)
    const res = await authFetch(apiUrl(`/api/workspace/create?${q}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, name }),
    })
    if (!res.ok) {
      previewErr.value = res.status === 409 ? 'exists' : 'create failed'
      return
    }
    previewErr.value = ''
    const data = await res.json()
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
  }

  function onInlineCreateCancel(): void {
    inlineCreate.value = null
  }

  async function onInlineRenameCommit(newName: string): Promise<void> {
    if (!inlineRename.value) return
    if (!newName) {
      inlineRename.value = null
      return
    }
    const { rel, isDir } = inlineRename.value
    inlineRename.value = null
    await getApiBase()
    const q = new URLSearchParams({ pane_id: paneId.value, path: rel })
    if (cwdLabel.value) q.set('cwd', cwdLabel.value)
    const res = await authFetch(apiUrl(`/api/workspace/rename?${q}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newName }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      previewErr.value = j.error || 'rename failed'
      return
    }
    previewErr.value = ''
    const data = await res.json()
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

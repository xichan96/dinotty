import { ref, computed, type Ref } from 'vue'
import { getApiBase, apiUrl, authFetch, getAuthToken } from './apiBase'
import { isTauri, tauriInvoke } from './useTransport'
import type { DirEntry } from '../components/workspace/TreeRows'

// --- Tauri native drag-drop support ---
let tauriFileDropRegistered = false
let _activeUploadFn: ((files: { file: File; path: string }[], targetDir?: string) => Promise<void>) | null = null
let _workspaceDropHover = false
let _hoveredDir: string | undefined = undefined

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function setupTauriFileDrop() {
  if (tauriFileDropRegistered) return
  tauriFileDropRegistered = true
  const w = window as any
  const listen = w.__TAURI__?.event?.listen
  if (!listen) return

  listen('file-drop-paths', async (event: any) => {
    if (!_activeUploadFn || !_workspaceDropHover) return
    const paths: string[] = event.payload || []
    if (!paths.length) return
    const files: { file: File; path: string }[] = []
    for (const p of paths) {
      try {
        const b64: string = await tauriInvoke('tauri_read_file', { path: p }) as string
        const binary = atob(b64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const name = p.split('/').pop() || 'file'
        const file = new File([bytes], name)
        files.push({ file, path: name })
      } catch (e) {
        console.error('[upload] failed to read dropped file:', p, e)
      }
    }
    if (files.length) await _activeUploadFn!(files, _hoveredDir)
  })
}

interface Meta {
  kind: string
  content?: string
  language?: string
  truncated?: boolean
  message?: string
}

export function useFileOperations(opts: {
  paneId: () => string
  selectedRel: Ref<string | null>
  selectedIsDir: Ref<boolean>
  meta: Ref<Meta | null>
  childCache: Ref<Record<string, DirEntry[]>>
  expanded: Ref<Set<string>>
  inlineCreate: Ref<{ parentRel: string; kind: 'file' | 'dir' } | null>
  cwdLabel: Ref<string>
  ensureChildren: (rel: string) => Promise<void>
  emit: (event: 'navigate', path: string) => void
}) {
  const fileInputRef = ref<HTMLInputElement>()
  const dragCounter = ref(0)
  const dragging = computed(() => dragCounter.value > 0)
  const cacheBustTs = ref<number | null>(null)

  const rawUrl = computed(() => {
    if (!opts.selectedRel.value || opts.selectedIsDir.value) return ''
    const q = new URLSearchParams({ pane_id: opts.paneId(), path: opts.selectedRel.value })
    const token = getAuthToken()
    if (token) q.set('token', token)
    if (cacheBustTs.value) q.set('_t', String(cacheBustTs.value))
    return apiUrl(`/api/workspace/raw?${q}`)
  })

  const canDownload = computed(
    () => !!opts.selectedRel.value && !opts.selectedIsDir.value && opts.meta.value?.kind !== 'unsupported',
  )

  function parentRelPath(rel: string): string {
    const i = rel.lastIndexOf('/')
    return i === -1 ? '' : rel.slice(0, i)
  }

  function absolutePath(rel: string): string {
    const root = opts.cwdLabel.value.replace(/\/+$/, '')
    return rel ? `${root}/${rel}` : root
  }

  function triggerUpload() { fileInputRef.value?.click() }

  async function uploadFiles(files: { file: File; path: string }[], targetDir?: string) {
    if (!files.length) return
    await getApiBase()
    const dir = targetDir !== undefined
      ? targetDir
      : (opts.selectedIsDir.value && opts.selectedRel.value ? opts.selectedRel.value : '')
    try {
      if (isTauri()) {
        const token = getAuthToken()
        const encoded = await Promise.all(
          files.map(async ({ file, path }) => ({
            name: file.name,
            path,
            data: await fileToBase64(file),
          })),
        )
        const resp = (await tauriInvoke('tauri_upload', {
          paneId: opts.paneId(),
          dir,
          files: encoded,
          token: token || undefined,
        })) as { status: number; body: string }
        if (resp.status >= 400) console.error('[upload] server error:', resp.status)
      } else {
        const q = new URLSearchParams({ pane_id: opts.paneId(), dir })
        const fd = new FormData()
        for (const { file, path } of files) {
          fd.append('path', path)
          fd.append('file', file)
        }
        const res = await authFetch(apiUrl(`/api/workspace/upload?${q}`), { method: 'POST', body: fd })
        if (!res.ok) console.error('[upload] server error:', res.status)
      }
    } catch (e) {
      console.error('[upload] request failed:', e)
    }
    const next = { ...opts.childCache.value }
    delete next[dir]
    opts.childCache.value = next
    try { await opts.ensureChildren(dir) } catch {}
  }

  async function onFilePick(ev: Event) {
    const inp = ev.target as HTMLInputElement
    const fileList = inp.files
    if (!fileList?.length) return
    const files: { file: File; path: string }[] = []
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i]
      files.push({ file: f, path: f.webkitRelativePath || f.name })
    }
    inp.value = ''
    try { await uploadFiles(files) } catch (e) { console.error('[upload]', e) }
  }

  async function traverseEntry(entry: FileSystemEntry, basePath: string): Promise<{ file: File; path: string }[]> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry
      try {
        const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject))
        return [{ file, path: basePath + entry.name }]
      } catch { return [] }
    }
    if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry
      const reader = dirEntry.createReader()
      const entries: FileSystemEntry[] = []
      try {
        let batch: FileSystemEntry[]
        do {
          batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
          entries.push(...batch)
        } while (batch.length > 0)
      } catch { return [] }
      const results: { file: File; path: string }[] = []
      const childResults = await Promise.all(entries.map(child => traverseEntry(child, basePath + entry.name + '/')))
      for (const r of childResults) results.push(...r)
      return results
    }
    return []
  }

  async function onDrop(ev: DragEvent) {
    const items = ev.dataTransfer?.items
    if (!items) return
    const allFiles: { file: File; path: string }[] = []
    const promises: Promise<void>[] = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.()
      if (entry) promises.push(traverseEntry(entry, '').then(files => { allFiles.push(...files) }))
    }
    try { await Promise.all(promises) } catch {}
    if (!allFiles.length) return
    await uploadFiles(allFiles)
  }

  async function downloadFile(rel: string) {
    if (!rel) return
    await getApiBase()
    const q = new URLSearchParams({ pane_id: opts.paneId(), path: rel })
    const res = await authFetch(apiUrl(`/api/workspace/raw?${q}`))
    if (!res.ok) return
    const blob = await res.blob()
    const name = rel.split('/').pop() || 'file'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function downloadSelected() {
    if (!opts.selectedRel.value || opts.selectedIsDir.value) return
    await downloadFile(opts.selectedRel.value)
  }

  async function deleteSelected(
    skipConfirm: boolean,
    t: (key: string) => string,
    resetState: () => void,
  ): Promise<boolean> {
    const rel = opts.selectedRel.value
    if (!rel) return false
    opts.inlineCreate.value = null
    const wasDir = opts.selectedIsDir.value
    const msg = wasDir ? t('filePreview.confirmDeleteFolder') : t('filePreview.confirmDeleteFile')
    if (!skipConfirm && !confirm(msg)) return false
    await getApiBase()
    const q = new URLSearchParams({ pane_id: opts.paneId(), path: rel })
    const res = await authFetch(apiUrl(`/api/workspace/delete?${q}`), { method: 'DELETE' })
    if (!res.ok) return false
    const parentRel = parentRelPath(rel)
    if (wasDir) {
      const next: Record<string, DirEntry[]> = { ...opts.childCache.value }
      for (const k of Object.keys(next)) {
        if (k === rel || k.startsWith(`${rel}/`)) delete next[k]
      }
      delete next[parentRel]
      opts.childCache.value = next
      const nextExp = new Set(opts.expanded.value)
      for (const k of [...nextExp]) {
        if (k === rel || k.startsWith(`${rel}/`)) nextExp.delete(k)
      }
      opts.expanded.value = nextExp
    } else {
      const next = { ...opts.childCache.value }
      delete next[parentRel]
      opts.childCache.value = next
    }
    resetState()
    opts.emit('navigate', absolutePath(parentRel))
    try { await opts.ensureChildren(parentRel) } catch {}
    return true
  }

  // --- Tauri native drag-drop wiring ---
  if (isTauri()) setupTauriFileDrop()

  function setActiveWorkspace() { _activeUploadFn = uploadFiles }
  function clearActiveWorkspace() { if (_activeUploadFn === uploadFiles) _activeUploadFn = null }

  function setHoveredDir(dir: string | undefined) { _hoveredDir = dir }
  function clearHoveredDir() { _hoveredDir = undefined }

  function onWorkspaceDragEnter() {
    dragCounter.value++
    _workspaceDropHover = true
  }
  function onWorkspaceDragLeave() {
    dragCounter.value = Math.max(0, dragCounter.value - 1)
    if (dragCounter.value === 0) _workspaceDropHover = false
  }
  function onWorkspaceDrop(ev: DragEvent) {
    dragCounter.value = 0
    _workspaceDropHover = false
    onDrop(ev)
  }

  return {
    fileInputRef,
    dragCounter,
    dragging,
    cacheBustTs,
    rawUrl,
    canDownload,
    parentRelPath,
    absolutePath,
    triggerUpload,
    uploadFiles,
    onFilePick,
    onDrop,
    traverseEntry,
    downloadFile,
    downloadSelected,
    deleteSelected,
    setActiveWorkspace,
    clearActiveWorkspace,
    setHoveredDir,
    clearHoveredDir,
    onWorkspaceDragEnter,
    onWorkspaceDragLeave,
    onWorkspaceDrop,
  }
}

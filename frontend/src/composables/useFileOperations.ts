import { ref, computed, type Ref } from 'vue'
import { getApiBase, apiUrl, authFetch, getAuthToken } from './apiBase'
import { uiConfirm } from './useConfirm'
import { isTauri, tauriInvoke } from './useTransport'
import { isInternalDragActive, getInternalDragRel, clearInternalDrag } from './internalDragState'
import type { DirEntry } from '../components/workspace/TreeRows'

// --- Tauri native drag-drop support ---
let tauriFileDropRegistered = false
let _activeUploadFn:
  | ((files: { file: File; path: string }[], targetDir?: string) => Promise<void>)
  | null = null
let _workspaceDropHover = false
let _hoveredDir: string | undefined = undefined
let _dragCounterRef: { value: number } | null = null

let _tauriUnlisten: (() => void) | null = null

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

  // Tauri v2 listen() returns Promise<UnlistenFn>
  const unlistenDrop = listen('file-drop-paths', async (event: any) => {
    // Internal tree drag → emit on the target EditorPane
    if (isInternalDragActive()) {
      const rel = getInternalDragRel()
      clearInternalDrag()
      if (rel) {
        const payload = event.payload || {}
        const pos = payload.position || { x: 0, y: 0 }
        // Tauri position is in physical pixels; convert to CSS pixels
        const dpr = window.devicePixelRatio || 1
        const cx = (pos.x ?? 0) / dpr
        const cy = (pos.y ?? 0) / dpr
        const el = cx && cy ? document.elementFromPoint(cx, cy) : null
        const pane = el?.closest('.editor-pane') as HTMLElement | null
        if (pane) {
          const rect = pane.getBoundingClientRect()
          const x = cx - rect.left
          const y = cy - rect.top
          const w = rect.width
          const h = rect.height
          const edge = Math.min(Math.min(w, h) * 0.25, 40)
          let position: string
          if (x < edge) position = 'left'
          else if (x > w - edge) position = 'right'
          else if (y < edge) position = 'top'
          else if (y > h - edge) position = 'bottom'
          else position = 'center'
          const leafId = pane.dataset.leafId || ''
          pane.dispatchEvent(
            new CustomEvent('file-drop', { detail: { leafId, rel, position }, bubbles: true })
          )
        }
      }
      return
    }
    if (!_activeUploadFn) return
    const payload = event.payload || []
    const paths: string[] = Array.isArray(payload) ? payload : (payload.paths || [])
    if (!paths.length) return
    const files: { file: File; path: string }[] = []
    for (const p of paths) {
      try {
        const b64: string = (await tauriInvoke('tauri_read_file', { path: p })) as string
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

  // Listen for drag-enter/leave to show drop overlay
  const unlistenActive = listen('file-drop-active', (event: any) => {
    if (isInternalDragActive()) return // ignore native events for internal tree drags
    if (!_dragCounterRef) return
    _dragCounterRef.value = event.payload ? 1 : 0
  })

  const unlistens: Promise<void>[] = []
  if (unlistenDrop && typeof unlistenDrop.then === 'function') {
    unlistens.push(unlistenDrop.then((fn: () => void) => { _tauriUnlisten = fn }))
  }
  if (unlistenActive && typeof unlistenActive.then === 'function') {
    unlistens.push(unlistenActive.then((fn: () => void) => {
      // chain with existing unlisten
      const prev = _tauriUnlisten
      _tauriUnlisten = () => { prev?.(); fn() }
    }))
  }
}

function teardownWorkspaceDragDrop() {
  if (_tauriUnlisten) {
    _tauriUnlisten()
    _tauriUnlisten = null
  }
  // Allow re-registration on next mount (orphaned listener is safe —
  // callback guards on _activeUploadFn which is cleared by clearActiveWorkspace)
  tauriFileDropRegistered = false
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
    if (opts.cwdLabel.value) q.set('cwd', opts.cwdLabel.value)
    // Browser: same-origin requests include cookies automatically.
    // Tauri: need token in URL for tauri_fetch or direct image loads.
    if (isTauri()) {
      const token = getAuthToken()
      if (token) q.set('token', token)
    }
    if (cacheBustTs.value) q.set('_t', String(cacheBustTs.value))
    return apiUrl(`/api/workspace/raw?${q}`)
  })

  const canDownload = computed(
    () =>
      !!opts.selectedRel.value &&
      !opts.selectedIsDir.value &&
      opts.meta.value?.kind !== 'unsupported'
  )

  function parentRelPath(rel: string): string {
    const i = rel.lastIndexOf('/')
    return i === -1 ? '' : rel.slice(0, i)
  }

  function absolutePath(rel: string): string {
    // SSH mode: cwdLabel starts with '/' and changes as user navigates, but
    // tree rel paths are always relative to the initial root '/', so rel IS
    // the path from root — just prefix with '/'.
    // Local mode: cwdLabel is the stable PTY cwd (e.g. /Users/me/project),
    // and rel is relative to it, so join them.
    if (opts.cwdLabel.value.startsWith('/')) {
      return rel ? `/${rel}` : opts.cwdLabel.value.replace(/\/+$/, '') || '/'
    }
    const root = opts.cwdLabel.value.replace(/\/+$/, '')
    return rel ? `${root}/${rel}` : root
  }

  function triggerUpload() {
    fileInputRef.value?.click()
  }

  async function uploadFiles(files: { file: File; path: string }[], targetDir?: string) {
    if (!files.length) return
    await getApiBase()
    const dir =
      targetDir !== undefined
        ? targetDir
        : opts.selectedIsDir.value && opts.selectedRel.value
          ? opts.selectedRel.value
          : ''
    try {
      if (isTauri()) {
        const token = getAuthToken()
        const encoded = await Promise.all(
          files.map(async ({ file, path }) => ({
            name: file.name,
            path,
            data: await fileToBase64(file),
          }))
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
        if (opts.cwdLabel.value) q.set('cwd', opts.cwdLabel.value)
        const fd = new FormData()
        for (const { file, path } of files) {
          fd.append('path', path)
          fd.append('file', file)
        }
        const res = await authFetch(apiUrl(`/api/workspace/upload?${q}`), {
          method: 'POST',
          body: fd,
        })
        if (!res.ok) console.error('[upload] server error:', res.status)
      }
    } catch (e) {
      console.error('[upload] request failed:', e)
    }
    const next = { ...opts.childCache.value }
    delete next[dir]
    opts.childCache.value = next
    try {
      await opts.ensureChildren(dir)
    } catch {}
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
    try {
      await uploadFiles(files)
    } catch (e) {
      console.error('[upload]', e)
    }
  }

  async function traverseEntry(
    entry: FileSystemEntry,
    basePath: string
  ): Promise<{ file: File; path: string }[]> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry
      try {
        const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject))
        return [{ file, path: basePath + entry.name }]
      } catch {
        return []
      }
    }
    if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry
      const reader = dirEntry.createReader()
      const entries: FileSystemEntry[] = []
      try {
        let batch: FileSystemEntry[]
        do {
          batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject)
          )
          entries.push(...batch)
        } while (batch.length > 0)
      } catch {
        return []
      }
      const results: { file: File; path: string }[] = []
      const childResults = await Promise.all(
        entries.map((child) => traverseEntry(child, basePath + entry.name + '/'))
      )
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
      if (entry)
        promises.push(
          traverseEntry(entry, '').then((files) => {
            allFiles.push(...files)
          })
        )
    }
    try {
      await Promise.all(promises)
    } catch {}
    if (!allFiles.length) return
    await uploadFiles(allFiles)
  }

  async function downloadFile(rel: string) {
    if (!rel) return
    await getApiBase()
    const name = rel.split('/').pop() || 'file'
    const q = new URLSearchParams({ pane_id: opts.paneId(), path: rel })
    if (opts.cwdLabel.value) q.set('cwd', opts.cwdLabel.value)
    const url = apiUrl(`/api/workspace/raw?${q}`)
    if (isTauri()) {
      const token = getAuthToken()
      const headers: [string, string][] = []
      if (token) headers.push(['Authorization', `Bearer ${token}`])
      try {
        await tauriInvoke('tauri_download', { url, filename: name, headers })
      } catch {}
      return
    }
    const res = await authFetch(url)
    if (!res.ok) return
    const blob = await res.blob()
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
    resetState: () => void
  ): Promise<boolean> {
    const rel = opts.selectedRel.value
    if (!rel) return false
    opts.inlineCreate.value = null
    const wasDir = opts.selectedIsDir.value
    const msg = wasDir ? t('filePreview.confirmDeleteFolder') : t('filePreview.confirmDeleteFile')
    if (!skipConfirm && !(await uiConfirm(msg, {
      title: t('filePreview.delete'),
      confirmText: t('filePreview.delete'),
      cancelText: t('filePreview.cancel'),
    }))) return false
    await getApiBase()
    const q = new URLSearchParams({ pane_id: opts.paneId(), path: rel })
    if (opts.cwdLabel.value) q.set('cwd', opts.cwdLabel.value)
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
    try {
      await opts.ensureChildren(parentRel)
    } catch {}
    return true
  }

  // --- Tauri native drag-drop wiring ---
  if (isTauri()) setupTauriFileDrop()

  function setActiveWorkspace() {
    _activeUploadFn = uploadFiles
    _dragCounterRef = dragCounter
  }
  function clearActiveWorkspace() {
    if (_activeUploadFn === uploadFiles) _activeUploadFn = null
    if (_dragCounterRef === dragCounter) _dragCounterRef = null
  }

  function setHoveredDir(dir: string | undefined) {
    _hoveredDir = dir
  }
  function clearHoveredDir() {
    _hoveredDir = undefined
  }

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
    teardownWorkspaceDragDrop,
  }
}

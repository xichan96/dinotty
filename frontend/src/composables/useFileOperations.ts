import { ref, computed, type Ref } from 'vue'
import { getApiBase, apiUrl, authFetch, getAuthToken } from './apiBase'
import { uiConfirm } from './useConfirm'
import { isTauri, tauriInvoke } from './useTransport'
import { settings } from './useSettings'
import type { DirEntry } from '../components/workspace/TreeRows'

interface ParsedUploadBody {
  saved?: string[]
  errors?: string[]
  error?: string
}

function parseUploadBody(body: string): ParsedUploadBody {
  try {
    return JSON.parse(body) as ParsedUploadBody
  } catch {
    return {}
  }
}

function formatBytes(bytes: number): string {
  const MB = 1024 * 1024
  const GB = 1024 * MB
  if (bytes >= GB) return `${Math.round((bytes / GB) * 10) / 10} GB`
  if (bytes >= MB) return `${Math.round((bytes / MB) * 10) / 10} MB`
  return `${Math.round(bytes / 1024)} KB`
}

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
  t: (key: string, params?: Record<string, string | number>) => string
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
    const capMb = settings.upload_file_cap_mb
    const capBytes = capMb > 0 ? capMb * 1024 * 1024 : 0
    if (capBytes > 0) {
      const oversized = files.filter(({ file }) => file.size > capBytes)
      if (oversized.length) {
        const skip = await uiConfirm(
          opts.t('fileOps.uploadTooLargeMany', {
            count: oversized.length,
            size: formatBytes(capBytes),
          }),
          {
            title: opts.t('fileOps.uploadTooLargeTitle'),
            confirmText: opts.t('fileOps.uploadSkip'),
            cancelText: opts.t('fileOps.uploadCancel'),
          }
        )
        if (!skip) return
        files = files.filter(({ file }) => file.size <= capBytes)
        if (!files.length) return
      }
    }
    const alertUploadError = (status: number, body: string) => {
      const detail = parseUploadBody(body).error
      if (status === 413 && detail) {
        alert(opts.t('fileOps.uploadRejected', { detail }))
      } else if (status === 413) {
        alert(
          opts.t('fileOps.uploadRejected', {
            detail: opts.t('fileOps.uploadTooLargeDetail', { size: formatBytes(capBytes) }),
          })
        )
      } else {
        alert(`Upload failed: HTTP ${status}\n${body}`)
      }
    }
    await getApiBase()
    const dir =
      targetDir !== undefined
        ? targetDir
        : opts.selectedIsDir.value && opts.selectedRel.value
          ? opts.selectedRel.value
          : ''
    let hadErrors = false
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
          cwd: opts.cwdLabel.value || undefined,
          token: token || undefined,
        })) as { status: number; body: string }
        if (resp.status >= 400) {
          console.error('[upload] server error:', resp.status, resp.body)
          alertUploadError(resp.status, resp.body)
          hadErrors = true
        } else {
          const parsed = parseUploadBody(resp.body)
          if (parsed.errors?.length) {
            console.error('[upload] server errors:', parsed.errors)
            alert(`Upload failed:\n${parsed.errors.join('\n')}`)
            hadErrors = true
          }
        }
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
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          console.error('[upload] server error:', res.status, body)
          alertUploadError(res.status, body)
          hadErrors = true
        } else {
          const parsed = await res.json().catch(() => null) as ParsedUploadBody | null
          if (parsed?.errors?.length) {
            console.error('[upload] server errors:', parsed.errors)
            alert(`Upload failed:\n${parsed.errors.join('\n')}`)
            hadErrors = true
          }
        }
      }
    } catch (e) {
      console.error('[upload] request failed:', e)
      alert(`Upload failed: ${e}`)
      hadErrors = true
    }
    if (hadErrors) return
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
      } catch (e) {
        console.error('[download] tauri_download failed:', url, e)
        alert(`Download failed: ${e}`)
      }
      return
    }
    const res = await authFetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[download] server error:', res.status, url, body)
      alert(`Download failed: HTTP ${res.status}\n${body}`)
      return
    }
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

  // --- Workspace drag-drop wiring ---
  // With `dragDropEnabled: false` in tauri.conf.json, HTML5 drag/drop events
  // fire directly on the DOM. These are retained as no-ops for lifecycle
  // callers; the actual upload path is onDrop / onUploadToDir.
  function setActiveWorkspace() {}
  function clearActiveWorkspace() {}
  function setHoveredDir(_dir: string | undefined) {}
  function clearHoveredDir() {}
  function teardownWorkspaceDragDrop() {}

  function onWorkspaceDragEnter() {
    dragCounter.value++
  }
  function onWorkspaceDragLeave() {
    dragCounter.value = Math.max(0, dragCounter.value - 1)
  }
  function onWorkspaceDrop(ev: DragEvent) {
    dragCounter.value = 0
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

import { ref, computed, nextTick, type Ref } from 'vue'
import { copyToClipboard } from '../utils/clipboard'
import type { DirEntry } from '../components/workspace/TreeRows'

interface Meta {
  kind: string
  content?: string
  language?: string
  truncated?: boolean
  message?: string
}

export function useTreeContextMenu(opts: {
  selectedRel: Ref<string | null>
  selectedIsDir: Ref<boolean>
  meta: Ref<Meta | null>
  editorDirty: Ref<boolean>
  editorText: Ref<string>
  editorBaseline: Ref<string>
  childCache: Ref<Record<string, DirEntry[]>>
  expanded: Ref<Set<string>>
  inlineCreate: Ref<{ parentRel: string; kind: 'file' | 'dir' } | null>
  inlineRename: Ref<{ rel: string; isDir: boolean } | null>
  narrow: Ref<boolean>
  absolutePath: (rel: string) => string
  parentRelPath: (rel: string) => string
  ensureChildren: (rel: string) => Promise<void>
  deleteSelected: (skipConfirm: boolean, t: (key: string) => string, resetState: () => void) => Promise<boolean>
  onSelectFile: (rel: string) => Promise<void>
  onSelectDir: (rel: string) => void
  triggerUpload: () => void
  downloadFile: (rel: string) => Promise<void>
  t: (key: string) => string
}) {
  const contextMenu = ref<{ x: number; y: number; rel: string; isDir: boolean } | null>(null)
  const addMenuOpen = ref(false)
  const moveConfirm = ref<{ src: string; destDir: string } | null>(null)

  const ctxDeleteKeyHint = computed(() =>
    typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? '⌘⌫' : 'Del',
  )

  const contextMenuStyle = computed(() => {
    const m = contextMenu.value
    if (!m) return {}
    if (opts.narrow.value) return { left: '0', right: '0', bottom: '0' }
    const pad = 8
    const mw = 220
    const mh = 300
    let left = m.x
    let top = m.y
    if (typeof window !== 'undefined') {
      if (left + mw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - mw - pad)
      if (top + mh > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - mh - pad)
    }
    return { left: `${left}px`, top: `${top}px` }
  })

  function closeContextMenu() { contextMenu.value = null }

  function shouldBlockNavigate(): boolean {
    if (!opts.editorDirty.value || !opts.meta.value || (opts.meta.value.kind !== 'text' && opts.meta.value.kind !== 'markdown')) return false
    return !confirm(opts.t('filePreview.discardChanges'))
  }

  function onTreeContextMenu(payload: { ev: MouseEvent; rel: string; isDir: boolean }) {
    payload.ev.preventDefault()
    contextMenu.value = { x: payload.ev.clientX, y: payload.ev.clientY, rel: payload.rel, isDir: payload.isDir }
  }

  function onTreeBgContextMenu(ev: MouseEvent) {
    ev.preventDefault()
    contextMenu.value = { x: ev.clientX, y: ev.clientY, rel: '', isDir: true }
  }

  function onTreeLongPress(pos: { clientX: number; clientY: number }, rel: string, isDir: boolean) {
    contextMenu.value = { x: pos.clientX, y: pos.clientY, rel, isDir }
  }

  function ctxNewFile() {
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    if (shouldBlockNavigate()) return
    const parentRel = isDir ? rel : opts.parentRelPath(rel)
    opts.inlineCreate.value = { parentRel, kind: 'file' }
    opts.expanded.value = new Set([...opts.expanded.value, parentRel])
    void opts.ensureChildren(parentRel)
  }

  function ctxNewFolder() {
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    if (shouldBlockNavigate()) return
    const parentRel = isDir ? rel : opts.parentRelPath(rel)
    opts.inlineCreate.value = { parentRel, kind: 'dir' }
    opts.expanded.value = new Set([...opts.expanded.value, parentRel])
    void opts.ensureChildren(parentRel)
  }

  function ctxRename() {
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    const targetRel = rel || opts.selectedRel.value
    if (!targetRel) return
    const targetIsDir = rel ? isDir : opts.selectedIsDir.value
    opts.inlineRename.value = { rel: targetRel, isDir: targetIsDir }
  }

  async function ctxDelete() {
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    const targetRel = rel || opts.selectedRel.value
    const targetIsDir = rel ? isDir : opts.selectedIsDir.value
    if (!targetRel) return
    const discardNeeded = opts.editorDirty.value && opts.meta.value && (opts.meta.value.kind === 'text' || opts.meta.value.kind === 'markdown')
    const prevRel = opts.selectedRel.value
    const prevIsDir = opts.selectedIsDir.value
    const prevMeta = opts.meta.value
    const deleteMsg = targetIsDir ? opts.t('filePreview.confirmDeleteFolder') : opts.t('filePreview.confirmDeleteFile')
    if (discardNeeded) {
      if (!confirm(`${opts.t('filePreview.discardChanges')}\n\n${deleteMsg}`)) return
      opts.editorText.value = opts.editorBaseline.value
    }
    opts.selectedRel.value = targetRel
    opts.selectedIsDir.value = targetIsDir
    opts.meta.value = null
    const resetState = () => {
      opts.selectedRel.value = null
      opts.selectedIsDir.value = false
      opts.meta.value = null
    }
    const ok = await opts.deleteSelected(discardNeeded ?? false, opts.t, resetState)
    if (!ok) {
      opts.selectedRel.value = prevRel
      opts.selectedIsDir.value = prevIsDir
      opts.meta.value = prevMeta
    }
  }

  function ctxUpload() {
    closeContextMenu()
    nextTick(() => opts.triggerUpload())
  }

  async function ctxDownload() {
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    if (isDir) return
    const targetRel = rel || opts.selectedRel.value
    if (!targetRel) return
    await opts.downloadFile(targetRel)
  }

  function ctxCopyPath() {
    if (!contextMenu.value) return
    const { rel } = contextMenu.value
    closeContextMenu()
    const targetRel = rel || opts.selectedRel.value
    if (!targetRel) return
    void copyToClipboard(opts.absolutePath(targetRel))
  }

  function ctxInsertToTerminal() {
    if (!contextMenu.value) return
    const { rel } = contextMenu.value
    closeContextMenu()
    const targetRel = rel || opts.selectedRel.value
    if (!targetRel) return
    window.dispatchEvent(new CustomEvent('terminal-insert-path', {
      detail: { path: opts.absolutePath(targetRel) },
    }))
  }

  function onMoveEntry(payload: { src: string; destDir: string }) {
    const { src, destDir } = payload
    if (!src) return
    const srcParent = opts.parentRelPath(src)
    if (srcParent === destDir) return
    moveConfirm.value = { src, destDir }
  }

  async function executeMove() {
    const info = moveConfirm.value
    if (!info) return
    moveConfirm.value = null
    const { src, destDir } = info
    const srcParent = opts.parentRelPath(src)
    const { getApiBase, apiUrl, authFetch } = await import('./apiBase')
    await getApiBase()
    const q = new URLSearchParams({ path: src })
    const res = await authFetch(apiUrl(`/api/workspace/move?${q}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dest: destDir }),
    })
    if (!res.ok) return
    const next = { ...opts.childCache.value }
    delete next[srcParent]
    delete next[destDir]
    for (const k of Object.keys(next)) {
      if (k === src || k.startsWith(`${src}/`)) delete next[k]
    }
    opts.childCache.value = next
    try { await Promise.all([opts.ensureChildren(srcParent), opts.ensureChildren(destDir)]) } catch {}
  }

  function onMoveConfirm() { executeMove() }
  function onMoveCancel() { moveConfirm.value = null }

  function onCloseContextScroll() {
    if (contextMenu.value) contextMenu.value = null
  }

  return {
    contextMenu,
    addMenuOpen,
    moveConfirm,
    ctxDeleteKeyHint,
    contextMenuStyle,
    closeContextMenu,
    shouldBlockNavigate,
    onTreeContextMenu,
    onTreeBgContextMenu,
    onTreeLongPress,
    ctxNewFile,
    ctxNewFolder,
    ctxRename,
    ctxDelete,
    ctxUpload,
    ctxDownload,
    ctxCopyPath,
    ctxInsertToTerminal,
    onMoveEntry,
    onMoveConfirm,
    onMoveCancel,
    onCloseContextScroll,
  }
}

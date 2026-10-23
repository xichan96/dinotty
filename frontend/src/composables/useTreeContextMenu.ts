import { ref, computed, nextTick, type Ref } from 'vue'
import { copyToClipboard } from '../utils/clipboard'
import { uiConfirm } from './useConfirm'
import type { DirEntry } from '../components/workspace/TreeRows'
import { isRunnableCodeFile } from '../utils/runCodeCommand'
import { tauriInvoke } from './useTransport'

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
  inlineCreate: Ref<{ parentRel: string; kind: 'file' | 'dir'; value?: string; error?: string } | null>
  inlineRename: Ref<{ rel: string; isDir: boolean; value?: string; error?: string } | null>
  narrow: Ref<boolean>
  /** Remote (SSH) panes have no local file manager to reveal into. */
  isSsh?: Ref<boolean>
  absolutePath: (rel: string) => string
  parentRelPath: (rel: string) => string
  ensureChildren: (rel: string) => Promise<void>
  deleteSelected: (
    skipConfirm: boolean,
    t: (key: string) => string,
    resetState: () => void
  ) => Promise<boolean>
  onSelectFile: (rel: string) => Promise<void>
  onSelectDir: (rel: string) => void
  triggerUpload: () => void
  downloadFile: (rel: string) => Promise<void>
  paneId: () => string
  t: (key: string) => string
}) {
  const contextMenu = ref<{ x: number; y: number; rel: string; isDir: boolean } | null>(null)
  const moveConfirm = ref<{ src: string; destDir: string } | null>(null)
  const deleteConfirm = ref<{ rel: string; isDir: boolean; discardNeeded: boolean } | null>(null)

  /** SSH has no local file manager: hide actions that would operate on the
   *  server host (the backend would answer 400). */
  const isRemote = computed(() => opts.isSsh?.value ?? false)

  const canRunCode = computed(function computeCanRunCode() {
    // 步骤1：读取当前右键目标，背景菜单则使用已选文件。
    const menu = contextMenu.value
    if (!menu) return false
    const targetRel = menu.rel || opts.selectedRel.value
    const targetIsDir = menu.rel ? menu.isDir : opts.selectedIsDir.value

    // 步骤2：仅对可直接运行的文件显示入口。
    if (!targetRel || targetIsDir) return false
    return isRunnableCodeFile(targetRel)
  })

  const contextMenuStyle = computed(() => {
    const m = contextMenu.value
    if (!m) return {}
    if (opts.narrow.value) return { left: '0', right: '0', bottom: '0' }
    const pad = 8
    const mw = 220
    const mh = 400
    let left = m.x
    let top = m.y
    if (typeof window !== 'undefined') {
      if (left + mw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - mw - pad)
      if (top + mh > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - mh - pad)
    }
    return { left: `${left}px`, top: `${top}px` }
  })

  function closeContextMenu() {
    contextMenu.value = null
  }

  async function shouldBlockNavigate(): Promise<boolean> {
    if (
      !opts.editorDirty.value ||
      !opts.meta.value ||
      (opts.meta.value.kind !== 'text' && opts.meta.value.kind !== 'markdown')
    )
      return false
    return !(await uiConfirm(opts.t('filePreview.discardChanges'), {
      confirmText: opts.t('filePreview.discardChanges'),
      cancelText: opts.t('filePreview.cancel'),
    }))
  }

  function onTreeContextMenu(payload: { ev: MouseEvent; rel: string; isDir: boolean }) {
    payload.ev.preventDefault()
    contextMenu.value = {
      x: payload.ev.clientX,
      y: payload.ev.clientY,
      rel: payload.rel,
      isDir: payload.isDir,
    }
  }

  function onTreeBgContextMenu(ev: MouseEvent) {
    ev.preventDefault()
    contextMenu.value = { x: ev.clientX, y: ev.clientY, rel: '', isDir: true }
  }

  function onTreeLongPress(pos: { clientX: number; clientY: number }, rel: string, isDir: boolean) {
    contextMenu.value = { x: pos.clientX, y: pos.clientY, rel, isDir }
  }

  async function ctxNewFile() {
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    if (await shouldBlockNavigate()) return
    const parentRel = isDir ? rel : opts.parentRelPath(rel)
    opts.inlineCreate.value = { parentRel, kind: 'file', value: '', error: '' }
    opts.expanded.value = new Set([...opts.expanded.value, parentRel])
    void opts.ensureChildren(parentRel)
  }

  async function ctxNewFolder() {
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    if (await shouldBlockNavigate()) return
    const parentRel = isDir ? rel : opts.parentRelPath(rel)
    opts.inlineCreate.value = { parentRel, kind: 'dir', value: '', error: '' }
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
    opts.inlineRename.value = {
      rel: targetRel,
      isDir: targetIsDir,
      value: targetRel.split('/').pop() || targetRel,
      error: '',
    }
  }

  function ctxDelete() {
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    const targetRel = rel || opts.selectedRel.value
    const targetIsDir = rel ? isDir : opts.selectedIsDir.value
    if (!targetRel) return
    const discardNeeded = !!(
      opts.editorDirty.value &&
      opts.meta.value &&
      (opts.meta.value.kind === 'text' || opts.meta.value.kind === 'markdown')
    )
    deleteConfirm.value = { rel: targetRel, isDir: targetIsDir, discardNeeded }
  }

  async function executeDelete() {
    const info = deleteConfirm.value
    if (!info) return
    deleteConfirm.value = null
    const { rel, isDir, discardNeeded } = info
    const prevRel = opts.selectedRel.value
    const prevIsDir = opts.selectedIsDir.value
    const prevMeta = opts.meta.value
    if (discardNeeded) opts.editorText.value = opts.editorBaseline.value
    opts.selectedRel.value = rel
    opts.selectedIsDir.value = isDir
    opts.meta.value = null
    const resetState = () => {
      opts.selectedRel.value = null
      opts.selectedIsDir.value = false
      opts.meta.value = null
    }
    const ok = await opts.deleteSelected(true, opts.t, resetState)
    if (!ok) {
      opts.selectedRel.value = prevRel
      opts.selectedIsDir.value = prevIsDir
      opts.meta.value = prevMeta
    }
  }

  function cancelDelete() {
    deleteConfirm.value = null
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

  async function ctxReveal() {
    if (!contextMenu.value || isRemote.value) return
    const { rel } = contextMenu.value
    closeContextMenu()
    const targetRel = rel || opts.selectedRel.value
    if (!targetRel) return
    const { getApiBase, apiUrl, authFetch } = await import('./apiBase')
    await getApiBase()
    const q = new URLSearchParams({ pane_id: opts.paneId(), path: targetRel })
    await authFetch(apiUrl(`/api/workspace/reveal?${q}`), { method: 'GET' })
  }

  /** Desktop-only: open the target's folder in the OS file manager. A
   *  directory opens itself; a file is revealed selected in its parent —
   *  matching VSCode's reveal behaviour. Uses the local `reveal_path` command
   *  rather than the workspace HTTP endpoint, so it stays on the desktop
   *  machine (the endpoint would open the file manager on the server host). */
  async function ctxOpenFolder() {
    if (!contextMenu.value || isRemote.value) return
    const { rel } = contextMenu.value
    closeContextMenu()
    const targetRel = rel || opts.selectedRel.value
    if (!targetRel) return
    const abs = opts.absolutePath(targetRel)
    if (!abs) return
    try {
      await tauriInvoke('reveal_path', { path: abs })
    } catch (err) {
      console.warn('[tree] open folder failed:', err)
    }
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
    window.dispatchEvent(
      new CustomEvent('terminal-insert-path', {
        detail: { path: opts.absolutePath(targetRel) },
      })
    )
  }

  function ctxRunCode() {
    // 步骤1：读取右键文件并立即关闭菜单。
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    const targetRel = rel || opts.selectedRel.value
    const targetIsDir = rel ? isDir : opts.selectedIsDir.value

    // 步骤2：仅发送支持运行的文件绝对路径。
    if (!targetRel || targetIsDir || !isRunnableCodeFile(targetRel)) return
    window.dispatchEvent(
      new CustomEvent('terminal-run-code', {
        detail: { path: opts.absolutePath(targetRel) },
      })
    )
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
    try {
      await Promise.all([opts.ensureChildren(srcParent), opts.ensureChildren(destDir)])
    } catch {}
  }

  function onMoveConfirm() {
    executeMove()
  }
  function onMoveCancel() {
    moveConfirm.value = null
  }

  function onCloseContextScroll() {
    if (contextMenu.value) contextMenu.value = null
  }

  return {
    contextMenu,
    moveConfirm,
    deleteConfirm,
    isRemote,
    canRunCode,
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
    executeDelete,
    cancelDelete,
    ctxUpload,
    ctxDownload,
    ctxCopyPath,
    ctxOpenFolder,
    ctxInsertToTerminal,
    ctxRunCode,
    ctxReveal,
    onMoveEntry,
    onMoveConfirm,
    onMoveCancel,
    onCloseContextScroll,
  }
}

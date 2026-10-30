import { ref, computed, nextTick, type Ref } from 'vue'
import { copyToClipboard } from '../utils/clipboard'
import { uiConfirm } from './useConfirm'
import type { DirEntry } from '../components/workspace/TreeRows'
import { isRunnableCodeFile } from '../utils/runCodeCommand'
import { tauriInvoke } from './useTransport'
import { asWorkspaceError, workspaceErrorFromResponse } from './useFileWorkspaceBoot'

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
  /** Return focus to the menu's target row after Escape (keyboard a11y). */
  onMenuClosed?: (rel: string) => void
}) {
  const contextMenu = ref<{ x: number; y: number; rel: string; isDir: boolean } | null>(null)
  /** Menu element, bound by the view, so placement uses the real rendered size
   *  instead of a guessed one and keyboard nav can reach its items. */
  const menuEl = ref<HTMLElement | null>(null)
  const menuSize = ref<{ width: number; height: number } | null>(null)
  /** Target of the open menu, used to hand focus back to its row on Escape. */
  let lastMenuRel = ''
  const moveConfirm = ref<{ src: string; destDir: string } | null>(null)
  /** Entry the "Move to…" dialog is picking a destination for. */
  const moveSource = ref<{ rel: string; isDir: boolean } | null>(null)
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
    // Before the first measurement there is nothing to clamp against; render
    // at the pointer position for one frame, then clamp with the real size.
    const mw = menuSize.value?.width ?? 0
    const mh = menuSize.value?.height ?? 0
    let left = m.x
    let top = m.y
    if (typeof window !== 'undefined') {
      if (mw && left + mw > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - mw - pad)
      }
      if (mh && top + mh > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - mh - pad)
      }
    }
    return { left: `${left}px`, top: `${top}px` }
  })

  function setMenuEl(el: unknown) {
    menuEl.value = el instanceof HTMLElement ? el : null
  }

  function enabledMenuItems(): HTMLElement[] {
    const el = menuEl.value
    if (!el) return []
    return Array.from(el.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))
  }

  /** Open at the pointer, then measure the rendered menu, clamp it into the
   *  viewport and hand keyboard focus to the first available action. */
  function showMenu(x: number, y: number, rel: string, isDir: boolean) {
    contextMenu.value = { x, y, rel, isDir }
    lastMenuRel = rel
    menuSize.value = null
    void nextTick(() => {
      if (!contextMenu.value) return
      const el = menuEl.value
      if (el) {
        const rect = el.getBoundingClientRect()
        menuSize.value = { width: rect.width, height: rect.height }
      }
      enabledMenuItems()[0]?.focus()
    })
  }

  function onMenuKeydown(ev: KeyboardEvent) {
    if (!contextMenu.value) return
    const items = enabledMenuItems()
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault()
        items[current < 0 ? 0 : (current + 1) % items.length].focus()
        break
      case 'ArrowUp':
        ev.preventDefault()
        items[current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length].focus()
        break
      case 'Home':
        ev.preventDefault()
        items[0].focus()
        break
      case 'End':
        ev.preventDefault()
        items[items.length - 1].focus()
        break
      case 'Escape':
        ev.preventDefault()
        closeContextMenuAndRestoreFocus()
        break
    }
  }

  function closeContextMenu() {
    contextMenu.value = null
    menuSize.value = null
  }

  /** Escape from a keyboard-opened menu should return to the row it opened
   *  from, not drop focus on <body>. Outside clicks deliberately do not. */
  function closeContextMenuAndRestoreFocus() {
    const rel = lastMenuRel
    closeContextMenu()
    if (rel) opts.onMenuClosed?.(rel)
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

  /** Open the menu for an explicit target and position. Pointer and keyboard
   *  entry points share it so both get the same clamping/focus behaviour. */
  function openMenuAt(rel: string, isDir: boolean, x: number, y: number) {
    showMenu(x, y, rel, isDir)
  }

  function onTreeContextMenu(payload: { ev: MouseEvent; rel: string; isDir: boolean }) {
    payload.ev.preventDefault()
    openMenuAt(payload.rel, payload.isDir, payload.ev.clientX, payload.ev.clientY)
  }

  function onTreeBgContextMenu(ev: MouseEvent) {
    ev.preventDefault()
    showMenu(ev.clientX, ev.clientY, '', true)
  }

  function onTreeLongPress(pos: { clientX: number; clientY: number }, rel: string, isDir: boolean) {
    showMenu(pos.clientX, pos.clientY, rel, isDir)
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

  /** Open the destination picker for the menu target (or the selection when
   *  the menu was opened on blank space). */
  function ctxMove() {
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    const targetRel = rel || opts.selectedRel.value
    if (!targetRel) return
    const targetIsDir = rel ? isDir : opts.selectedIsDir.value
    moveSource.value = { rel: targetRel, isDir: targetIsDir }
  }

  function closeMoveTo() {
    moveSource.value = null
  }

  /** Ask for confirmation before deleting a known target. The keyboard
   *  shortcut calls this directly — it must not depend on an open menu. */
  function requestDelete(rel: string, isDir: boolean) {
    if (!rel) return
    closeContextMenu()
    const discardNeeded = !!(
      opts.editorDirty.value &&
      opts.meta.value &&
      (opts.meta.value.kind === 'text' || opts.meta.value.kind === 'markdown')
    )
    deleteConfirm.value = { rel, isDir, discardNeeded }
  }

  function ctxDelete() {
    if (!contextMenu.value) return
    const { rel, isDir } = contextMenu.value
    closeContextMenu()
    const targetRel = rel || opts.selectedRel.value
    const targetIsDir = rel ? isDir : opts.selectedIsDir.value
    if (!targetRel) return
    requestDelete(targetRel, targetIsDir)
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

  /** Move one entry into `destDir` (a workspace-relative directory, '' = root).
   *  Resolves true when the move ran; a same-parent target is a no-op that
   *  resolves false. API failures throw a WorkspaceError so callers can show
   *  the localized reason. */
  async function moveTo(src: string, destDir: string): Promise<boolean> {
    if (!src) return false
    const srcParent = opts.parentRelPath(src)
    if (srcParent === destDir) return false
    const { getApiBase, apiUrl, authFetch } = await import('./apiBase')
    await getApiBase()
    // `pane_id` selects the SSH session; local panes still require the param.
    const q = new URLSearchParams({ pane_id: opts.paneId(), path: src })
    let res: Response
    try {
      res = await authFetch(apiUrl(`/api/workspace/move?${q}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dest: destDir }),
      })
    } catch (e) {
      throw asWorkspaceError(e)
    }
    if (!res.ok) throw await workspaceErrorFromResponse(res)
    // Both listings are stale now; drop them (plus anything cached under the
    // moved directory) and reload only what the tree is actually showing.
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
    return true
  }

  async function executeMove() {
    const info = moveConfirm.value
    if (!info) return
    moveConfirm.value = null
    try {
      await moveTo(info.src, info.destDir)
    } catch {
      // The drag-and-drop confirm dialog has no error surface; the tree's
      // error bar already reports the next listing failure.
    }
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
    moveSource,
    deleteConfirm,
    isRemote,
    canRunCode,
    contextMenuStyle,
    setMenuEl,
    onMenuKeydown,
    closeContextMenu,
    shouldBlockNavigate,
    openMenuAt,
    requestDelete,
    onTreeContextMenu,
    onTreeBgContextMenu,
    onTreeLongPress,
    ctxNewFile,
    ctxNewFolder,
    ctxRename,
    ctxMove,
    closeMoveTo,
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
    moveTo,
    onCloseContextScroll,
  }
}

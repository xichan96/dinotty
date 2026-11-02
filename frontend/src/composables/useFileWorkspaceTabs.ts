import { getCurrentInstance, onBeforeUnmount, type Ref } from 'vue'
import { getAllEditorLeaves } from '../types/editorPane'
import { syncLeafActive, type EditorTab } from '../types/editorTabs'
import type { DropPosition } from '../types/pane'
import { getEditorPaneState } from './useEditorRegistry'
import type { useEditorSplit } from './useEditorSplit'
import type { TabBufferStore } from './useTabBufferStore'
import type { FileNavigation } from './useFileNavigation'
import { copyToClipboard } from '../utils/clipboard'
import { uiConfirm } from './useConfirm'

type Translate = (key: string, params?: Record<string, string | number>) => string

export interface UseFileWorkspaceTabsOptions {
  split: ReturnType<typeof useEditorSplit>
  buffers: TabBufferStore
  nav: FileNavigation
  selectedRel: Ref<string | null>
  selectedIsDir: Ref<boolean>
  globalSelectedPath: Ref<string | null>
  absolutePath: (rel: string) => string
  emitNavigate: (absPath: string) => void
  recordRecent: (absPath: string, name: string) => void
  closeDrawer: () => void
  isNarrow: () => boolean
  t: Translate
  /** Coalesced after file-watch bursts so one checkout runs one git status. */
  onGitChange: () => void
}

/**
 * File selection and editor-tab operations for the workspace preview.
 *
 * Files opened from the explorer are pinned tabs: clicking five files leaves
 * five tabs. The tab model still supports preview tabs (context menu / drag
 * APIs), but single-click browsing must not silently replace the previous tab.
 */
export function useFileWorkspaceTabs(opts: UseFileWorkspaceTabsOptions) {
  let gitRefreshTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleGitRefresh() {
    if (gitRefreshTimer) clearTimeout(gitRefreshTimer)
    gitRefreshTimer = setTimeout(() => {
      gitRefreshTimer = null
      opts.onGitChange()
    }, 400)
  }

  function tabsForPath(
    rel: string,
    isDir: boolean
  ): Array<{ leaf: ReturnType<typeof getAllEditorLeaves>[number]; tab: EditorTab }> {
    const out: Array<{
      leaf: ReturnType<typeof getAllEditorLeaves>[number]
      tab: EditorTab
    }> = []
    for (const leaf of getAllEditorLeaves(opts.split.editorLayout.value)) {
      for (const tab of leaf.tabs) {
        const matches = isDir
          ? tab.filePath === rel || tab.filePath.startsWith(`${rel}/`)
          : tab.filePath === rel
        if (matches) out.push({ leaf, tab })
      }
    }
    return out
  }

  function isPathDirty(rel: string, isDir: boolean): boolean {
    return tabsForPath(rel, isDir).some(({ tab }) => opts.buffers.isDirty(tab))
  }

  /**
   * Keep tabs (and their buffers) alive across a rename/move. The tab id is
   * stable, so unsaved text and undo-worthy state stay attached to the tab.
   */
  function rewriteOpenTabs(oldRel: string, newRel: string) {
    for (const leaf of getAllEditorLeaves(opts.split.editorLayout.value)) {
      let changed = false
      for (const tab of leaf.tabs) {
        if (tab.filePath === oldRel) {
          tab.filePath = newRel
          opts.buffers.remapPath(tab.id, newRel)
          changed = true
        } else if (tab.filePath.startsWith(`${oldRel}/`)) {
          const next = `${newRel}${tab.filePath.slice(oldRel.length)}`
          tab.filePath = next
          opts.buffers.remapPath(tab.id, next)
          changed = true
        }
      }
      if (changed) syncLeafActive(leaf)
    }
  }

  /** Close every tab for a path after a confirmed delete. */
  function closeTabsForPath(rel: string, isDir: boolean) {
    const byLeaf = new Map<string, string[]>()
    for (const { leaf, tab } of tabsForPath(rel, isDir)) {
      const ids = byLeaf.get(leaf.id) ?? []
      ids.push(tab.id)
      byLeaf.set(leaf.id, ids)
    }
    for (const [leafId, ids] of byLeaf) opts.split.closeTabs(leafId, ids)
  }

  function onWatchedFileChanged(rel: string) {
    for (const leaf of getAllEditorLeaves(opts.split.editorLayout.value)) {
      for (const tab of leaf.tabs) {
        if (tab.filePath !== rel) continue
        if (tab.id === leaf.activeTabId) {
          const state = getEditorPaneState(leaf.id)
          if (!state) continue
          if (state.isDirty()) state.markDiskChanged()
          else void state.reloadFromDisk()
        } else {
          const buffer = opts.buffers.get(tab.id, rel)
          if (!buffer) continue
          if (buffer.text !== buffer.baseline) buffer.diskChanged = true
          else opts.buffers.invalidate(tab.id)
        }
      }
    }
    scheduleGitRefresh()
  }

  function onWatchedFileDeleted(rel: string) {
    for (const leaf of getAllEditorLeaves(opts.split.editorLayout.value)) {
      const matched = leaf.tabs.filter(
        (tab) => tab.filePath === rel || tab.filePath.startsWith(`${rel}/`)
      )
      // Dirty tabs survive: an external rm/checkout must not silently discard
      // unsaved text. They keep showing their buffer and the disk-changed badge.
      const removable = matched.filter((tab) => !opts.buffers.isDirty(tab))
      for (const tab of matched) {
        if (!removable.includes(tab)) {
          if (tab.id === leaf.activeTabId) {
            getEditorPaneState(leaf.id)?.markDiskChanged()
          } else {
            opts.buffers.markDiskChanged(tab.id)
          }
        }
      }
      const removed = removable.map((tab) => tab.id)
      if (removed.length) opts.split.closeTabs(leaf.id, removed)
    }
    scheduleGitRefresh()
  }

  function onActivateTab(leafId: string, tabId: string) {
    if (!opts.split.activateTab(leafId, tabId)) return
    const path = opts.split.activeTab.value?.filePath
    if (!path) return
    opts.selectedRel.value = path
    opts.selectedIsDir.value = false
    opts.nav.pushNav(path, false)
    const abs = opts.absolutePath(path)
    opts.globalSelectedPath.value = abs
    opts.emitNavigate(abs)
  }

  function onCloseTab(leafId: string, tabId: string) {
    opts.split.closeTab(leafId, tabId)
  }

  function onCloseTabs(leafId: string, tabIds: string[]) {
    opts.split.closeTabs(leafId, tabIds)
  }

  function onSetTabPreview(leafId: string, tabId: string, preview: boolean) {
    const tab = opts.split.leafById(leafId)?.tabs.find((item) => item.id === tabId)
    if (tab) tab.preview = preview
  }

  function onSplitGroup(leaf?: string) {
    const target = leaf ? opts.split.leafById(leaf) : opts.split.activeLeaf.value
    if (!target) return
    opts.split.focusEditorPane(target.id)
    opts.split.duplicateActiveTabInNewPane('horizontal')
  }

  function onCopyTabPath(leafId: string, tabId: string) {
    const tab = opts.split.leafById(leafId)?.tabs.find((item) => item.id === tabId)
    if (tab) void copyToClipboard(opts.absolutePath(tab.filePath))
  }

  /** Close a whole editor group after checking every tab it would drop. */
  async function onCloseGroup(leafId: string) {
    const leaf = opts.split.leafById(leafId)
    if (!leaf) return
    const dirty = leaf.tabs.filter((tab) => opts.buffers.isDirty(tab)).length
    if (dirty) {
      const ok = await uiConfirm(
        opts.t('editorTabs.confirmCloseGroup', { count: leaf.tabs.length, dirty }),
        {
          title: opts.t('editorTabs.closeGroup'),
          confirmText: opts.t('editorTabs.discardClose'),
          cancelText: opts.t('filePreview.cancel'),
        }
      )
      if (!ok) return
    }
    opts.split.closeEditorPane(leafId)
  }

  function selectDir(rel: string) {
    // Only update tree selection — keep the editor leaf showing the last
    // opened file so the right pane doesn't go blank on a directory click.
    opts.selectedRel.value = rel
    opts.selectedIsDir.value = true
    opts.nav.pushNav(rel, true)
    const abs = opts.absolutePath(rel)
    opts.globalSelectedPath.value = abs
    opts.emitNavigate(abs)
  }

  /** A tab the user explicitly turned into a preview (context menu). */
  function hasPreviewSlot(): boolean {
    const leaf = opts.split.activeLeaf.value
    return !!leaf?.tabs.some((tab) => tab.preview && !opts.buffers.isDirty(tab))
  }

  async function selectFile(rel: string, openOpts: { pin?: boolean } = {}) {
    // On narrow panes the drawer covers the preview; picking a file should
    // reveal it. Directory selection keeps the drawer open for browsing.
    if (opts.isNarrow()) opts.closeDrawer()
    opts.selectedRel.value = rel
    opts.selectedIsDir.value = false
    // Every plain click opens a new persistent tab, so browsing several files
    // leaves several tabs. Preview reuse only happens when a tab was
    // deliberately marked as a preview, or the caller asks for it.
    const pin = openOpts.pin ?? !hasPreviewSlot()
    opts.split.openFileInActivePane(rel, false, { pin })
    opts.nav.pushNav(rel, false)
    const abs = opts.absolutePath(rel)
    opts.globalSelectedPath.value = abs
    opts.emitNavigate(abs)
    opts.recordRecent(abs, rel.split('/').pop() || rel)
  }

  /**
   * Open a file from the Changes list.
   *
   * Unlike `selectFile` this is a transient peek: it uses a preview tab and
   * deliberately does not push navigation history or record a recent file, so
   * arrowing through rows does not flood either stack. The caller attaches a
   * diff target to the active leaf afterwards.
   */
  function openFromChanges(rel: string): void {
    if (opts.isNarrow()) opts.closeDrawer()
    opts.selectedRel.value = rel
    opts.selectedIsDir.value = false
    opts.split.openFileInActivePane(rel, false, { pin: false })
    const abs = opts.absolutePath(rel)
    opts.globalSelectedPath.value = abs
    opts.emitNavigate(abs)
  }

  async function trySelectFile(rel: string, ev?: MouseEvent) {
    // Cmd (macOS) / Ctrl (Windows/Linux) + Click → open in a new split pane.
    if (ev?.metaKey || ev?.ctrlKey) {
      opts.split.openFileInNewPane(rel, false, 'horizontal')
      opts.recordRecent(opts.absolutePath(rel), rel.split('/').pop() || rel)
      return
    }
    await selectFile(rel)
  }

  function trySelectDir(rel: string) {
    selectDir(rel)
  }

  function openInNewPane(rel: string, isDir = false) {
    opts.split.openFileInNewPane(rel, isDir, 'horizontal')
    opts.recordRecent(opts.absolutePath(rel), rel.split('/').pop() || rel)
  }

  async function onEditorFileDrop(leafId: string, rel: string, position: DropPosition) {
    if (position === 'center') {
      opts.split.focusEditorPane(leafId)
      await selectFile(rel)
      return
    }
    const direction = position === 'left' || position === 'right' ? 'horizontal' : 'vertical'
    const before = position === 'left' || position === 'top'
    opts.split.openFileInNewPane(rel, false, direction, before ? 'before' : 'after')
    await selectFile(rel)
  }

  // Outside a component (unit tests) there is nothing to clean up on unmount.
  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      if (gitRefreshTimer) {
        clearTimeout(gitRefreshTimer)
        gitRefreshTimer = null
      }
    })
  }

  return {
    tabsForPath,
    isPathDirty,
    rewriteOpenTabs,
    closeTabsForPath,
    onWatchedFileChanged,
    onWatchedFileDeleted,
    onActivateTab,
    onCloseTab,
    onCloseTabs,
    onSetTabPreview,
    onSplitGroup,
    onCopyTabPath,
    onCloseGroup,
    selectDir,
    selectFile,
    openFromChanges,
    trySelectFile,
    trySelectDir,
    openInNewPane,
    onEditorFileDrop,
  }
}

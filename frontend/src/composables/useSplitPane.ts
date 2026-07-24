import { type Ref, nextTick } from 'vue'
import type { Tab, TerminalTab, PaneLayout, LeafPane, SplitPane, DropPosition } from '../types/pane'
import {
  findLeaf,
  findParentSplit,
  getAllLeaves,
  findFirstLeaf,
  replaceLeaf,
  replaceNode,
  redistributeRatios,
  clearAllZoom,
  equalizeRecursive,
  removeLeaf,
  genSplitId,
  ensureSplitRoot,
} from '../types/pane'
import type TerminalPane from '../components/terminal/TerminalPane.vue'
import type { SyncClientMsg } from '../types/protocol'
import {
  apiSplitPane,
  apiClosePane,
  apiCreatePluginPane,
  apiCreateFilesPane,
  apiCreateWebPane,
  apiMovePane,
  apiExtractPane,
} from './useTabApi'
import { isKbTypingLocked, setActivePaneId } from './useTerminal'
import { useI18n } from './useI18n'
import { usePaneWarning } from './usePaneWarning'
import { reconcilePaneMru, removePaneFromMru, touchPaneMru } from '../types/paneMru'
import { getIsAppForeground } from './useAppForeground'
import { markPaneReadIfUnread } from './useNotification'
import { clearFileWorkspaceState } from './useFileWorkspaceState'

export function useSplitPane(opts: {
  tabs: Ref<Tab[]>
  activePaneId: Ref<string | null>
  termRefs: Record<string, InstanceType<typeof TerminalPane>>
  genPaneId: () => string
  sendSync: (msg: SyncClientMsg) => void
  sendLayoutSync: (tabPaneId: string, layout: any, activePaneId: string) => void
  persist: () => void
}) {
  const { tabs, activePaneId, termRefs, genPaneId, sendSync, sendLayoutSync, persist } = opts

  /** Sync layout to server for a given tab */
  function syncTabLayout(tab: TerminalTab) {
    sendLayoutSync(tab.paneId, tab.layout, tab.activePaneId)
  }

  function getActiveTerminal(): TerminalTab | null {
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    if (!tab || tab.type !== 'terminal') return null
    return tab
  }

  function findTabByPaneId(paneId: string): TerminalTab | null {
    const tab = tabs.value.find((t) => {
      if (t.type !== 'terminal') return false
      return !!findLeaf(t.layout, paneId)
    })
    return tab as TerminalTab | null
  }

  /** Split the active pane in the given direction */
  async function splitPane(direction: 'horizontal' | 'vertical', forceLocal?: boolean, cwd?: string) {
    const tab = getActiveTerminal()
    if (!tab) return
    if (getAllLeaves(tab.layout).length >= 6) {
      const { t } = useI18n()
      usePaneWarning().show(t('split.tooManyPanes'))
    }

    try {
      const result = await apiSplitPane(tab.paneId, tab.activePaneId, direction, forceLocal, cwd)
      // Update local layout with server response
      tab.layout = ensureSplitRoot(result.layout)
      tab.paneMru = reconcilePaneMru(
        touchPaneMru(tab.paneMru, result.new_pane_id),
        getAllLeaves(tab.layout).map((leaf) => leaf.paneId),
        result.new_pane_id
      )
      tab.activePaneId = result.new_pane_id
      setActivePaneId(result.new_pane_id)
      persist()
      syncTabLayout(tab)
      nextTick(() => {
        // Blur all other panes first to prevent duplicate input in Tauri WKWebView
        for (const leaf of getAllLeaves(tab.layout)) {
          if (leaf.paneId !== result.new_pane_id) {
            termRefs[leaf.paneId]?.blur()
          }
        }
        termRefs[result.new_pane_id]?.focus()
      })
    } catch (e) {
      console.error('Failed to split pane:', e)
    }
  }

  /** Close a pane. If it's the last leaf, close the entire tab. */
  async function closePane(paneId: string): Promise<boolean> {
    const tab = findTabByPaneId(paneId)
    if (!tab) return false

    // Check if this is the only leaf
    const leaves = getAllLeaves(tab.layout)
    if (leaves.length <= 1) {
      // This is the only leaf — signal to close the tab
      return false
    }

    try {
      const wasActive = tab.activePaneId === paneId
      const result = await apiClosePane(tab.paneId, paneId)

      if (result.tab_closed) {
        // Tab was removed entirely
        return false
      }

      // Update local layout from server response
      if (result.layout) {
        tab.layout = ensureSplitRoot(result.layout)
      }
      const removed = removePaneFromMru(tab.paneMru, paneId)
      tab.paneMru = reconcilePaneMru(
        removed.paneMru,
        getAllLeaves(tab.layout).map((leaf) => leaf.paneId),
        tab.activePaneId
      )
      if (wasActive && removed.nextPaneId) {
        tab.activePaneId = removed.nextPaneId
      }
      setActivePaneId(tab.activePaneId)
      delete termRefs[paneId]
      clearFileWorkspaceState(paneId)
      persist()
      syncTabLayout(tab)
      nextTick(() => {
        getAllLeaves(tab.layout).forEach((l) => termRefs[l.paneId]?.fit())
        // Blur all other panes first to prevent duplicate input in Tauri WKWebView
        for (const leaf of getAllLeaves(tab.layout)) {
          if (leaf.paneId !== tab.activePaneId) {
            termRefs[leaf.paneId]?.blur()
          }
        }
        termRefs[tab.activePaneId]?.focus()
      })
      return true
    } catch (e) {
      console.error('Failed to close pane:', e)
      return false
    }
  }

  /** Insert a non-terminal pane (plugin/files/web) by splitting the target pane. */
  async function insertNonTerminalPane(
    kind: 'plugin' | 'files' | 'web',
    payload: { pluginId?: string; path?: string; url?: string },
    direction: 'horizontal' | 'vertical' = 'horizontal'
  ) {
    const tab = getActiveTerminal()
    if (!tab) return
    const apiDirection =
      direction === 'horizontal' ? 'right' : 'bottom'
    try {
      let result
      if (kind === 'plugin') {
        if (!payload.pluginId) throw new Error('pluginId required')
        result = await apiCreatePluginPane(
          tab.paneId,
          payload.pluginId,
          tab.activePaneId,
          apiDirection
        )
      } else if (kind === 'files') {
        if (!payload.path) throw new Error('path required')
        result = await apiCreateFilesPane(
          tab.paneId,
          payload.path,
          tab.activePaneId,
          apiDirection
        )
      } else {
        if (!payload.url) throw new Error('url required')
        result = await apiCreateWebPane(
          tab.paneId,
          payload.url,
          tab.activePaneId,
          apiDirection
        )
      }
      tab.layout = ensureSplitRoot(result.layout)
      tab.paneMru = reconcilePaneMru(
        touchPaneMru(tab.paneMru, result.new_pane_id),
        getAllLeaves(tab.layout).map((leaf) => leaf.paneId),
        result.new_pane_id
      )
      tab.activePaneId = result.new_pane_id
      setActivePaneId(result.new_pane_id)
      persist()
      syncTabLayout(tab)
    } catch (e) {
      console.error(`Failed to create ${kind} pane:`, e)
    }
  }

  /** Move whole source tab as subtree into dst tab (Mode A). */
  async function moveTabToPane(
    srcTabId: string,
    dstTabId: string,
    targetPaneId: string,
    direction: 'left' | 'right' | 'top' | 'bottom'
  ) {
    try {
      const result = await apiMovePane(dstTabId, {
        source_tab_id: srcTabId,
        target_pane_id: targetPaneId,
        direction,
      })
      // Update destination tab local layout
      const dst = tabs.value.find(
        (t) => t.type === 'terminal' && t.paneId === dstTabId
      ) as TerminalTab | undefined
      if (dst) {
        dst.layout = ensureSplitRoot(result.layout)
        // Reconcile paneMru so the newly-merged leaves are tracked and the
        // active pane is marked most-recent. Without this, focus shortcuts
        // (focusNext/Prev/Neighbor) would skip the merged panes until the
        // next layout_updated broadcast arrives to fix it.
        dst.paneMru = reconcilePaneMru(
          touchPaneMru(dst.paneMru, result.active_pane_id),
          getAllLeaves(dst.layout).map((leaf) => leaf.paneId),
          result.active_pane_id
        )
        dst.activePaneId = result.active_pane_id
        setActivePaneId(dst.activePaneId)
        activePaneId.value = dst.paneId
      }
      // Remove source tab locally (backend already removed + broadcasted TabClosed)
      const srcIdx = tabs.value.findIndex((t) => t.paneId === srcTabId)
      if (srcIdx !== -1) tabs.value.splice(srcIdx, 1)
      persist()
    } catch (e) {
      console.error('Failed to move tab to pane:', e)
    }
  }

  /** Move a single pane across tabs (Mode B). */
  async function movePaneToTab(
    srcTabId: string,
    paneId: string,
    dstTabId: string,
    targetPaneId: string,
    direction: 'left' | 'right' | 'top' | 'bottom'
  ) {
    try {
      const result = await apiMovePane(dstTabId, {
        source_tab_id: srcTabId,
        source_pane_id: paneId,
        target_pane_id: targetPaneId,
        direction,
      })
      // Update source tab local layout
      const src = tabs.value.find(
        (t) => t.type === 'terminal' && t.paneId === srcTabId
      ) as TerminalTab | undefined
      if (src && result.source_layout) {
        src.layout = ensureSplitRoot(result.source_layout)
        src.paneMru = removePaneFromMru(src.paneMru, paneId).paneMru
      }
      // Update destination tab local layout
      const dst = tabs.value.find(
        (t) => t.type === 'terminal' && t.paneId === dstTabId
      ) as TerminalTab | undefined
      if (dst) {
        dst.layout = ensureSplitRoot(result.layout)
        dst.paneMru = reconcilePaneMru(
          touchPaneMru(dst.paneMru, result.active_pane_id),
          getAllLeaves(dst.layout).map((leaf) => leaf.paneId),
          result.active_pane_id
        )
        dst.activePaneId = result.active_pane_id
        setActivePaneId(dst.activePaneId)
      }
      persist()
    } catch (e) {
      console.error('Failed to move pane to tab:', e)
    }
  }

  /** Promote a single pane to a new tab. */
  async function promotePaneToTab(srcTabId: string, paneId: string) {
    // Capture the source leaf BEFORE extraction. After `apiExtractPane`
    // returns, `result.source_layout` no longer contains this paneId, so the
    // non-terminal metadata (kind/pluginId/path/url/title) can only be
    // recovered from the pre-extraction layout. Without this capture, the
    // fallback below would hardcode `title: 'Terminal'` and drop plugin/files/
    // web metadata - producing an empty "Terminal" tab when the source was a
    // non-terminal pane and the REST response wins the race against the
    // TabCreated broadcast (which would otherwise restore the layout).
    const srcBefore = tabs.value.find(
      (t) => t.type === 'terminal' && t.paneId === srcTabId
    ) as TerminalTab | undefined
    const sourceLeaf = srcBefore ? findLeaf(srcBefore.layout, paneId) : null

    try {
      const result = await apiExtractPane(srcTabId, paneId)
      // Update source tab local layout
      const src = tabs.value.find(
        (t) => t.type === 'terminal' && t.paneId === srcTabId
      ) as TerminalTab | undefined
      let inheritedCwd: string | undefined
      let inheritedConnectionId: string | undefined
      let inheritedWorkspaceId: string | undefined
      if (src) {
        src.layout = ensureSplitRoot(result.source_layout)
        src.paneMru = removePaneFromMru(src.paneMru, paneId).paneMru
        inheritedCwd = src.cwd
        inheritedConnectionId = src.connectionId
        inheritedWorkspaceId = src.workspaceId
      }
      // Push locally with inherited fields so the new tab lands in the
      // same workspace as its source. The TabCreated broadcast will
      // find this existing entry and skip pushing a duplicate.
      //
      // Dedup guard: if the TabCreated broadcast arrived before the REST
      // response, the sync WS handler already pushed this tab. Filling in
      // inherited cwd/connectionId/workspaceId on the existing entry instead
      // of pushing again prevents duplicate tabs (visible as the "multiple
      // tabs in default workspace" symptom after pane->tab-blank drop).
      const existing = tabs.value.find(
        (t) => t.type === 'terminal' && t.paneId === result.new_tab_id
      ) as TerminalTab | undefined
      if (existing) {
        if (inheritedCwd && !existing.cwd) existing.cwd = inheritedCwd
        if (inheritedConnectionId && !existing.connectionId) {
          existing.connectionId = inheritedConnectionId
        }
        if (inheritedWorkspaceId && !existing.workspaceId) {
          existing.workspaceId = inheritedWorkspaceId
        }
      } else {
        // Build the new tab's root leaf from the captured source leaf so
        // kind/title/pluginId/path/url survive the extraction. Falls back to
        // a plain terminal leaf only when the source was already gone.
        const fallbackLeaf: LeafPane = sourceLeaf
          ? { ...sourceLeaf, ratio: 1, zoomed: false }
          : {
              type: 'leaf',
              paneId: result.pane_id,
              title: 'Terminal',
              ratio: 1,
              zoomed: false,
            }
        tabs.value.push({
          type: 'terminal',
          paneId: result.new_tab_id,
          layout: ensureSplitRoot(fallbackLeaf),
          activePaneId: result.pane_id,
          paneMru: [result.pane_id],
          broadcastMode: false,
          broadcastActivity: 0,
          previewVisible: false,
          previewAddress: '',
          previewUrl: '',
          previewKind: 'web',
          cwd: inheritedCwd,
          connectionId: inheritedConnectionId,
          workspaceId: inheritedWorkspaceId,
        })
      }
      setActivePaneId(result.pane_id)
      activePaneId.value = result.new_tab_id
      persist()
    } catch (e) {
      console.error('Failed to promote pane to tab:', e)
    }
  }

  /** Focus a specific pane */
  function focusPane(paneId: string) {
    const tab = findTabByPaneId(paneId)
    if (tab) {
      tab.paneMru = touchPaneMru(tab.paneMru, paneId)
      tab.activePaneId = paneId
      // Update immediately so onData guard blocks other panes before nextTick
      setActivePaneId(paneId)
      clearAllZoom(tab.layout)
      persist()
      syncTabLayout(tab)
      if (getIsAppForeground()) markPaneReadIfUnread(paneId, 'focus')
      nextTick(() => {
        // Sticky typing mode: the user tapped another pane while typing on the mobile
        // keyboard. Keep the iOS system keyboard — mobile input already routes to the
        // new activePaneId via getSendFn(), so no terminal needs DOM focus. Moving
        // xterm focus here would blur our textarea and collapse the keyboard. The lock
        // is only ever set on touch under the collapse guard, so off/open_only and
        // desktop keep the original blur/focus behaviour untouched.
        if (isKbTypingLocked()) return
        // Blur all other panes first to prevent duplicate input in Tauri WKWebView
        for (const leaf of getAllLeaves(tab.layout)) {
          if (leaf.paneId !== paneId) {
            termRefs[leaf.paneId]?.blur()
          }
        }
        termRefs[paneId]?.focus()
      })
    }
  }

  /** Get the bounding rect of a pane's DOM element */
  function getPaneRect(paneId: string): DOMRect | null {
    const el = (termRefs[paneId] as any)?.$el as HTMLElement | undefined
    return el?.getBoundingClientRect() ?? null
  }

  /** Check if rectB is in the given direction from rectA */
  function isDirection(
    rectA: DOMRect,
    rectB: DOMRect,
    direction: 'left' | 'right' | 'up' | 'down'
  ): boolean {
    const cx = rectA.left + rectA.width / 2
    const cy = rectA.top + rectA.height / 2
    const tx = rectB.left + rectB.width / 2
    const ty = rectB.top + rectB.height / 2

    switch (direction) {
      case 'left':
        return tx < cx
      case 'right':
        return tx > cx
      case 'up':
        return ty < cy
      case 'down':
        return ty > cy
    }
  }

  /** Distance between centers of two rects */
  function centerDistance(a: DOMRect, b: DOMRect): number {
    const ax = a.left + a.width / 2
    const ay = a.top + a.height / 2
    const bx = b.left + b.width / 2
    const by = b.top + b.height / 2
    return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)
  }

  /** Focus the nearest pane in the given spatial direction */
  function focusNeighbor(direction: 'left' | 'right' | 'up' | 'down') {
    const tab = getActiveTerminal()
    if (!tab) return

    const currentRect = getPaneRect(tab.activePaneId)
    if (!currentRect) return

    const leaves = getAllLeaves(tab.layout)
    const candidates = leaves
      .filter((l) => l.paneId !== tab.activePaneId)
      .map((l) => ({ pane: l, rect: getPaneRect(l.paneId) }))
      .filter(
        (c): c is { pane: LeafPane; rect: DOMRect } =>
          c.rect !== null && isDirection(currentRect, c.rect, direction)
      )

    if (candidates.length === 0) return

    const nearest = candidates.reduce((best, c) =>
      centerDistance(currentRect, c.rect) < centerDistance(currentRect, best.rect) ? c : best
    )
    focusPane(nearest.pane.paneId)
  }

  /** Focus next pane in order */
  function focusNext() {
    const tab = getActiveTerminal()
    if (!tab) return
    const leaves = getAllLeaves(tab.layout)
    const idx = leaves.findIndex((l) => l.paneId === tab.activePaneId)
    const next = leaves[(idx + 1) % leaves.length]
    focusPane(next.paneId)
  }

  /** Focus previous pane in order */
  function focusPrev() {
    const tab = getActiveTerminal()
    if (!tab) return
    const leaves = getAllLeaves(tab.layout)
    const idx = leaves.findIndex((l) => l.paneId === tab.activePaneId)
    const prev = leaves[(idx - 1 + leaves.length) % leaves.length]
    focusPane(prev.paneId)
  }

  /** Toggle zoom on the active pane */
  function toggleZoom() {
    const tab = getActiveTerminal()
    if (!tab) return
    const leaf = findLeaf(tab.layout, tab.activePaneId)
    if (!leaf || leaf.type !== 'leaf') return
    leaf.zoomed = !leaf.zoomed
    persist()
    syncTabLayout(tab)
    nextTick(() => termRefs[tab.activePaneId]?.fit())
  }

  /** Equalize all pane ratios */
  function equalizePanes() {
    const tab = getActiveTerminal()
    if (!tab) return
    equalizeRecursive(tab.layout)
    persist()
    syncTabLayout(tab)
    nextTick(() => {
      getAllLeaves(tab.layout).forEach((l) => termRefs[l.paneId]?.fit())
    })
  }

  /** Toggle broadcast input mode */
  function toggleBroadcast() {
    const tab = getActiveTerminal()
    if (!tab) return
    tab.broadcastMode = !tab.broadcastMode
    persist()
  }

  /** Keyboard resize: adjust current pane's ratio by step */
  function keyboardResize(direction: 'left' | 'right' | 'up' | 'down') {
    const tab = getActiveTerminal()
    if (!tab) return

    const parent = findParentSplit(tab.layout, tab.activePaneId)
    if (!parent) return

    const idx = parent.children.findIndex((c) => c.type === 'leaf' && c.paneId === tab.activePaneId)
    if (idx === -1) return

    const step = 0.05

    if (parent.direction === 'horizontal') {
      if (direction === 'left' && idx > 0) {
        parent.ratios[idx] = Math.max(0.1, parent.ratios[idx] - step)
        parent.ratios[idx - 1] += step
      } else if (direction === 'right' && idx < parent.children.length - 1) {
        parent.ratios[idx] = Math.min(0.9, parent.ratios[idx] + step)
        parent.ratios[idx + 1] -= step
      }
    } else {
      if (direction === 'up' && idx > 0) {
        parent.ratios[idx] = Math.max(0.1, parent.ratios[idx] - step)
        parent.ratios[idx - 1] += step
      } else if (direction === 'down' && idx < parent.children.length - 1) {
        parent.ratios[idx] = Math.min(0.9, parent.ratios[idx] + step)
        parent.ratios[idx + 1] -= step
      }
    }

    parent.children.forEach((c, i) => {
      if (c.type === 'leaf') c.ratio = parent.ratios[i]
    })

    persist()
    syncTabLayout(tab)
    nextTick(() => {
      getAllLeaves(tab.layout).forEach((l) => termRefs[l.paneId]?.fit())
    })
  }

  /** Handle broadcast input: send data to all other panes in the same tab */
  function onTerminalInput(sourcePaneId: string, data: string) {
    if (getIsAppForeground()) markPaneReadIfUnread(sourcePaneId, 'terminal_input')
    const tab = findTabByPaneId(sourcePaneId)
    if (!tab || !tab.broadcastMode) return

    const leaves = getAllLeaves(tab.layout)
    for (const leaf of leaves) {
      if (leaf.paneId !== sourcePaneId) {
        termRefs[leaf.paneId]?.sendData(data, true)
      }
    }
    // Increment activity counter to re-trigger broadcast banner
    tab.broadcastActivity++
  }

  /** Reorder a pane by dragging: move source to the indicated edge of target (iTerm2-style) */
  function reorderPane(sourcePaneId: string, targetPaneId: string, position: DropPosition) {
    if (sourcePaneId === targetPaneId) return

    const tab = findTabByPaneId(sourcePaneId)
    if (!tab) return

    const sourceLeaf = findLeaf(tab.layout, sourcePaneId)
    if (!sourceLeaf) return

    const direction: 'horizontal' | 'vertical' =
      position === 'left' || position === 'right' ? 'horizontal' : 'vertical'
    const before = position === 'left' || position === 'top'

    const sourceParent = findParentSplit(tab.layout, sourcePaneId)
    const targetParent = findParentSplit(tab.layout, targetPaneId)

    // Both must be in some split (headers only show in split mode)
    if (!sourceParent || !targetParent) return

    const sameParent = sourceParent === targetParent

    // Special case: same split, same direction → simple reorder
    if (sameParent && sourceParent.direction === direction) {
      const sourceIdx = sourceParent.children.findIndex(
        (c) => c.type === 'leaf' && c.paneId === sourcePaneId
      )
      const targetIdx = sourceParent.children.findIndex(
        (c) => c.type === 'leaf' && c.paneId === targetPaneId
      )
      if (sourceIdx === -1 || targetIdx === -1) return

      const [moved] = sourceParent.children.splice(sourceIdx, 1)
      sourceParent.ratios.splice(sourceIdx, 1)
      const insertIdx = before ? targetIdx : targetIdx + 1
      const adjustedIdx = sourceIdx < targetIdx ? insertIdx - 1 : insertIdx
      sourceParent.children.splice(adjustedIdx, 0, moved)
      redistributeRatios(sourceParent)
      persist()
      syncTabLayout(tab)
      nextTick(() => {
        getAllLeaves(tab.layout).forEach((l) => termRefs[l.paneId]?.fit())
      })
      return
    }

    // Special case: same 2-child split, different direction → replace parent directly
    if (sameParent && sourceParent.children.length === 2) {
      const newSplit: SplitPane = {
        type: 'split',
        id: genSplitId(),
        direction,
        children: before
          ? [
              sourceParent.children.find((c) => c.type === 'leaf' && c.paneId === sourcePaneId)!,
              sourceParent.children.find((c) => c.type === 'leaf' && c.paneId === targetPaneId)!,
            ]
          : [
              sourceParent.children.find((c) => c.type === 'leaf' && c.paneId === targetPaneId)!,
              sourceParent.children.find((c) => c.type === 'leaf' && c.paneId === sourcePaneId)!,
            ],
        ratios: [0.5, 0.5],
      }
      if (sourceParent === tab.layout) {
        tab.layout = newSplit
      } else {
        replaceNode(tab.layout, sourceParent, newSplit)
      }
      redistributeRatios(newSplit)
      persist()
      syncTabLayout(tab)
      nextTick(() => {
        getAllLeaves(tab.layout).forEach((l) => termRefs[l.paneId]?.fit())
      })
      return
    }

    // General case: remove source, then insert into/around target
    const removed = removeLeaf(tab.layout, sourcePaneId)
    if (!removed) return

    // After removal, target may have become the root leaf (parent collapsed)
    if (tab.layout.type === 'leaf' && tab.layout.paneId === targetPaneId) {
      const newSplit: SplitPane = {
        type: 'split',
        id: genSplitId(),
        direction,
        children: before ? [removed, tab.layout] : [tab.layout, removed],
        ratios: [0.5, 0.5],
      }
      tab.layout = newSplit
      persist()
      syncTabLayout(tab)
      nextTick(() => {
        getAllLeaves(tab.layout).forEach((l) => termRefs[l.paneId]?.fit())
      })
      return
    }

    // Re-find target parent after tree restructuring
    const effectiveTargetParent = findParentSplit(tab.layout, targetPaneId)
    if (!effectiveTargetParent) return

    const targetIdx = effectiveTargetParent.children.findIndex(
      (c) => c.type === 'leaf' && c.paneId === targetPaneId
    )

    if (targetIdx !== -1) {
      // Target is a leaf in a split
      if (effectiveTargetParent.direction === direction) {
        // Same direction: insert as sibling
        const insertIdx = before ? targetIdx : targetIdx + 1
        effectiveTargetParent.children.splice(insertIdx, 0, removed)
        redistributeRatios(effectiveTargetParent)
      } else {
        // Different direction: wrap target in a new split
        const newSplit: SplitPane = {
          type: 'split',
          id: genSplitId(),
          direction,
          children: before
            ? [removed, effectiveTargetParent.children[targetIdx]]
            : [effectiveTargetParent.children[targetIdx], removed],
          ratios: [0.5, 0.5],
        }
        effectiveTargetParent.children[targetIdx] = newSplit
      }
    } else {
      // Target might be a split node — find it as a child
      const targetAsChildIdx = effectiveTargetParent.children.findIndex((c) => {
        if (c.type !== 'split') return false
        return !!findLeaf(c, targetPaneId)
      })
      if (targetAsChildIdx !== -1) {
        const targetNode = effectiveTargetParent.children[targetAsChildIdx]
        if (targetNode.type === 'split' && targetNode.direction === direction) {
          // Same direction: insert into the split
          if (before) targetNode.children.unshift(removed)
          else targetNode.children.push(removed)
          redistributeRatios(targetNode)
        } else if (targetNode.type === 'split') {
          // Different direction: wrap the split in a new split
          const newSplit: SplitPane = {
            type: 'split',
            id: genSplitId(),
            direction,
            children: before ? [removed, targetNode] : [targetNode, removed],
            ratios: [0.5, 0.5],
          }
          effectiveTargetParent.children[targetAsChildIdx] = newSplit
        }
      }
    }

    persist()
    syncTabLayout(tab)
    nextTick(() => {
      getAllLeaves(tab.layout).forEach((l) => termRefs[l.paneId]?.fit())
    })
  }

  /** Update title for a leaf pane */
  function updatePaneTitle(paneId: string, title: string) {
    const tab = findTabByPaneId(paneId)
    if (!tab) return
    const leaf = findLeaf(tab.layout, paneId)
    if (leaf) {
      leaf.title = title || 'Terminal'
      persist()
      syncTabLayout(tab)
    }
  }

  /** Fit all panes in the active tab */
  function fitActiveTabPanes() {
    const tab = getActiveTerminal()
    if (!tab) return
    nextTick(() => {
      getAllLeaves(tab.layout).forEach((l) => termRefs[l.paneId]?.fit())
    })
  }

  return {
    splitPane,
    closePane,
    insertNonTerminalPane,
    moveTabToPane,
    movePaneToTab,
    promotePaneToTab,
    focusPane,
    focusNeighbor,
    focusNext,
    focusPrev,
    toggleZoom,
    equalizePanes,
    toggleBroadcast,
    keyboardResize,
    onTerminalInput,
    reorderPane,
    updatePaneTitle,
    fitActiveTabPanes,
    findTabByPaneId,
    getAllLeaves,
  }
}

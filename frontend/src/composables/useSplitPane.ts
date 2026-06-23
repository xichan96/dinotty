import { type Ref, nextTick } from 'vue'
import type { Tab, TerminalTab, PaneLayout, LeafPane, SplitPane, DropPosition } from '../types/pane'
import {
  findLeaf, findParentSplit, getAllLeaves, findFirstLeaf,
  replaceLeaf, replaceNode, redistributeRatios, clearAllZoom, equalizeRecursive,
  removeLeaf, genSplitId, ensureSplitRoot,
} from '../types/pane'
import type TerminalPane from '../components/terminal/TerminalPane.vue'
import type { SyncClientMsg } from '../types/protocol'
import { apiSplitPane, apiClosePane } from './useTabApi'
import { setActivePaneId } from './useTerminal'

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
    const tab = tabs.value.find(t => t.paneId === activePaneId.value)
    if (!tab || tab.type !== 'terminal') return null
    return tab
  }

  function findTabByPaneId(paneId: string): TerminalTab | null {
    const tab = tabs.value.find(t => {
      if (t.type !== 'terminal') return false
      return !!findLeaf(t.layout, paneId)
    })
    return tab as TerminalTab | null
  }

  /** Split the active pane in the given direction */
  async function splitPane(direction: 'horizontal' | 'vertical') {
    const tab = getActiveTerminal()
    if (!tab) return
    if (getAllLeaves(tab.layout).length >= 6) return

    try {
      const result = await apiSplitPane(tab.paneId, tab.activePaneId, direction)
      // Update local layout with server response
      tab.layout = ensureSplitRoot(result.layout)
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
      const result = await apiClosePane(tab.paneId, paneId)

      if (result.tab_closed) {
        // Tab was removed entirely
        return false
      }

      // Update local layout from server response
      if (result.layout) {
        tab.layout = ensureSplitRoot(result.layout)
      }
      if (result.active_pane_id) {
        tab.activePaneId = result.active_pane_id
        setActivePaneId(result.active_pane_id)
      }
      delete termRefs[paneId]
      persist()
      syncTabLayout(tab)
      nextTick(() => {
        getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
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

  /** Focus a specific pane */
  function focusPane(paneId: string) {
    const tab = findTabByPaneId(paneId)
    if (tab) {
      tab.activePaneId = paneId
      // Update immediately so onData guard blocks other panes before nextTick
      setActivePaneId(paneId)
      clearAllZoom(tab.layout)
      persist()
      syncTabLayout(tab)
      nextTick(() => {
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
  function isDirection(rectA: DOMRect, rectB: DOMRect, direction: 'left' | 'right' | 'up' | 'down'): boolean {
    const cx = rectA.left + rectA.width / 2
    const cy = rectA.top + rectA.height / 2
    const tx = rectB.left + rectB.width / 2
    const ty = rectB.top + rectB.height / 2

    switch (direction) {
      case 'left': return tx < cx
      case 'right': return tx > cx
      case 'up': return ty < cy
      case 'down': return ty > cy
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
      .filter(l => l.paneId !== tab.activePaneId)
      .map(l => ({ pane: l, rect: getPaneRect(l.paneId) }))
      .filter((c): c is { pane: LeafPane; rect: DOMRect } => c.rect !== null && isDirection(currentRect, c.rect, direction))

    if (candidates.length === 0) return

    const nearest = candidates.reduce((best, c) =>
      centerDistance(currentRect, c.rect) < centerDistance(currentRect, best.rect) ? c : best,
    )
    focusPane(nearest.pane.paneId)
  }

  /** Focus next pane in order */
  function focusNext() {
    const tab = getActiveTerminal()
    if (!tab) return
    const leaves = getAllLeaves(tab.layout)
    const idx = leaves.findIndex(l => l.paneId === tab.activePaneId)
    const next = leaves[(idx + 1) % leaves.length]
    focusPane(next.paneId)
  }

  /** Focus previous pane in order */
  function focusPrev() {
    const tab = getActiveTerminal()
    if (!tab) return
    const leaves = getAllLeaves(tab.layout)
    const idx = leaves.findIndex(l => l.paneId === tab.activePaneId)
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
      getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
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

    const idx = parent.children.findIndex(c =>
      c.type === 'leaf' && c.paneId === tab.activePaneId,
    )
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
      getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
    })
  }

  /** Handle broadcast input: send data to all other panes in the same tab */
  function onTerminalInput(sourcePaneId: string, data: string) {
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

    const direction: 'horizontal' | 'vertical' = (position === 'left' || position === 'right') ? 'horizontal' : 'vertical'
    const before = position === 'left' || position === 'top'

    const sourceParent = findParentSplit(tab.layout, sourcePaneId)
    const targetParent = findParentSplit(tab.layout, targetPaneId)

    // Both must be in some split (headers only show in split mode)
    if (!sourceParent || !targetParent) return

    const sameParent = sourceParent === targetParent

    // Special case: same split, same direction → simple reorder
    if (sameParent && sourceParent.direction === direction) {
      const sourceIdx = sourceParent.children.findIndex(c => c.type === 'leaf' && c.paneId === sourcePaneId)
      const targetIdx = sourceParent.children.findIndex(c => c.type === 'leaf' && c.paneId === targetPaneId)
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
        getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
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
          ? [sourceParent.children.find(c => c.type === 'leaf' && c.paneId === sourcePaneId)!, sourceParent.children.find(c => c.type === 'leaf' && c.paneId === targetPaneId)!]
          : [sourceParent.children.find(c => c.type === 'leaf' && c.paneId === targetPaneId)!, sourceParent.children.find(c => c.type === 'leaf' && c.paneId === sourcePaneId)!],
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
        getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
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
        getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
      })
      return
    }

    // Re-find target parent after tree restructuring
    const effectiveTargetParent = findParentSplit(tab.layout, targetPaneId)
    if (!effectiveTargetParent) return

    const targetIdx = effectiveTargetParent.children.findIndex(c =>
      c.type === 'leaf' && c.paneId === targetPaneId,
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
          children: before ? [removed, effectiveTargetParent.children[targetIdx]] : [effectiveTargetParent.children[targetIdx], removed],
          ratios: [0.5, 0.5],
        }
        effectiveTargetParent.children[targetIdx] = newSplit
      }
    } else {
      // Target might be a split node — find it as a child
      const targetAsChildIdx = effectiveTargetParent.children.findIndex(c => {
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
      getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
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
      getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
    })
  }

  return {
    splitPane,
    closePane,
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

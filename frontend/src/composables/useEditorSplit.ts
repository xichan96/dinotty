import { ref, computed, type Ref } from 'vue'
import {
  createEditorLeaf,
  createEditorSplit,
  findEditorLeaf,
  getAllEditorLeaves,
  findFirstEditorLeaf,
  redistributeEditorRatios,
  replaceEditorLeaf,
  type EditorLeafPane,
  type EditorPaneLayout,
} from '../types/editorPane'
import {
  activateTab as activateTabInLeaf,
  closeTab as closeTabInLeaf,
  closeTabs as closeTabsInLeaf,
  getActiveTab,
  moveTab,
  openTab,
  reorderTab,
  syncLeafActive,
  takeTab,
  type EditorTab,
} from '../types/editorTabs'

export type EditorDropPosition = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface UseEditorSplitOptions {
  paneId: () => string
  /** Buffer-aware dirty lookup used when deciding which preview tab to reuse. */
  isTabDirty?: (tab: EditorTab) => boolean
  /** Drop cached buffer state for a closed tab. */
  onTabRemoved?: (tab: EditorTab) => void
  /** Reset cached buffer state when a preview tab is retargeted. */
  onTabReset?: (tab: EditorTab) => void
}

export function useEditorSplit(opts: UseEditorSplitOptions) {
  const editorLayout = ref<EditorPaneLayout>(createEditorLeaf()) as Ref<EditorPaneLayout>
  const activeEditorLeafId = ref<string | null>(
    editorLayout.value.type === 'editor-leaf' ? editorLayout.value.id : null
  )

  /** The currently active leaf, derived from activeEditorLeafId */
  const activeLeaf = computed(() => {
    if (!activeEditorLeafId.value) return null
    return findEditorLeaf(editorLayout.value, activeEditorLeafId.value)
  })

  /** The active tab of the active group. */
  const activeTab = computed(() => (activeLeaf.value ? getActiveTab(activeLeaf.value) : null))

  /** Whether the layout has more than one pane */
  const isSplit = computed(() => editorLayout.value.type === 'editor-split')

  /** All leaves count */
  const leafCount = computed(() => getAllEditorLeaves(editorLayout.value).length)

  function isDirty(tab: EditorTab): boolean {
    return opts.isTabDirty?.(tab) ?? false
  }

  function leafById(leafId: string): EditorLeafPane | null {
    return findEditorLeaf(editorLayout.value, leafId)
  }

  function focusEditorPane(leafId: string) {
    activeEditorLeafId.value = leafId
  }

  function activateTab(leafId: string, tabId: string): boolean {
    const leaf = leafById(leafId)
    if (!leaf || !activateTabInLeaf(leaf, tabId)) return false
    activeEditorLeafId.value = leaf.id
    return true
  }

  /** Open a file in the currently active pane. Preview tabs reuse a slot. */
  function openFileInActivePane(
    filePath: string,
    isDir: boolean,
    openOpts: { pin?: boolean } = {}
  ): EditorTab | null {
    const leaf = activeLeaf.value
    if (!leaf) return null
    const result = openTab(leaf, filePath, isDir, {
      pin: openOpts.pin,
      isDirty,
    })
    if (result.replaced) opts.onTabReset?.(result.tab)
    activeEditorLeafId.value = leaf.id
    return result.tab
  }

  /** Wrap a leaf in a split and place `newLeaf` on one side. */
  function splitLeafAt(
    target: EditorLeafPane,
    newLeaf: EditorLeafPane,
    direction: 'horizontal' | 'vertical',
    before: boolean
  ): void {
    const split = createEditorSplit(
      direction,
      before ? [newLeaf, target] : [target, newLeaf]
    )
    if (editorLayout.value === target) {
      editorLayout.value = split
    } else {
      replaceEditorLeaf(editorLayout.value, target.id, split)
    }
  }

  /** Split the active pane and open a file in the new pane. */
  function openFileInNewPane(
    filePath: string,
    isDir: boolean,
    direction: 'horizontal' | 'vertical' = 'horizontal',
    edge: 'after' | 'before' = 'after'
  ): EditorLeafPane {
    const target = activeLeaf.value
    const newLeaf = createEditorLeaf(filePath, isDir)
    if (!target) {
      editorLayout.value = createEditorSplit(direction, [editorLayout.value, newLeaf])
    } else {
      splitLeafAt(target, newLeaf, direction, edge === 'before')
    }
    activeEditorLeafId.value = newLeaf.id
    return newLeaf
  }

  /** The tab-bar split button: duplicate the active file into a new group. */
  function duplicateActiveTabInNewPane(direction: 'horizontal' | 'vertical' = 'horizontal') {
    const tab = activeTab.value
    if (!tab) return null
    return openFileInNewPane(tab.filePath, tab.isDir, direction)
  }

  function removeLeaf(leafId: string): boolean {
    if (editorLayout.value.type === 'editor-leaf') return false

    function prune(node: EditorPaneLayout): EditorPaneLayout | null {
      if (node.type === 'editor-leaf') return node.id === leafId ? null : node
      const children = node.children
        .map(prune)
        .filter((child): child is EditorPaneLayout => child !== null)
      if (children.length === 0) return null
      if (children.length === 1) return children[0]
      node.children = children
      redistributeEditorRatios(node)
      return node
    }

    const next = prune(editorLayout.value)
    if (!next) return false
    // A lone flex item only fills its container when flex-grow sums to >= 1.
    // The survivor of a collapsed split still carries the old half ratio, so
    // reset it or the pane stops at half width with blank space beside it.
    if (next.type === 'editor-leaf') next.ratio = 1
    editorLayout.value = next
    if (activeEditorLeafId.value === leafId) {
      activeEditorLeafId.value = findFirstEditorLeaf(editorLayout.value)?.id ?? null
    }
    return true
  }

  /** Close a whole editor group; the last group is emptied instead of removed. */
  function closeEditorPane(leafId: string) {
    const leaf = leafById(leafId)
    if (!leaf) return
    for (const tab of leaf.tabs) opts.onTabRemoved?.(tab)
    if (leafCount.value > 1) {
      removeLeaf(leafId)
      return
    }
    leaf.tabs = []
    leaf.activeTabId = null
    syncLeafActive(leaf)
  }

  /** Close one tab; an emptied non-last group disappears like VS Code. */
  function closeTab(leafId: string, tabId: string): boolean {
    const leaf = leafById(leafId)
    if (!leaf) return false
    const result = closeTabInLeaf(leaf, tabId)
    if (!result.closed) return false
    opts.onTabRemoved?.(result.closed)
    if (leaf.tabs.length === 0 && leafCount.value > 1) {
      removeLeaf(leafId)
    }
    return true
  }

  /** Close all tabs matching the ids, then drop an emptied group. */
  function closeTabs(leafId: string, tabIds: Iterable<string>): void {
    const leaf = leafById(leafId)
    if (!leaf) return
    for (const tab of closeTabsInLeaf(leaf, tabIds)) opts.onTabRemoved?.(tab)
    if (leaf.tabs.length === 0 && leafCount.value > 1) {
      removeLeaf(leafId)
    }
  }

  function removeLeafIfEmpty(leafId: string): boolean {
    const leaf = leafById(leafId)
    if (!leaf || leaf.tabs.length > 0 || leafCount.value <= 1) return false
    return removeLeaf(leafId)
  }

  /** Reorder a tab inside its own strip. */
  function reorderTabInLeaf(
    leafId: string,
    tabId: string,
    targetTabId: string,
    after: boolean
  ): boolean {
    const leaf = leafById(leafId)
    if (!leaf) return false
    const moved = reorderTab(leaf, tabId, targetTabId, after)
    if (moved) activeEditorLeafId.value = leaf.id
    return moved
  }

  /** Move a tab into another existing group (drop on its tab strip). */
  function moveTabToPane(sourceLeafId: string, tabId: string, targetLeafId: string): boolean {
    const source = leafById(sourceLeafId)
    const target = leafById(targetLeafId)
    if (!source || !target || source === target) return false
    const sourceTab = source.tabs.find((tab) => tab.id === tabId)
    if (!sourceTab) return false

    // The target already shows this file: never create a second tab with the
    // same path in one group. A dirty source is left where it is so its text
    // is not silently dropped.
    const existing = target.tabs.find((tab) => tab.filePath === sourceTab.filePath)
    if (existing) {
      if (isDirty(sourceTab)) return false
      const taken = takeTab(source, tabId)
      if (!taken) return false
      opts.onTabRemoved?.(taken)
      activateTabInLeaf(target, existing.id)
      activeEditorLeafId.value = target.id
      removeLeafIfEmpty(source.id)
      return true
    }

    if (!moveTab(source, target, tabId)) return false
    activeEditorLeafId.value = target.id
    removeLeafIfEmpty(source.id)
    return true
  }

  /**
   * Move a tab out of its group and into a new group split off the target's
   * requested edge. Used by tab drag-and-drop on the editor content area.
   */
  function splitTabToEdge(
    sourceLeafId: string,
    tabId: string,
    targetLeafId: string,
    position: Exclude<EditorDropPosition, 'center'>
  ): boolean {
    const source = leafById(sourceLeafId)
    const target = leafById(targetLeafId)
    if (!source || !target) return false
    const tab = takeTab(source, tabId)
    if (!tab) return false
    tab.preview = false

    const newLeaf = createEditorLeaf()
    newLeaf.tabs = [tab]
    newLeaf.activeTabId = tab.id
    syncLeafActive(newLeaf)

    const direction =
      position === 'left' || position === 'right' ? 'horizontal' : 'vertical'
    const before = position === 'left' || position === 'top'
    splitLeafAt(target, newLeaf, direction, before)

    if (source.id !== target.id && source.tabs.length === 0) {
      removeLeafIfEmpty(source.id)
    }
    activeEditorLeafId.value = newLeaf.id
    return true
  }

  /** Set focus on a specific editor pane (alias used by callers). */
  function focusLeaf(leafId: string) {
    focusEditorPane(leafId)
  }

  /** Build a balanced binary split tree from a list of files */
  function buildBalancedTree(
    files: Array<{ filePath: string; isDir: boolean }>,
    direction: 'horizontal' | 'vertical'
  ): EditorPaneLayout {
    if (files.length === 1) {
      return createEditorLeaf(files[0].filePath, files[0].isDir)
    }
    const mid = Math.ceil(files.length / 2)
    const left = buildBalancedTree(files.slice(0, mid), direction)
    const right = buildBalancedTree(files.slice(mid), direction)
    return createEditorSplit(direction, [left, right])
  }

  /**
   * Replace the layout with N balanced split panes, one per file.
   * Returns leaf ids in the same order as input files so callers can map
   * (file, line, col) -> leafId for cursor placement.
   */
  function openFilesInBalancedSplit(
    files: Array<{ filePath: string; isDir: boolean }>,
    direction: 'horizontal' | 'vertical' = 'horizontal'
  ): string[] {
    if (files.length === 0) return []
    // This replaces the whole layout (multi-cursor group creation), so drop
    // the buffers of every tab being discarded instead of leaking them.
    for (const leaf of getAllEditorLeaves(editorLayout.value)) {
      for (const tab of leaf.tabs) opts.onTabRemoved?.(tab)
    }
    const tree = buildBalancedTree(files, direction)
    editorLayout.value = tree
    const leaves = getAllEditorLeaves(tree)
    activeEditorLeafId.value = leaves[0]?.id ?? null
    return leaves.map((leaf) => leaf.id)
  }

  return {
    editorLayout,
    activeEditorLeafId,
    activeLeaf,
    activeTab,
    isSplit,
    leafCount,
    leafById,
    activateTab,
    openFileInActivePane,
    openFileInNewPane,
    duplicateActiveTabInNewPane,
    splitTabToEdge,
    moveTabToPane,
    reorderTabInLeaf,
    closeTab,
    closeTabs,
    closeEditorPane,
    removeLeafIfEmpty,
    focusEditorPane,
    focusLeaf,
    openFilesInBalancedSplit,
  }
}

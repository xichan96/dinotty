/** Editor split pane layout types — independent from terminal PaneLayout */

import { createEditorTab, syncLeafActive, type EditorTab } from './editorTabs'

export interface EditorLeafPane {
  type: 'editor-leaf'
  id: string
  /** Tabs open in this editor group. */
  tabs: EditorTab[]
  activeTabId: string | null
  /** Mirror of the active tab, kept for persistence and watchers. */
  filePath: string | null
  isDir: boolean
  ratio: number
  zoomed: boolean
}

export interface EditorSplitPane {
  type: 'editor-split'
  id: string
  direction: 'horizontal' | 'vertical'
  children: EditorPaneLayout[]
  ratios: number[]
}

export type EditorPaneLayout = EditorLeafPane | EditorSplitPane

let _editorIdCounter = 0
function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_editorIdCounter).toString(36)}`
}

export function genEditorLeafId(): string {
  return genId('el')
}

export function genEditorSplitId(): string {
  return genId('es')
}

/** Create a split node with equal ratios. */
export function createEditorSplit(
  direction: 'horizontal' | 'vertical',
  children: EditorPaneLayout[]
): EditorSplitPane {
  const ratio = children.length ? 1 / children.length : 1
  for (const child of children) {
    if (child.type === 'editor-leaf') child.ratio = ratio
  }
  return {
    type: 'editor-split',
    id: genEditorSplitId(),
    direction,
    children,
    ratios: children.map(() => ratio),
  }
}

/**
 * Migrate layouts persisted before tabs existed (a leaf had one filePath) and
 * repair an activeTabId that no longer points at an open tab. Mutates in place.
 */
export function normalizeEditorLayout(layout: EditorPaneLayout): EditorPaneLayout {
  if (layout.type === 'editor-leaf') {
    const leaf = layout as EditorLeafPane & {
      tabs?: EditorTab[]
      activeTabId?: string | null
    }
    if (!Array.isArray(leaf.tabs)) leaf.tabs = []
    if (leaf.filePath && !leaf.tabs.some((tab) => tab.filePath === leaf.filePath)) {
      leaf.tabs.push(createEditorTab(leaf.filePath, leaf.isDir))
    }
    if (!leaf.activeTabId || !leaf.tabs.some((tab) => tab.id === leaf.activeTabId)) {
      const remembered = leaf.filePath
        ? leaf.tabs.find((tab) => tab.filePath === leaf.filePath)
        : null
      leaf.activeTabId = remembered?.id ?? leaf.tabs[leaf.tabs.length - 1]?.id ?? null
    }
    syncLeafActive(leaf)
    return leaf
  }
  layout.children = layout.children.map(normalizeEditorLayout)
  return layout
}

/** Create a single leaf layout, optionally with one open tab. */
export function createEditorLeaf(filePath: string | null = null, isDir = false): EditorLeafPane {
  const tab = filePath ? createEditorTab(filePath, isDir) : null
  return {
    type: 'editor-leaf',
    id: genEditorLeafId(),
    tabs: tab ? [tab] : [],
    activeTabId: tab?.id ?? null,
    filePath,
    isDir,
    ratio: 1,
    zoomed: false,
  }
}

/** Find a leaf by id */
export function findEditorLeaf(layout: EditorPaneLayout, id: string): EditorLeafPane | null {
  if (layout.type === 'editor-leaf') return layout.id === id ? layout : null
  for (const child of layout.children) {
    const found = findEditorLeaf(child, id)
    if (found) return found
  }
  return null
}

/** Find the parent split that directly contains the given leaf id */
export function findParentEditorSplit(
  layout: EditorPaneLayout,
  leafId: string
): EditorSplitPane | null {
  if (layout.type !== 'editor-split') return null
  for (const child of layout.children) {
    if (child.type === 'editor-leaf' && child.id === leafId) return layout
    const found = findParentEditorSplit(child, leafId)
    if (found) return found
  }
  return null
}

/** Get all leaf nodes */
export function getAllEditorLeaves(layout: EditorPaneLayout): EditorLeafPane[] {
  if (layout.type === 'editor-leaf') return [layout]
  return layout.children.flatMap(getAllEditorLeaves)
}

/** Find the first leaf in tree order */
export function findFirstEditorLeaf(layout: EditorPaneLayout): EditorLeafPane | null {
  if (layout.type === 'editor-leaf') return layout
  for (const child of layout.children) {
    const found = findFirstEditorLeaf(child)
    if (found) return found
  }
  return null
}

/** Redistribute ratios equally among children of a split */
export function redistributeEditorRatios(split: EditorSplitPane): void {
  const n = split.children.length
  if (n === 0) return
  const r = 1 / n
  split.ratios = split.children.map(() => r)
  split.children.forEach((c) => {
    if (c.type === 'editor-leaf') c.ratio = r
  })
}

/** Replace a node (leaf or split) in the tree */
export function replaceEditorNode(
  root: EditorPaneLayout,
  target: EditorPaneLayout,
  replacement: EditorPaneLayout
): boolean {
  if (root.type !== 'editor-split') return false
  const idx = root.children.indexOf(target)
  if (idx !== -1) {
    root.children[idx] = replacement
    return true
  }
  for (const child of root.children) {
    if (replaceEditorNode(child, target, replacement)) return true
  }
  return false
}

/** Replace a leaf by id with a new node */
export function replaceEditorLeaf(
  root: EditorPaneLayout,
  leafId: string,
  replacement: EditorPaneLayout
): boolean {
  if (root.type !== 'editor-split') return false
  const idx = root.children.findIndex((c) => c.type === 'editor-leaf' && c.id === leafId)
  if (idx !== -1) {
    root.children[idx] = replacement
    return true
  }
  for (const child of root.children) {
    if (replaceEditorLeaf(child, leafId, replacement)) return true
  }
  return false
}

/** Remove a leaf by id, collapse single-child splits */
export function removeEditorLeaf(root: EditorPaneLayout, leafId: string): boolean {
  if (root.type !== 'editor-split') return false
  const idx = root.children.findIndex((c) => c.type === 'editor-leaf' && c.id === leafId)
  if (idx !== -1) {
    root.children.splice(idx, 1)
    root.ratios.splice(idx, 1)
    redistributeEditorRatios(root)
    return true
  }
  for (const child of root.children) {
    if (removeEditorLeaf(child, leafId)) {
      // Collapse single-child splits
      if (root.children.length === 1 && root.children[0].type === 'editor-split') {
        const onlyChild = root.children[0] as EditorSplitPane
        root.direction = onlyChild.direction
        root.children = onlyChild.children
        root.ratios = onlyChild.ratios
      }
      redistributeEditorRatios(root)
      return true
    }
  }
  return false
}

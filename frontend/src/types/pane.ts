import { randomId } from '../utils/id'
import { initializePaneMru } from './paneMru'

/** Pane kind. Missing/`terminal` -> PTY-backed; others have no PTY. */
export type PaneKind = 'terminal' | 'plugin' | 'files' | 'web'

/** 叶子节点：一个终端 Pane */
export interface LeafPane {
  type: 'leaf'
  /** Defaults to `terminal` when absent (legacy layouts). */
  kind?: PaneKind
  paneId: string
  title: string
  shell_type?: string // "ssh" for SSH tabs, shell name for local tabs
  ratio: number
  zoomed: boolean
  /** Required for kind=plugin. */
  pluginId?: string
  /** Required for kind=files. Absolute or workspace-relative path. */
  path?: string
  /** Required for kind=web. Full URL or :port/path. */
  url?: string
}

/** 分割容器：水平或垂直排列子节点 */
export interface SplitPane {
  type: 'split'
  id: string // Stable identifier for Vue key (survives reorder)
  direction: 'horizontal' | 'vertical'
  children: PaneLayout[]
  ratios: number[]
}

export type PaneLayout = LeafPane | SplitPane

/** Returns the pane kind, defaulting to `'terminal'` when absent. */
export function paneKind(leaf: LeafPane): PaneKind {
  return leaf.kind ?? 'terminal'
}

/** Drop position for iTerm2-style 4-zone drag-and-drop + editor center drop */
export type DropPosition = 'left' | 'right' | 'top' | 'bottom' | 'center'

/** Terminal tab with split pane layout */
export interface TerminalTab {
  type: 'terminal'
  paneId: string // Tab's stable identifier (not a leaf paneId)
  layout: PaneLayout
  activePaneId: string // Currently focused leaf pane
  paneMru: string[] // Runtime-only; most recently focused pane first
  broadcastMode: boolean
  broadcastActivity: number // Incremented on each broadcast input to re-trigger banner
  previewVisible: boolean
  previewAddress: string
  previewUrl: string
  previewKind: 'web' | 'files'
  customTitle?: string // User-set tab title (overrides shell title)
  cwd?: string // Current working directory (from backend)
  connectionId?: string // SSH profile ID when this tab is an SSH session from a profile
  workspaceId?: string // Explicit workspace assignment (set when SSH tab is created in a workspace)
}

/** Plugin tab */
export interface PluginTab {
  type: 'plugin'
  paneId: string
  title: string
  pluginId: string
  workspaceId?: string
}

export type Tab = TerminalTab | PluginTab

/** Migrate old tab format (with direct paneId) to new layout format */
export function migrateTab(raw: any): TerminalTab {
  // Legacy plugin tab -> TerminalTab with single plugin leaf.
  if (raw.type === 'plugin') {
    const paneId = raw.paneId
    return {
      type: 'terminal',
      paneId,
      layout: ensureSplitRoot({
        type: 'leaf',
        kind: 'plugin',
        paneId,
        title: raw.title ?? 'Plugin',
        ratio: 1,
        zoomed: false,
        pluginId: raw.pluginId,
      }),
      activePaneId: paneId,
      paneMru: [paneId],
      broadcastMode: false,
      broadcastActivity: 0,
      previewVisible: false,
      previewAddress: '',
      previewUrl: '',
      previewKind: 'web',
      workspaceId: raw.workspaceId,
    }
  }
  if (raw.paneId && !raw.layout) {
    return {
      type: 'terminal',
      paneId: raw.paneId,
      layout: ensureSplitRoot({
        type: 'leaf',
        kind: 'terminal',
        paneId: raw.paneId,
        title: raw.title ?? 'Terminal',
        ratio: 1,
        zoomed: false,
      }),
      activePaneId: raw.paneId,
      paneMru: [raw.paneId],
      broadcastMode: false,
      broadcastActivity: 0,
      previewVisible: raw.previewVisible ?? false,
      previewAddress: raw.previewAddress ?? '',
      previewUrl: raw.previewUrl ?? '',
      previewKind: raw.previewKind ?? 'web',
      connectionId: raw.connectionId,
      cwd: raw.cwd,
      workspaceId: raw.workspaceId,
    }
  }
  const tab = raw as TerminalTab
  const paneIds = getAllLeaves(tab.layout).map((leaf) => leaf.paneId)
  return {
    ...tab,
    paneMru: initializePaneMru(paneIds, tab.activePaneId),
  }
}

/**
 * If a tab has legacy preview state (previewVisible=true with a kind/path/url),
 * add a corresponding leaf to the layout. This converts side previews into
 * layout leaves so they participate in drag/split/close like any other pane.
 */
export function migratePreviewToLeaf(tab: TerminalTab): TerminalTab {
  if (!tab.previewVisible) return tab
  const kind = tab.previewKind
  if (kind !== 'files' && kind !== 'web') return tab

  // Generate a new paneId for the preview leaf.
  const newPaneId = 'leaf-' + randomId()
  const leaf: PaneLayout =
    kind === 'files'
      ? {
          type: 'leaf',
          kind: 'files',
          paneId: newPaneId,
          title: tab.previewAddress || 'Files',
          ratio: 1,
          zoomed: false,
          path: tab.previewAddress,
        }
      : {
          type: 'leaf',
          kind: 'web',
          paneId: newPaneId,
          title: tab.previewUrl || 'Web',
          ratio: 1,
          zoomed: false,
          url: tab.previewUrl,
        }

  // Wrap existing layout in a horizontal split with the preview on the right.
  const root = ensureSplitRoot(tab.layout)
  const newSplit: SplitPane = {
    type: 'split',
    id: genSplitId(),
    direction: 'horizontal',
    children: [root, leaf],
    ratios: [0.7, 0.3],
  }

  return {
    ...tab,
    layout: newSplit,
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
    paneMru: initializePaneMru(
      [...getAllLeaves(newSplit).map((l) => l.paneId)],
      tab.activePaneId
    ),
  }
}

/** Find a leaf node by paneId in the layout tree */
export function findLeaf(node: PaneLayout, paneId: string): LeafPane | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null
  for (const child of node.children) {
    const found = findLeaf(child, paneId)
    if (found) return found
  }
  return null
}

/** Find the parent SplitPane that directly contains the given paneId */
export function findParentSplit(node: PaneLayout, paneId: string): SplitPane | null {
  if (node.type === 'leaf') return null
  for (const child of node.children) {
    if (child.type === 'leaf' && child.paneId === paneId) return node
    const found = findParentSplit(child, paneId)
    if (found) return found
  }
  return null
}

/** Check if a node is a split with only one child (collapsed split) */
export function isSingleChildSplit(node: PaneLayout): boolean {
  return node.type === 'split' && node.children.length === 1
}

/** Get all leaf nodes in order */
export function getAllLeaves(node: PaneLayout): LeafPane[] {
  if (node.type === 'leaf') return [node]
  return node.children.flatMap((c) => getAllLeaves(c))
}

/** Find the first leaf in the tree */
export function findFirstLeaf(node: PaneLayout): LeafPane {
  if (node.type === 'leaf') return node
  return findFirstLeaf(node.children[0])
}

/** Replace a leaf node by paneId with a new PaneLayout */
export function replaceLeaf(node: PaneLayout, paneId: string, replacement: PaneLayout): boolean {
  if (node.type === 'split') {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      if (child.type === 'leaf' && child.paneId === paneId) {
        node.children[i] = replacement
        return true
      }
      if (replaceLeaf(child, paneId, replacement)) return true
    }
  }
  return false
}

/** Replace a specific node in the tree with another node */
export function replaceNode(
  root: PaneLayout,
  target: PaneLayout,
  replacement: PaneLayout
): boolean {
  if (root.type === 'split') {
    for (let i = 0; i < root.children.length; i++) {
      if (root.children[i] === target) {
        root.children[i] = replacement
        return true
      }
      if (replaceNode(root.children[i], target, replacement)) return true
    }
  }
  return false
}

/** Redistribute ratios equally among children of a split node */
export function redistributeRatios(split: SplitPane) {
  const n = split.children.length
  const ratio = 1 / n
  split.ratios = Array(n).fill(ratio)
  split.children.forEach((c) => {
    if (c.type === 'leaf') c.ratio = ratio
  })
}

/** Clear all zoomed states in the tree */
export function clearAllZoom(node: PaneLayout) {
  if (node.type === 'leaf') {
    node.zoomed = false
  } else {
    node.children.forEach((c) => clearAllZoom(c))
  }
}

/** Equalize all ratios recursively */
export function equalizeRecursive(node: PaneLayout) {
  if (node.type === 'leaf') return
  const n = node.children.length
  const ratio = 1 / n
  node.ratios = Array(n).fill(ratio)
  node.children.forEach((c) => {
    if (c.type === 'leaf') c.ratio = ratio
    else equalizeRecursive(c)
  })
}

/**
 * Remove a leaf from its parent split. If the parent ends up with one child,
 * collapse it by replacing the parent with the remaining child.
 * Returns the removed leaf, or null if not found.
 */
export function removeLeaf(root: PaneLayout, paneId: string): LeafPane | null {
  const parent = findParentSplit(root, paneId)
  if (!parent) {
    // The leaf is the root — can't remove
    if (root.type === 'leaf' && root.paneId === paneId) return root
    return null
  }

  const idx = parent.children.findIndex((c) => c.type === 'leaf' && c.paneId === paneId)
  if (idx === -1) return null

  const removed = parent.children.splice(idx, 1)[0] as LeafPane
  parent.ratios.splice(idx, 1)
  redistributeRatios(parent)

  // If only one child left, collapse the split
  // Note: when parent === root, replaceNode can't find root as its own child.
  // Callers should check for single-child root split after calling removeLeaf.
  if (parent.children.length === 1 && parent !== root) {
    const remaining = parent.children[0]
    replaceNode(root, parent, remaining)
  }

  return removed
}

/** Generate a stable ID for a SplitPane */
export function genSplitId(): string {
  return 's-' + randomId()
}

/** Map any position/axis direction string onto the axis union type.
 *
 * Backend `insert_subtree_into_layout` historically stored `"left"` /
 * `"right"` / `"top"` / `"bottom"` as the split `direction` field (now
 * normalized on write, but localStorage may still hold legacy values).
 * Frontend `SplitContainer` / `SplitDivider` only handle `"horizontal"` /
 * `"vertical"`, so we coerce here on read to self-heal stale data. */
function normalizeDirection(direction: string | undefined): 'horizontal' | 'vertical' {
  return direction === 'vertical' || direction === 'top' || direction === 'bottom'
    ? 'vertical'
    : 'horizontal'
}

/** Recursively ensure every split node has a valid axis direction. */
function normalizeSplitTree(layout: PaneLayout): void {
  if (layout.type !== 'split') return
  layout.direction = normalizeDirection(layout.direction)
  for (const child of layout.children) normalizeSplitTree(child)
}

/** Ensure a SplitPane has an id (for deserialized/migrated data) */
export function ensureSplitId(split: SplitPane): SplitPane {
  if (!split.id) split.id = genSplitId()
  normalizeSplitTree(split)
  return split
}

/** Wrap a leaf layout in a single-child split so the root is always a SplitPane */
export function ensureSplitRoot(layout: PaneLayout): SplitPane {
  if (layout.type === 'split') return ensureSplitId(layout)
  return {
    type: 'split',
    id: genSplitId(),
    direction: 'horizontal',
    children: [layout],
    ratios: [1.0],
  }
}

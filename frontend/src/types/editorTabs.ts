/** A file tab inside one editor group (leaf pane). */
export interface EditorTab {
  id: string
  filePath: string
  isDir: boolean
  /** Preview tabs are italic and can be replaced by the next preview open. */
  preview: boolean
}

/** The slice of an editor group that tab operations need. */
export interface TabHost {
  tabs: EditorTab[]
  activeTabId: string | null
  /** Mirrors the active tab; kept for persistence and workspace watchers. */
  filePath: string | null
  isDir: boolean
}

let _tabIdCounter = 0

export function genEditorTabId(): string {
  return `et-${Date.now().toString(36)}-${(++_tabIdCounter).toString(36)}`
}

export function createEditorTab(
  filePath: string,
  isDir = false,
  preview = false
): EditorTab {
  return { id: genEditorTabId(), filePath, isDir, preview }
}

export function getActiveTab(leaf: TabHost): EditorTab | null {
  if (!leaf.activeTabId) return null
  return leaf.tabs.find((tab) => tab.id === leaf.activeTabId) ?? null
}

export function findTab(leaf: TabHost, tabId: string): EditorTab | null {
  return leaf.tabs.find((tab) => tab.id === tabId) ?? null
}

export function findTabByPath(leaf: TabHost, filePath: string): EditorTab | null {
  return leaf.tabs.find((tab) => tab.filePath === filePath) ?? null
}

/** Keep the legacy leaf.filePath/isDir mirror in sync with the active tab. */
export function syncLeafActive(leaf: TabHost): void {
  const tab = getActiveTab(leaf)
  leaf.filePath = tab?.filePath ?? null
  leaf.isDir = tab?.isDir ?? false
}

export function activateTab(leaf: TabHost, tabId: string): boolean {
  if (!findTab(leaf, tabId)) return false
  leaf.activeTabId = tabId
  syncLeafActive(leaf)
  return true
}

export function pinTab(leaf: TabHost, tabId: string): boolean {
  const tab = findTab(leaf, tabId)
  if (!tab || !tab.preview) return false
  tab.preview = false
  return true
}

export interface OpenTabOptions {
  /** Opening a pinned tab never becomes the next replaceable preview. */
  pin?: boolean
  /** Set false to disable preview semantics for this open. */
  preview?: boolean
  isDirty?: (tab: EditorTab) => boolean
}

export interface OpenTabResult {
  tab: EditorTab
  /** A brand new tab was appended. */
  created: boolean
  /** An existing preview tab was retargeted at the new path. */
  replaced: boolean
}

/**
 * Open (or reveal) a file in one group. Follows VS Code's preview rules:
 * an existing path activates its tab; otherwise a clean preview tab is reused
 * when possible, falling back to a new tab inserted after the active one.
 */
export function openTab(
  leaf: TabHost,
  filePath: string,
  isDir = false,
  opts: OpenTabOptions = {}
): OpenTabResult {
  const existing = findTabByPath(leaf, filePath)
  if (existing) {
    if (opts.pin) existing.preview = false
    activateTab(leaf, existing.id)
    return { tab: existing, created: false, replaced: false }
  }

  const wantsPreview = opts.preview !== false && !opts.pin
  if (wantsPreview) {
    const reusable = leaf.tabs.find(
      (tab) => tab.preview && !(opts.isDirty ? opts.isDirty(tab) : false)
    )
    if (reusable) {
      reusable.filePath = filePath
      reusable.isDir = isDir
      reusable.preview = true
      activateTab(leaf, reusable.id)
      return { tab: reusable, created: false, replaced: true }
    }
  }

  const tab = createEditorTab(filePath, isDir, wantsPreview)
  const activeIdx = leaf.activeTabId
    ? leaf.tabs.findIndex((item) => item.id === leaf.activeTabId)
    : -1
  leaf.tabs.splice(activeIdx >= 0 ? activeIdx + 1 : leaf.tabs.length, 0, tab)
  leaf.activeTabId = tab.id
  syncLeafActive(leaf)
  return { tab, created: true, replaced: false }
}

export interface CloseTabResult {
  closed: EditorTab | null
  /** Active tab after the close, or null when the group is now empty. */
  nextActiveId: string | null
}

export function closeTab(leaf: TabHost, tabId: string): CloseTabResult {
  const idx = leaf.tabs.findIndex((tab) => tab.id === tabId)
  if (idx < 0) return { closed: null, nextActiveId: leaf.activeTabId }
  const [closed] = leaf.tabs.splice(idx, 1)
  if (leaf.activeTabId === tabId) {
    // VS Code activates the right neighbour first, then the left one.
    const next = leaf.tabs[idx] ?? leaf.tabs[idx - 1] ?? null
    leaf.activeTabId = next?.id ?? null
  }
  syncLeafActive(leaf)
  return { closed, nextActiveId: leaf.activeTabId }
}

/** Remove a set of tabs, keeping the active tab when it survives. */
export function closeTabs(leaf: TabHost, tabIds: Iterable<string>): EditorTab[] {
  const remove = new Set(tabIds)
  if (!remove.size) return []
  const closed = leaf.tabs.filter((tab) => remove.has(tab.id))
  if (!closed.length) return []
  leaf.tabs = leaf.tabs.filter((tab) => !remove.has(tab.id))
  if (!leaf.activeTabId || !leaf.tabs.some((tab) => tab.id === leaf.activeTabId)) {
    leaf.activeTabId = leaf.tabs[0]?.id ?? null
  }
  syncLeafActive(leaf)
  return closed
}

/** Detach a tab without choosing a replacement (used by move/split). */
export function takeTab(leaf: TabHost, tabId: string): EditorTab | null {
  const idx = leaf.tabs.findIndex((tab) => tab.id === tabId)
  if (idx < 0) return null
  const [tab] = leaf.tabs.splice(idx, 1)
  if (leaf.activeTabId === tabId) {
    const next = leaf.tabs[idx] ?? leaf.tabs[idx - 1] ?? null
    leaf.activeTabId = next?.id ?? null
  }
  syncLeafActive(leaf)
  return tab
}

export function insertTab(leaf: TabHost, tab: EditorTab, index = leaf.tabs.length): void {
  const at = Math.max(0, Math.min(index, leaf.tabs.length))
  leaf.tabs.splice(at, 0, tab)
  leaf.activeTabId = tab.id
  tab.preview = false
  syncLeafActive(leaf)
}

export function reorderTab(
  leaf: TabHost,
  tabId: string,
  targetTabId: string,
  after: boolean
): boolean {
  if (tabId === targetTabId) return false
  const from = leaf.tabs.findIndex((tab) => tab.id === tabId)
  if (from < 0) return false
  const [tab] = leaf.tabs.splice(from, 1)
  let to = leaf.tabs.findIndex((item) => item.id === targetTabId)
  if (to < 0) to = leaf.tabs.length
  else if (after) to += 1
  leaf.tabs.splice(to, 0, tab)
  leaf.activeTabId = tabId
  syncLeafActive(leaf)
  return true
}

export function moveTab(source: TabHost, target: TabHost, tabId: string): boolean {
  if (source === target) return false
  const tab = takeTab(source, tabId)
  if (!tab) return false
  insertTab(target, tab)
  return true
}

export function tabsRightOf(leaf: TabHost, tabId: string): EditorTab[] {
  const idx = leaf.tabs.findIndex((tab) => tab.id === tabId)
  return idx < 0 ? [] : leaf.tabs.slice(idx + 1)
}

export function tabsExcept(leaf: TabHost, tabId: string): EditorTab[] {
  return leaf.tabs.filter((tab) => tab.id !== tabId)
}

export function savedTabs(leaf: TabHost, isDirty: (tab: EditorTab) => boolean): EditorTab[] {
  return leaf.tabs.filter((tab) => !isDirty(tab))
}

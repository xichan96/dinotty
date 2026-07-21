import { defineStore } from 'pinia'
import { ref, computed, nextTick } from 'vue'
import type { Tab, TerminalTab, PluginTab } from '../types/pane'
import type { Workspace } from '../types/workspace'
import type { TabInfo } from '../components/terminal/TabBar.vue'
import { findLeaf, findFirstLeaf, getAllLeaves } from '../types/pane'
import { DEFAULT_WORKSPACE_ID, useWorkspaces } from '../composables/useWorkspaces'
import { resolveAbbr, resolveColor } from '../utils/workspaceIcon'

export const useSessionStore = defineStore('session', () => {
  // ── State ──────────────────────────────────────────────

  const tabs = ref<Tab[]>([])
  const activePaneId = ref<string | null>(null)

  // ── Getters ────────────────────────────────────────────

  /** Currently active tab (or undefined) */
  const activeTab = computed(() => tabs.value.find((t) => t.paneId === activePaneId.value))

  const { workspaces, defaultWorkspace, matchWorkspace } = useWorkspaces()

  function buildWorkspace(ws: Workspace): TabInfo['workspace'] {
    const fallback = Array.from(ws.name).slice(0, 3).join('')
    const isDefault = ws.id === DEFAULT_WORKSPACE_ID
    return {
      id: ws.id,
      abbr: isDefault ? resolveAbbr(ws) : ws.abbr || fallback || undefined,
      name: ws.name,
      color: isDefault ? resolveColor(ws) : ws.color,
      remote: !!ws.connection_id,
    }
  }

  function visibleWorkspaceBadge(ws: Workspace): TabInfo['workspace'] {
    return ws.id === DEFAULT_WORKSPACE_ID && ws.tab_badge === false
      ? undefined
      : buildWorkspace(ws)
  }

  /** Tab list for TabBar component */
  const tabList = computed<TabInfo[]>(() =>
    tabs.value.map((t, i) => {
      const info: TabInfo = {
        paneId: t.paneId,
        title:
          t.type === 'terminal'
            ? (t.customTitle ?? findLeaf(t.layout, t.activePaneId)?.title ?? 'Terminal')
            : t.title,
        index: i + 1,
        type: t.type,
        shellType: t.type === 'terminal' ? findLeaf(t.layout, t.activePaneId)?.shell_type : undefined,
      }
      if (t.type === 'terminal') {
        const ws = matchWorkspace(t.cwd ?? '', t.connectionId, t.workspaceId) ?? defaultWorkspace.value
        info.workspace = visibleWorkspaceBadge(ws)
      } else {
        const ws = t.workspaceId
          ? workspaces.value.find((w) => w.id === t.workspaceId)
          : defaultWorkspace.value
        if (ws) info.workspace = visibleWorkspaceBadge(ws)
      }
      return info
    })
  )

  /** Type of the currently active tab */
  const activeTabType = computed(() => activeTab.value?.type ?? 'terminal')

  /** Whether broadcast mode is currently active (enabled + multiple panes) */
  const isBroadcastActive = computed(() => {
    const tab = activeTab.value
    return tab?.type === 'terminal' && tab.broadcastMode && getAllLeaves(tab.layout).length > 1
  })

  /** Whether the active tab has multiple panes (can enable broadcast) */
  const canBroadcast = computed(() => {
    const tab = activeTab.value
    return tab?.type === 'terminal' && getAllLeaves(tab.layout).length > 1
  })

  /** Map of paneId → title for all panes across all tabs */
  const paneLabels = computed(() => {
    const m: Record<string, string> = {}
    for (const t of tabs.value) {
      if (t.type === 'terminal') {
        for (const leaf of getAllLeaves(t.layout)) {
          m[leaf.paneId] = leaf.title
        }
      } else {
        m[t.paneId] = t.title
      }
    }
    return m
  })

  // ── Actions ────────────────────────────────────────────

  /** Add a new tab and optionally activate it */
  function addTab(tab: Tab, activate = true) {
    // Dedup: don't add if a tab with the same paneId already exists
    if (tabs.value.some((t) => t.paneId === tab.paneId)) {
      if (activate) activePaneId.value = tab.paneId
      return
    }
    tabs.value.push(tab)
    if (activate) activePaneId.value = tab.paneId
  }

  /** Remove a tab by paneId. Returns the removed tab or null. */
  function removeTab(tabId: string): Tab | null {
    const idx = tabs.value.findIndex((t) => t.paneId === tabId)
    if (idx === -1) return null

    const [removed] = tabs.value.splice(idx, 1)

    // If this was the active tab, switch to the nearest remaining tab
    if (activePaneId.value === tabId && tabs.value.length > 0) {
      const newIdx = Math.min(idx, tabs.value.length - 1)
      activePaneId.value = tabs.value[newIdx].paneId
    }

    return removed
  }

  /** Set the active tab by paneId */
  function setActivePane(paneId: string) {
    activePaneId.value = paneId
  }

  /** Find a tab by its paneId */
  function findTab(paneId: string): Tab | undefined {
    return tabs.value.find((t) => t.paneId === paneId)
  }

  /** Find the active terminal tab (or null) */
  function getActiveTerminal(): TerminalTab | null {
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    if (!tab || tab.type !== 'terminal') return null
    return tab
  }

  /** Reorder tabs by moving from fromId position to toId position */
  function reorderTab(fromId: string, toId: string) {
    const fromIdx = tabs.value.findIndex((t) => t.paneId === fromId)
    const toIdx = tabs.value.findIndex((t) => t.paneId === toId)
    if (fromIdx === -1 || toIdx === -1) return
    const [moved] = tabs.value.splice(fromIdx, 1)
    tabs.value.splice(toIdx, 0, moved)
  }

  /** Rename a terminal tab's custom title. Pass empty string to clear. */
  function renameTab(tabId: string, title: string) {
    const tab = tabs.value.find((t) => t.paneId === tabId)
    if (!tab || tab.type !== 'terminal') return
    tab.customTitle = title || undefined
  }

  /** Replace the entire tabs array (used during sync restore) */
  function setTabs(newTabs: Tab[]) {
    tabs.value = newTabs
  }

  return {
    // State
    tabs,
    activePaneId,

    // Getters
    activeTab,
    tabList,
    activeTabType,
    isBroadcastActive,
    canBroadcast,
    paneLabels,

    // Actions
    addTab,
    removeTab,
    setActivePane,
    findTab,
    getActiveTerminal,
    reorderTab,
    renameTab,
    setTabs,
  }
})

import { getCurrentScope, onScopeDispose } from 'vue'
import { useSessionStore } from '../stores/sessionStore'
import { getAllLeaves, type Tab } from '../types/pane'
import { currentRevealNavGen, nextRevealNavGen } from '../utils/navGen'
import { pickSupervisedTab, type TabCandidate } from '../utils/superviseTabs'
import { useNotification } from './useNotification'
import { useWorkspaces } from './useWorkspaces'

function paneIdsOf(tab: Tab): string[] {
  if (tab.type === 'plugin') return [tab.paneId]
  return [tab.paneId, ...getAllLeaves(tab.layout).map((leaf) => leaf.paneId)]
}

export function useSuperviseTabs() {
  const session = useSessionStore()
  const { workspaces, matchWorkspace } = useWorkspaces()
  const { firstUnreadAtByPane } = useNotification()
  const pending = new Map<string, number>()
  const activeWatchdogs = new Set<ReturnType<typeof setTimeout>>()
  const pendingRaceResolvers = new Set<() => void>()
  let tokenCounter = 0
  let disposed = false

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      for (const timeoutId of activeWatchdogs) clearTimeout(timeoutId)
      activeWatchdogs.clear()
      for (const resolve of pendingRaceResolvers) resolve()
      pendingRaceResolvers.clear()
      pending.clear()
    })
  }

  function reminderAt(tab: Tab): number | null {
    let oldest: number | null = null
    for (const paneId of paneIdsOf(tab)) {
      const timestamp = firstUnreadAtByPane[paneId]
      if (timestamp === null || timestamp === undefined) continue
      if (oldest === null || timestamp < oldest) oldest = timestamp
    }
    return oldest
  }

  function orderedCandidates(): TabCandidate[] {
    const orderedTabs: Tab[] = []
    const orderedTabIds = new Set<string>()
    const sortedWorkspaces = [...workspaces.value].sort((a, b) => a.order - b.order)

    for (const workspace of sortedWorkspaces) {
      for (const tab of session.tabs) {
        const matchedWorkspace =
          tab.type === 'terminal'
            ? matchWorkspace(tab.cwd ?? '', tab.connectionId, tab.workspaceId)
            : tab.workspaceId
              ? (workspaces.value.find((item) => item.id === tab.workspaceId) ?? null)
              : null
        if (matchedWorkspace?.id !== workspace.id || orderedTabIds.has(tab.paneId)) continue
        orderedTabs.push(tab)
        orderedTabIds.add(tab.paneId)
      }
    }

    for (const tab of session.tabs) {
      if (orderedTabIds.has(tab.paneId)) continue
      orderedTabs.push(tab)
      orderedTabIds.add(tab.paneId)
    }

    return orderedTabs
      .filter((tab) => tab.type !== 'plugin')
      .map((tab) => ({
        id: tab.paneId,
        reminderAt: reminderAt(tab),
      }))
  }

  async function supervise(activate: (id: string) => Promise<boolean>): Promise<boolean> {
    if (disposed) return false

    const result = pickSupervisedTab({
      tabs: orderedCandidates(),
      currentTabId: session.activePaneId,
      pendingTabIds: new Set(pending.keys()),
    })

    if (result.targetTabId === null) return false

    const target = result.targetTabId
    const token = ++tokenCounter
    pending.set(target, token)

    const settle = () => {
      // Token identity keeps a late attempt from mutating a newer reservation of this tab.
      if (pending.get(target) !== token) return
      pending.delete(target)
    }

    let activation: Promise<boolean>
    try {
      activation = activate(target)
    } catch {
      settle()
      return false
    }
    // If activate() synchronously disposed the scope, skip watchdog registration —
    // onScopeDispose has already run and would not clean up a watchdog registered now.
    if (disposed) {
      settle()
      void activation.catch(() => {})
      return false
    }
    const attemptGen = currentRevealNavGen()

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let raceResolver: (() => void) | null = null
    const activationSettled = Promise.resolve(activation)
      .then(
        (activated) => {
          settle()
          return !!activated
        },
        () => {
          settle()
          return false
        },
      )
      .finally(() => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId)
          activeWatchdogs.delete(timeoutId)
        }
        if (raceResolver !== null) pendingRaceResolvers.delete(raceResolver)
      })
    const timedOut = new Promise<boolean>((resolve) => {
      const resolveFalse = () => resolve(false)
      raceResolver = resolveFalse
      pendingRaceResolvers.add(resolveFalse)
      const watchdogId = setTimeout(() => {
        activeWatchdogs.delete(watchdogId)
        timeoutId = null
        if (pending.get(target) === token) {
          pending.delete(target)
          if (currentRevealNavGen() === attemptGen) {
            // Superseding the abandoned navigation prevents it from committing after the timeout.
            nextRevealNavGen()
          }
        }
        pendingRaceResolvers.delete(resolveFalse)
        resolveFalse()
      }, 10_000)
      timeoutId = watchdogId
      activeWatchdogs.add(watchdogId)
    })

    return await Promise.race([activationSettled, timedOut])
  }

  return { supervise }
}

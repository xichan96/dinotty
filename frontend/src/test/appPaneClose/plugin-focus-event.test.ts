import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountWithTabs } from './_setup'
import { useSessionStore } from '../../stores/sessionStore'
import type { Tab } from '../../types/pane'

// keyboard-plugin-design.md §三 B / Phase 2: plugins must react to which
// terminal is focused without polling. The host exposes onDidChangeActivePane
// on the plugin terminal API; this guards it end to end through App.vue.

const terminalLeaf = (paneId: string): Tab => ({
  type: 'terminal',
  paneId,
  layout: { type: 'leaf', paneId, title: paneId, ratio: 1, zoomed: false },
  activePaneId: paneId,
  paneMru: [paneId],
  broadcastMode: false,
  broadcastActivity: 0,
})

describe('App.vue - plugin focus event (onDidChangeActivePane)', () => {
  it('fires with the focused leaf when the active pane changes', async () => {
    await mountWithTabs()
    const session = useSessionStore()
    session.setTabs([terminalLeaf('t1'), terminalLeaf('t2')])
    session.setActivePane('t1')
    await nextTick()

    const api = window.__dinotty_terminal_api!
    expect(api.activePaneId()).toBe('t1')

    const changes: (string | null)[] = []
    const sub = api.onDidChangeActivePane((paneId) => changes.push(paneId))

    session.setActivePane('t2')
    await nextTick()
    expect(changes).toEqual(['t2'])
    expect(api.activePaneId()).toBe('t2')

    sub.dispose()
    session.setActivePane('t1')
    await nextTick()
    expect(changes).toEqual(['t2'])
  })

  it('reports the top-level pane id when the active tab is not a terminal', async () => {
    await mountWithTabs()
    const session = useSessionStore()
    const mixedTab: Tab = {
      type: 'plugin',
      paneId: 'plugin-leaf',
      title: 'Plugin',
      pluginId: 'memory',
    }
    session.setTabs([terminalLeaf('t1'), mixedTab])
    session.setActivePane('t1')
    await nextTick()

    const api = window.__dinotty_terminal_api!
    const changes: (string | null)[] = []
    const sub = api.onDidChangeActivePane((paneId) => changes.push(paneId))

    session.setActivePane('plugin-leaf')
    await nextTick()

    expect(changes).toEqual(['plugin-leaf'])
    sub.dispose()
  })
})

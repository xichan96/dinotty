import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import {
  usePluginOverlaysStore,
  MAX_OVERLAY_FAILURES,
  type RegisteredOverlay,
} from '../../stores/pluginOverlays'
import { settings } from '../../composables/useSettings'
import type { OverlayContribution } from '../../../../plugin-api/index'

const stub = defineComponent({ render: () => null })

function item(partial: Partial<OverlayContribution> & { id: string }): OverlayContribution {
  return { component: stub, ...partial }
}

describe('pluginOverlays store (overlay contribution registry, §五)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // settings is a module-global reactive; reset prefs so tests don't leak.
    settings.plugin_prefs = { hidden_toolbar: [], hidden_overlays: [], show_incompatible: false }
  })

  it('registers overlays under their plugin id', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'p1:fab' })])
    expect(store.overlays).toHaveLength(1)
    const o = store.overlays[0] as RegisteredOverlay
    expect(o.pluginId).toBe('p1')
    expect(o.id).toBe('p1:fab')
    expect(o.autoHidden).toBe(false)
  })

  it('dedupes by id across registrations', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'dup' })])
    store.register('p2', [item({ id: 'dup' })])
    expect(store.overlays).toHaveLength(1)
    expect(store.overlays[0].pluginId).toBe('p1')
  })

  it('hides when defaultVisible is false', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a', defaultVisible: false })])
    expect(store.isVisible(store.overlays[0] as RegisteredOverlay)).toBe(false)
  })

  it('evaluates visible() exactly once at registration and honors a false result', () => {
    const store = usePluginOverlaysStore()
    const visible = vi.fn(() => false)
    store.register('p1', [item({ id: 'a', visible })])
    expect(visible).toHaveBeenCalledTimes(1)
    expect(store.isVisible(store.overlays[0] as RegisteredOverlay)).toBe(false)
  })

  it('lets visible() true override defaultVisible false', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a', defaultVisible: false, visible: () => true })])
    expect(store.isVisible(store.overlays[0] as RegisteredOverlay)).toBe(true)
  })

  it('treats a throwing visible() as visible', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [
      item({
        id: 'a',
        defaultVisible: false,
        visible: () => {
          throw new Error('boom')
        },
      }),
    ])
    expect(store.isVisible(store.overlays[0] as RegisteredOverlay)).toBe(true)
  })

  it('does not re-evaluate visible() later (no polling)', () => {
    const store = usePluginOverlaysStore()
    const visible = vi.fn(() => false)
    store.register('p1', [item({ id: 'a', visible })])
    expect(visible).toHaveBeenCalledTimes(1)
    store.isVisible(store.overlays[0] as RegisteredOverlay)
    store.isVisible(store.overlays[0] as RegisteredOverlay)
    expect(visible).toHaveBeenCalledTimes(1)
  })

  it('unregister removes only that plugin overlays', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'p1:a' }), item({ id: 'p1:b' })])
    store.register('p2', [item({ id: 'p2:c' })])
    store.unregister('p1')
    expect(store.overlays.map((o) => o.id)).toEqual(['p2:c'])
  })

  it('autoHides after MAX_OVERLAY_FAILURES render errors', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a' })])
    for (let i = 0; i < MAX_OVERLAY_FAILURES; i++) {
      store.reportError('a', new Error(`e${i}`))
    }
    const o = store.overlays[0] as RegisteredOverlay
    expect(o.autoHidden).toBe(true)
    expect(store.isVisible(o)).toBe(false)
    expect(o.lastError).toMatch(/e4/)
  })

  it('reportError for an unknown id is a no-op', () => {
    const store = usePluginOverlaysStore()
    expect(() => store.reportError('nope', new Error('x'))).not.toThrow()
  })

  it('setUserVisible(false) hides via the persistent pref', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a' })])
    const o = store.overlays[0] as RegisteredOverlay
    expect(store.isVisible(o)).toBe(true)
    store.setUserVisible('a', false)
    expect(store.isVisible(o)).toBe(false)
    expect(settings.plugin_prefs.hidden_overlays).toContain('a')
  })

  it('setUserVisible(true) shows again and revives a session-dismissed overlay', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a' })])
    const o = store.overlays[0] as RegisteredOverlay
    store.hideOverlay('a') // right-click close (session)
    expect(store.isVisible(o)).toBe(false)
    store.setUserVisible('a', true) // plugin-tab re-enable
    expect(store.isVisible(o)).toBe(true)
    expect(settings.plugin_prefs.hidden_overlays).not.toContain('a')
  })

  it('keeps a user hide after a settings reload that returns the pref', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a' })])
    store.setUserVisible('a', false)
    expect(store.isVisible(store.overlays[0] as RegisteredOverlay)).toBe(false)

    // SettingsPanel re-fetches settings on every open (Object.assign). The server
    // round-trip payload must keep hidden_overlays or the user's toggle is wiped
    // (regression: the backend PluginPrefsConfig was missing the field).
    Object.assign(settings, {
      plugin_prefs: { hidden_toolbar: [], hidden_overlays: ['a'], show_incompatible: false },
    })
    expect(store.isVisible(store.overlays[0] as RegisteredOverlay)).toBe(false)
  })

  it('unregister clears session-hidden ids but keeps the persistent pref', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a' })])
    store.hideOverlay('a')
    store.setUserVisible('a', false)
    store.unregister('p1')
    // overlay gone; pref stays (it may be re-registered later and must stay off)
    expect(settings.plugin_prefs.hidden_overlays).toContain('a')
    expect(store.overlays).toHaveLength(0)
  })

  it('tracks a single reposition target via setReposition', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a' }), item({ id: 'b' })])
    expect(store.repositionId).toBeNull()
    store.setReposition('a')
    expect(store.repositionId).toBe('a')
    store.setReposition('b') // switching target replaces
    expect(store.repositionId).toBe('b')
    store.setReposition(null)
    expect(store.repositionId).toBeNull()
  })

  it('re-enables a defaultHidden overlay for the session via setUserVisible(true)', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a', defaultVisible: false })])
    const o = store.overlays[0] as RegisteredOverlay
    expect(store.isVisible(o)).toBe(false)
    store.setUserVisible('a', true) // plugin-tab re-enable overrides defaultHidden
    expect(store.isVisible(o)).toBe(true)
    expect(settings.plugin_prefs.hidden_overlays).not.toContain('a')
    store.setUserVisible('a', false)
    expect(store.isVisible(o)).toBe(false)
    store.setUserVisible('a', true)
    expect(store.isVisible(o)).toBe(true)
  })

  it('unregister clears the forcedVisible override', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a', defaultVisible: false })])
    store.setUserVisible('a', true)
    expect(store.isVisible(store.overlays[0] as RegisteredOverlay)).toBe(true)
    store.unregister('p1')
    store.register('p2', [item({ id: 'a', defaultVisible: false })])
    expect(store.isVisible(store.overlays[0] as RegisteredOverlay)).toBe(false)
  })

  it('unregister clears a stale reposition target', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [item({ id: 'a' })])
    store.setReposition('a')
    expect(store.repositionId).toBe('a')
    store.unregister('p1')
    expect(store.repositionId).toBeNull()
  })
})

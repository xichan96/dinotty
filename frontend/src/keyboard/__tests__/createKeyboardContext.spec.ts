import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

// Breaks the useSettings -> ... -> usePluginLoader -> useEventBridge ->
// useSyncWebSocket -> usePluginLoader cycle (same known issue as
// terminalInput.spec.ts; onEvent is undefined when the cycle is entered
// via useSettings first).
vi.mock('../../composables/useEventBridge', () => ({
  subscribe: vi.fn(() => ({ dispose() {} })),
  emit: vi.fn(),
}))

// Capture history fetch URLs so the limit-passthrough test can assert the
// query string; other tests are unaffected (they never call fetchSuggestions).
vi.mock('../../composables/apiBase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../composables/apiBase')>()
  return {
    ...actual,
    authFetch: vi.fn(async () => ({ ok: true, json: async () => [] })),
  }
})

import { createKeyboardContext, KEYBOARD_API_VERSION } from '../createKeyboardContext'
import { settings } from '../../composables/useSettings'
import { useHistory } from '../../composables/useHistory'

function makeDeps() {
  return {
    visible: ref(false),
    activePaneId: ref<string | null>(null),
    sendActive: vi.fn().mockResolvedValue(undefined),
    sendBroadcast: vi.fn().mockResolvedValue(undefined),
    sendToPane: vi.fn().mockResolvedValue(undefined),
    nativeImeOpen: ref(false),
    setNativeImeOpen: vi.fn(),
    onHostEvent: vi.fn(),
  }
}

function installVisualViewport() {
  const listeners: Record<string, Set<() => void>> = {}
  const vv = {
    height: 700,
    offsetTop: 42,
    addEventListener(type: string, cb: () => void) {
      ;(listeners[type] ??= new Set()).add(cb)
    },
    removeEventListener(type: string, cb: () => void) {
      listeners[type]?.delete(cb)
    },
    fire(type: string) {
      listeners[type]?.forEach((cb) => cb())
    },
  }
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: vv,
  })
  return vv
}

describe('createKeyboardContext', () => {
  let deps = makeDeps()

  beforeEach(() => {
    deps = makeDeps()
    installVisualViewport()
    document.documentElement.style.removeProperty('--mkb-height')
  })

  it('exposes version and host refs', () => {
    const ctx = createKeyboardContext(deps)
    expect(ctx.version).toBe(KEYBOARD_API_VERSION)
    expect(ctx.visible).toBe(deps.visible)
    expect(ctx.activePaneId).toBe(deps.activePaneId)
    expect(ctx.nativeImeOpen).toBe(deps.nativeImeOpen)
  })

  it('routes send to the right dep per target', async () => {
    const ctx = createKeyboardContext(deps)
    await ctx.send('active', 'ls')
    await ctx.send('broadcast', 'ls -la')
    await ctx.send('pane-7', 'cd /')
    expect(deps.sendActive).toHaveBeenCalledWith('ls')
    expect(deps.sendBroadcast).toHaveBeenCalledWith('ls -la')
    expect(deps.sendToPane).toHaveBeenCalledWith('pane-7', 'cd /')
  })

  it('setDesiredHeight writes the --mkb-height CSS variable', () => {
    const ctx = createKeyboardContext(deps)
    ctx.setDesiredHeight(280)
    expect(document.documentElement.style.getPropertyValue('--mkb-height')).toBe('280px')
  })

  it('onViewportResize reports height/offsetTop/baseline and disposes', () => {
    const ctx = createKeyboardContext(deps)
    const cb = vi.fn()
    const d = ctx.onViewportResize(cb)

    ;(window.visualViewport as unknown as { height: number }).height = 640
    ;(window.visualViewport as unknown as { fire: (t: string) => void }).fire('resize')
    expect(cb).toHaveBeenCalledWith({ height: 640, offsetTop: 42, baseline: window.innerHeight })

    // Deliberately no orientationchange subscription: rotation re-baselines
    // via the keyboard's own handler, and vv fires resize anyway.
    window.dispatchEvent(new Event('orientationchange'))
    expect(cb).toHaveBeenCalledTimes(1)
    ;(window.visualViewport as unknown as { fire: (t: string) => void }).fire('scroll')
    expect(cb).toHaveBeenCalledTimes(2)

    d.dispose()
    ;(window.visualViewport as unknown as { fire: (t: string) => void }).fire('resize')
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('onDidChangeSettings fires on deep mutation and disposes', async () => {
    const ctx = createKeyboardContext(deps)
    const cb = vi.fn()
    const d = ctx.onDidChangeSettings(cb)

    const key = 'mobile_input_mode'
    const original = settings[key]
    settings[key] = '__test_probe__'
    await nextTick()
    expect(cb).toHaveBeenCalled()
    settings[key] = original
    d.dispose()
    await nextTick()
  })

  it('events.emit forwards to the host dispatcher', () => {
    const ctx = createKeyboardContext(deps)
    ctx.events.emit('app-action', { id: 'toggle-monitor' })
    expect(deps.onHostEvent).toHaveBeenCalledWith('app-action', {
      id: 'toggle-monitor',
    })
  })

  it('events.on bridges the modifiers-consumed window CustomEvent and disposes', () => {
    const ctx = createKeyboardContext(deps)
    const cb = vi.fn()
    const d = ctx.events.on('modifiers-consumed', cb)

    window.dispatchEvent(
      new CustomEvent('dinotty-mobile-modifiers-consumed', {
        detail: {
          paneId: 'p1',
          modifiers: { ctrl: 'locked', shift: 'off', alt: 'off', meta: 'off' },
        },
      })
    )
    expect(cb).toHaveBeenCalledWith({
      paneId: 'p1',
      modifiers: { ctrl: 'locked', shift: 'off', alt: 'off', meta: 'off' },
    })

    d.dispose()
    window.dispatchEvent(
      new CustomEvent('dinotty-mobile-modifiers-consumed', {
        detail: { paneId: 'p2' },
      })
    )
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('exposes the host history singleton', () => {
    const ctx = createKeyboardContext(deps)
    const hostHistory = useHistory()
    expect(ctx.history.suggestions).toBe(hostHistory.suggestions)
    expect(typeof ctx.history.fetchSuggestions).toBe('function')
    expect(typeof ctx.history.fetchDebounced).toBe('function')
    expect(typeof ctx.history.deleteSuggestion).toBe('function')
  })

  it('history.fetchSuggestions forwards the limit to the host history query', async () => {
    const { authFetch, apiUrl } = await import('../../composables/apiBase')
    vi.mocked(authFetch).mockClear()
    const ctx = createKeyboardContext(deps)

    await ctx.history.fetchSuggestions('gi', 100)

    expect(authFetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(authFetch).mock.calls[0][0]).toBe(apiUrl('/api/history?prefix=gi&limit=100'))

    vi.mocked(authFetch).mockClear()
    await ctx.history.fetchSuggestions()
    expect(vi.mocked(authFetch).mock.calls[0][0]).toBe(apiUrl('/api/history?limit=20'))
  })

  it('i18n exposes locale and a translating t()', () => {
    const ctx = createKeyboardContext(deps)
    expect(['en', 'zh']).toContain(ctx.i18n.getLocale())
    const translated = ctx.i18n.t('settings.title')
    expect(typeof translated).toBe('string')
    expect(translated.length).toBeGreaterThan(0)
  })
})

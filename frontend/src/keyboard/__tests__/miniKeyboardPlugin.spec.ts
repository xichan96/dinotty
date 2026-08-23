import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { nextTick, ref, type Component } from 'vue'
import * as hostVue from 'vue'
import { installHostBridge } from '../installHostBridge'
import { createKeyboardContext } from '../createKeyboardContext'
import { settings } from '../../composables/useSettings'

// Breaks the settings -> ... -> usePluginLoader -> useEventBridge ->
// useSyncWebSocket -> usePluginLoader cycle (known issue, same as
// createKeyboardContext.spec.ts).
vi.mock('../../composables/useEventBridge', () => ({
  subscribe: vi.fn(() => ({ dispose() {} })),
  emit: vi.fn(),
}))

// Phase 3 contract: a third-party keyboard plugin (mini-keyboard, built in
// the dinotty-plugins repo) must load under the host bridges and drive the
// terminal only through KeyboardContext. These tests prove the whole contract
// surface a keyboard needs is sufficient: send/visible/activePaneId/i18n/
// settingsData/events/history/onViewportResize.
//
// vite-node refuses to load files from the sibling dinotty-plugins checkout,
// so beforeAll copies the bundle bytes into __plugin_bundles__/ (gitignored).

const BUNDLE_DIR = resolvePath(__dirname, '../../../../../dinotty-plugins/mini-keyboard')
const FIXTURE = './__plugin_bundles__/mini-keyboard/main.js'
const bundleAvailable = existsSync(resolvePath(BUNDLE_DIR, 'main.js'))

type BundleModule = {
  activate: () => {
    keyboard: { id: string; component: Component; desiredHeight: unknown }
  }
}

const sendActive = vi.fn(async () => {})
const sendBroadcast = vi.fn(async () => {})
const sendToPane = vi.fn(async () => {})
const onHostEvent = vi.fn()
const visible = ref(true)

beforeEach(() => {
  sendActive.mockClear()
  sendBroadcast.mockClear()
  sendToPane.mockClear()
  onHostEvent.mockClear()
  visible.value = true
})

function makeCtx() {
  return createKeyboardContext({
    visible,
    activePaneId: ref('p1'),
    sendActive,
    sendBroadcast,
    sendToPane,
    nativeImeOpen: ref(false),
    setNativeImeOpen: () => {},
    onHostEvent,
  })
}

beforeAll(() => {
  ;(window as unknown as Record<string, unknown>).__DINOTTY_VUE__ = hostVue
  installHostBridge()
  // happy-dom has no visualViewport; ctx.onViewportResize needs it.
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      height: 700,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })

  const dest = resolvePath(__dirname, '__plugin_bundles__/mini-keyboard')
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  copyFileSync(resolvePath(BUNDLE_DIR, 'main.js'), resolvePath(dest, 'main.js'))
})

async function loadBundle(): Promise<BundleModule> {
  return (await import(FIXTURE)) as BundleModule
}

const bundleDescribe = bundleAvailable ? describe : describe.skip

bundleDescribe('mini-keyboard plugin bundle', () => {
  it('contributes the keyboard provider with its own id and a fixed band', async () => {
    const mod = await loadBundle()
    const { keyboard } = mod.activate()
    expect(keyboard.id).toBe('mini-keyboard')
    expect(keyboard.component).toBeTruthy()
    expect(keyboard.desiredHeight).toBe(260)
  })

  it('contains no bare module imports', () => {
    const src = readFileSync(
      resolvePath(__dirname, '__plugin_bundles__/mini-keyboard/main.js'),
      'utf8'
    )
    const bare = [...src.matchAll(/from\s*["']([^"']+)["']/g)]
      .map((m) => m[1])
      .filter((s) => !s.startsWith('.') && !s.startsWith('/'))
    expect(bare).toEqual([])
  })

  it('sends key data through ctx.send(active) on press', async () => {
    const mod = await loadBundle()
    const wrapper = mount(mod.activate().keyboard.component, {
      props: { ctx: makeCtx() },
    })

    const seven = wrapper.get('[data-mini-key="7"]')
    await seven.trigger('click')
    expect(sendActive).toHaveBeenCalledWith('7')

    const esc = wrapper.get('[data-mini-key="ESC"]')
    await esc.trigger('click')
    expect(sendActive).toHaveBeenCalledWith('\x1b')
    wrapper.unmount()
  })

  it('broadcasts Enter via ctx.send(broadcast) from the ⇉ key', async () => {
    const mod = await loadBundle()
    const wrapper = mount(mod.activate().keyboard.component, {
      props: { ctx: makeCtx() },
    })

    const broadcast = wrapper.get('[data-mini-key="⇉"]')
    await broadcast.trigger('click')
    expect(sendBroadcast).toHaveBeenCalledWith('\r')
    expect(sendActive).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows the active pane id through the context', async () => {
    const mod = await loadBundle()
    const wrapper = mount(mod.activate().keyboard.component, {
      props: { ctx: makeCtx() },
    })

    expect(wrapper.get('[data-mini-pane]').text()).toContain('p1')
    wrapper.unmount()
  })

  it('reflects live settings changes through settingsData', async () => {
    settings.keyboard_guard_mode = 'off'
    const mod = await loadBundle()
    const wrapper = mount(mod.activate().keyboard.component, {
      props: { ctx: makeCtx() },
    })

    expect(wrapper.get('[data-mini-guard]').text()).toBe('guard: off')
    settings.keyboard_guard_mode = 'both'
    await nextTick()
    expect(wrapper.get('[data-mini-guard]').text()).toBe('guard: both')
    wrapper.unmount()
  })

  it('requests hide through the bidirectional visible ref and emits dismiss', async () => {
    const mod = await loadBundle()
    const wrapper = mount(mod.activate().keyboard.component, {
      props: { ctx: makeCtx() },
    })

    expect(visible.value).toBe(true)
    await wrapper.get('[data-mini-dismiss]').trigger('click')
    expect(visible.value).toBe(false)
    expect(onHostEvent).toHaveBeenCalledWith('dismiss', undefined)
    wrapper.unmount()
  })

  it('opens the history panel through ctx.history on the HIST key', async () => {
    const mod = await loadBundle()
    const ctx = makeCtx()
    const fetchSpy = vi.spyOn(ctx.history, 'fetchSuggestions')
    const wrapper = mount(mod.activate().keyboard.component, {
      props: { ctx },
    })

    expect(wrapper.find('.mini-suggestions').exists()).toBe(false)
    await wrapper.get('[data-mini-key="HIST"]').trigger('click')
    expect(wrapper.find('.mini-suggestions').exists()).toBe(true)
    expect(fetchSpy).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('subscribes to viewport changes through ctx.onViewportResize', async () => {
    const mod = await loadBundle()
    const wrapper = mount(mod.activate().keyboard.component, {
      props: { ctx: makeCtx() },
    })

    const vv = window.visualViewport as unknown as {
      addEventListener: ReturnType<typeof vi.fn>
    }
    expect(vv.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    wrapper.unmount()
  })
})

if (!bundleAvailable) {
  it.skip('mini-keyboard bundle tests (sibling dinotty-plugins/mini-keyboard checkout missing)', () => {})
}

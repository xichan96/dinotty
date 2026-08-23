import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { ref, type Component } from 'vue'
import * as hostVue from 'vue'
import { installHostBridge } from '../installHostBridge'
import { createKeyboardContext } from '../createKeyboardContext'

// Breaks the settings -> ... -> usePluginLoader -> useEventBridge ->
// useSyncWebSocket -> usePluginLoader cycle (known issue, same as
// createKeyboardContext.spec.ts).
vi.mock('../../composables/useEventBridge', () => ({
  subscribe: vi.fn(() => ({ dispose() {} })),
  emit: vi.fn(),
}))

// Phase 1b-iv contract: the builtin-keyboard plugin bundle (built from the
// single-sourced MobileKeyboard in this repo) must load under the host bridges
// and mount its keyboard component on the host Vue runtime with the
// KeyboardContext prop surface (no legacy visible/paneId/getSendFn).

const SEED_DIR = resolvePath(__dirname, '../../../../seed/builtin-keyboard')
const BUNDLE_PATH = resolvePath(SEED_DIR, 'main.js')
const FIXTURE = './__plugin_bundles__/builtin-keyboard/main.js'
const seedBuilt = existsSync(BUNDLE_PATH)

type BundleModule = {
  activate: () => {
    keyboard: { id: string; component: Component; desiredHeight: unknown }
  }
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
      addEventListener() {},
      removeEventListener() {},
    },
  })

  if (seedBuilt) {
    const dest = resolvePath(__dirname, '__plugin_bundles__/builtin-keyboard')
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    copyFileSync(BUNDLE_PATH, resolvePath(dest, 'main.js'))
  }
})

function makeCtx() {
  return createKeyboardContext({
    visible: ref(true),
    activePaneId: ref('p1'),
    sendActive: async () => {},
    sendBroadcast: async () => {},
    sendToPane: async () => {},
    nativeImeOpen: ref(false),
    setNativeImeOpen: () => {},
    onHostEvent: () => {},
  })
}

async function loadBundle(): Promise<BundleModule> {
  return (await import(FIXTURE)) as BundleModule
}

// Constant source-level contract: the plugin entry compiles against the real
// host modules and exposes the expected keyboard contribution shape. This runs
// in CI even when the seed artifact has not been built yet.
describe('builtin-keyboard plugin source contract', () => {
  it('entry exports a keyboard contribution with the expected id', async () => {
    const { activate } = await import('../builtin-keyboard/entry')
    const { keyboard } = activate()
    expect(keyboard.id).toBe('builtin-keyboard')
    expect(keyboard.component).toBeTruthy()
    expect(keyboard.desiredHeight).toBe('auto')
    expect(keyboard.defaultEnabled).toBe(true)
  })
})

const bundleDescribe = seedBuilt ? describe : describe.skip

bundleDescribe('builtin-keyboard plugin bundle', () => {
  it('contributes the keyboard provider with the expected id', async () => {
    const mod = await loadBundle()
    const { keyboard } = mod.activate()
    expect(keyboard.id).toBe('builtin-keyboard')
    expect(keyboard.component).toBeTruthy()
    expect(keyboard.desiredHeight).toBe('auto')
  })

  it('contains __DINOTTY_HOST__ bridge access and no bare vue/pinia imports', () => {
    const src = readFileSync(BUNDLE_PATH, 'utf8')
    expect(src).toContain('__DINOTTY_HOST__')
    const bare = [...src.matchAll(/from\s*["']([^"']+)["']/g)]
      .map((m) => m[1])
      .filter((s) => !s.startsWith('.') && !s.startsWith('/'))
    expect(bare).toEqual([])
    expect(src).not.toContain('pinia')
  })

  it('mounts MobileKeyboard with a KeyboardContext prop', async () => {
    const mod = await loadBundle()
    const { keyboard } = mod.activate()
    const wrapper = mount(keyboard.component, {
      props: { ctx: makeCtx() },
    })
    // The keyboard band renders its bar; content renders key rows.
    expect(wrapper.element.children.length).toBeGreaterThan(0)
    wrapper.unmount()
  })
})

if (!seedBuilt) {
  it.skip('builtin-keyboard bundle tests (seed artifact missing; run npm run build:builtin-kb)', () => {})
}

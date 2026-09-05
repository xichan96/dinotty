import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { LoadedPlugin } from '../composables/usePluginLoader'
import type { PaneLayout, Tab } from '../types/pane'
import { resolvePluginOpenMode, usePluginLauncher } from '../composables/usePluginLauncher'

const mocks = vi.hoisted(() => ({
  apiCreatePluginTab: vi.fn(),
  isTouchDevice: vi.fn(() => false),
  notify: vi.fn(),
}))

vi.mock('../composables/useTabApi', () => ({
  apiCreatePluginTab: mocks.apiCreatePluginTab,
}))

vi.mock('../composables/useIsMobile', () => ({
  isTouchDevice: mocks.isTouchDevice,
}))

import { usePluginFloatWindowsStore } from '../stores/pluginFloatWindows'

function leaf(paneId: string): PaneLayout {
  return { type: 'leaf', paneId, title: paneId, ratio: 1, zoomed: false }
}

function plugin(id = 'json-formatter', state: LoadedPlugin['state'] = 'active'): LoadedPlugin {
  return {
    id,
    manifest: { id, name: id, version: '1.0.0' },
    module: { activate: vi.fn() },
    exports: null,
    state,
    error: state === 'error' ? 'boom' : undefined,
  } as LoadedPlugin
}

function setup(pluginState: LoadedPlugin['state'] = 'active', pluginId = 'json-formatter') {
  setActivePinia(createPinia())
  const tabs = ref<Tab[]>([])
  const floatStore = usePluginFloatWindowsStore()
  const openFloat = vi.fn()
  const openPref = vi.fn<(id: string) => 'tab' | 'floating'>(() => 'tab')
  const openPlugin = usePluginLauncher({
    tabs,
    activeWorkspaceId: ref<string | null>('workspace-a'),
    loadedPlugins: new Map([[pluginId, plugin(pluginId, pluginState)]]),
    syncWs: { sendSync: vi.fn() },
    ensureSplitRoot: (layout) => layout,
    activateTab: vi.fn(),
    commitLocalActivePane: vi.fn(),
    persist: vi.fn(),
    focusActive: vi.fn(),
    floatWindows: { open: openFloat },
    openModePref: openPref,
  }).openPlugin
  window.__dinotty_ui_notify = mocks.notify as never
  return { openPlugin, openFloat, openPref, floatStore, tabs }
}

describe('resolvePluginOpenMode', () => {
  it('explicit mode wins over the pref', () => {
    expect(resolvePluginOpenMode('floating', 'tab', false)).toBe('floating')
    expect(resolvePluginOpenMode('tab', 'floating', false)).toBe('tab')
  })

  it('falls back to the pref when no explicit mode is given', () => {
    expect(resolvePluginOpenMode(undefined, 'floating', false)).toBe('floating')
    expect(resolvePluginOpenMode(undefined, 'tab', false)).toBe('tab')
  })

  it('forces tab on touch devices regardless of mode or pref', () => {
    expect(resolvePluginOpenMode('floating', 'floating', true)).toBe('tab')
    expect(resolvePluginOpenMode(undefined, 'floating', true)).toBe('tab')
  })
})

describe('usePluginLauncher open-mode dispatch', () => {
  beforeEach(() => {
    mocks.isTouchDevice.mockReturnValue(false)
    mocks.notify.mockClear()
    mocks.apiCreatePluginTab.mockReset()
    mocks.apiCreatePluginTab.mockResolvedValue({ tab_id: 't1', pane_id: 'p1', layout: leaf('t1') })
  })

  it('defaults to the tab path when no pref is configured', async () => {
    const { openPlugin, openFloat } = setup()
    await openPlugin('json-formatter')
    expect(mocks.apiCreatePluginTab).toHaveBeenCalled()
    expect(openFloat).not.toHaveBeenCalled()
  })

  it('routes to the floating window when the pref is floating', async () => {
    const { openPlugin, openFloat, openPref } = setup()
    openPref.mockReturnValue('floating')
    await openPlugin('json-formatter')
    expect(openFloat).toHaveBeenCalledWith('json-formatter')
    expect(mocks.apiCreatePluginTab).not.toHaveBeenCalled()
  })

  it('routes to a tab when the pref is floating but the device is touch', async () => {
    const { openPlugin, openFloat, openPref } = setup()
    openPref.mockReturnValue('floating')
    mocks.isTouchDevice.mockReturnValue(true)
    await openPlugin('json-formatter')
    expect(openFloat).not.toHaveBeenCalled()
    expect(mocks.apiCreatePluginTab).toHaveBeenCalled()
  })

  it('an explicit tab mode overrides a floating pref', async () => {
    const { openPlugin, openFloat, openPref } = setup()
    openPref.mockReturnValue('floating')
    await openPlugin('json-formatter', 'tab')
    expect(mocks.apiCreatePluginTab).toHaveBeenCalled()
    expect(openFloat).not.toHaveBeenCalled()
  })

  it('an explicit floating mode overrides a tab pref', async () => {
    const { openPlugin, openFloat } = setup()
    await openPlugin('json-formatter', 'floating')
    expect(openFloat).toHaveBeenCalledWith('json-formatter')
    expect(mocks.apiCreatePluginTab).not.toHaveBeenCalled()
  })

  it('does not open a window for an unloaded/errored plugin and notifies', async () => {
    const { openPlugin, openFloat, openPref } = setup('error')
    openPref.mockReturnValue('floating')
    await openPlugin('json-formatter')
    expect(openFloat).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalled()
    expect(mocks.apiCreatePluginTab).not.toHaveBeenCalled()
  })
})

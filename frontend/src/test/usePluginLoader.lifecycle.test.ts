import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'

const api = vi.hoisted(() => ({
  authFetch: vi.fn(),
  getApiBase: vi.fn().mockResolvedValue(''),
}))

vi.mock('../composables/apiBase', () => ({
  authFetch: api.authFetch,
  getApiBase: api.getApiBase,
  apiUrl: (path: string) => path,
  wsUrlWithToken: (url: string) => url,
}))

import {
  loadedPlugins,
  resolveKeyboardContributionId,
  usePluginLoader,
  type LoadedPlugin,
  type PluginManifest,
} from '../composables/usePluginLoader'
import { useKeyboardProviders } from '../composables/useKeyboardProviders'
import { usePluginOverlaysStore } from '../stores/pluginOverlays'

function loadedPlugin(manifest: PluginManifest): LoadedPlugin {
  return {
    id: manifest.id,
    manifest,
    module: { activate: () => ({}) },
    exports: null,
    state: 'active',
  }
}

describe('usePluginLoader lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    loadedPlugins.clear()
    api.authFetch.mockReset()
    api.getApiBase.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not activate a plugin rejected by the backend', async () => {
    api.authFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            manifest: { id: 'native-plugin', name: 'Native', version: '1.0.0' },
            state: 'error',
            error: 'plugin requires Dinotty 0.18.0 or newer',
          },
        ]),
        { status: 200 }
      )
    )

    await usePluginLoader().loadAll()

    expect(api.authFetch).toHaveBeenCalledTimes(1)
    expect(loadedPlugins.get('native-plugin')).toMatchObject({
      state: 'error',
      error: 'plugin requires Dinotty 0.18.0 or newer',
    })
  })

  it('stops legacy UI-scoped processes when plugin UI unloads', async () => {
    api.authFetch.mockResolvedValue(new Response(null, { status: 204 }))
    loadedPlugins.set(
      'legacy-plugin',
      loadedPlugin({ id: 'legacy-plugin', name: 'Legacy', version: '1.0.0' })
    )

    await usePluginLoader().unloadPlugin('legacy-plugin', { stopUiProcesses: true })

    expect(api.authFetch).toHaveBeenCalledWith('/api/plugins/legacy-plugin/process?scope=ui', {
      method: 'DELETE',
    })
  })

  it('delegates scope filtering to the backend for host-scoped plugins', async () => {
    api.authFetch.mockResolvedValue(new Response(null, { status: 204 }))
    loadedPlugins.set(
      'host-plugin',
      loadedPlugin({
        id: 'host-plugin',
        name: 'Host',
        version: '1.0.0',
        bin: { mode: 'cli', lifecycle: { scope: 'host' } },
      })
    )

    await usePluginLoader().unloadPlugin('host-plugin', { stopUiProcesses: true })

    expect(api.authFetch).toHaveBeenCalledWith('/api/plugins/host-plugin/process?scope=ui', {
      method: 'DELETE',
    })
  })

  it('keeps the plugin active when UI-scoped processes cannot be stopped', async () => {
    const deactivate = vi.fn()
    const dispose = vi.fn()
    api.authFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'failed to stop plugin processes: 42' }), {
        status: 504,
        statusText: 'Gateway Timeout',
      })
    )
    const plugin = loadedPlugin({ id: 'stuck-plugin', name: 'Stuck', version: '1.0.0' })
    plugin.module.deactivate = deactivate
    plugin.exports = { dispose }
    loadedPlugins.set(plugin.id, plugin)

    await expect(
      usePluginLoader().unloadPlugin(plugin.id, { stopUiProcesses: true })
    ).rejects.toThrow(
      'Unable to stop plugin UI processes: failed to stop plugin processes: 42 (HTTP 504 Gateway Timeout)'
    )

    expect(loadedPlugins.get(plugin.id)).toMatchObject({ id: plugin.id, state: 'active' })
    expect(deactivate).not.toHaveBeenCalled()
    expect(dispose).not.toHaveBeenCalled()
  })

  it('reports backend failures when stopping managed processes', async () => {
    api.authFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'timed out while stopping process' }), {
        status: 504,
        statusText: 'Gateway Timeout',
      })
    )
    const context = usePluginLoader().getPluginContext('native-plugin')

    await expect(context.process.stopAll()).rejects.toThrow(
      'Unable to stop plugin processes: timed out while stopping process (HTTP 504 Gateway Timeout)'
    )
  })

  it('resolves a keyboard contribution under the plugin id when omitted', () => {
    expect(resolveKeyboardContributionId('mini-keyboard', undefined)).toBe('mini-keyboard')
  })

  it('accepts a keyboard contribution id matching the plugin id', () => {
    expect(resolveKeyboardContributionId('mini-keyboard', 'mini-keyboard')).toBe('mini-keyboard')
  })

  it('rejects a keyboard contribution id that does not match the plugin id', () => {
    expect(() => resolveKeyboardContributionId('mini-keyboard', 'builtin-keyboard')).toThrow(
      "keyboard contribution id 'builtin-keyboard' must match plugin id 'mini-keyboard'"
    )
  })

  it('unregisters a keyboard contribution by its resolved id on unload (id omitted)', async () => {
    const { providers } = useKeyboardProviders()
    providers.value.clear()
    const plugin = loadedPlugin({ id: 'kb-plugin', name: 'Kb', version: '1.0.0' })
    plugin.exports = {
      // keyboard.id deliberately omitted: registration falls back to the plugin id.
      keyboard: { component: defineComponent({ render: () => null }), desiredHeight: 200 },
    }
    plugin.keyboardContributionId = resolveKeyboardContributionId(plugin.id, undefined)
    expect(plugin.keyboardContributionId).toBe('kb-plugin')
    const { keyboard } = plugin.exports
    providers.value.set(plugin.keyboardContributionId, {
      id: plugin.keyboardContributionId,
      kind: 'plugin',
      component: keyboard!.component,
    })
    loadedPlugins.set(plugin.id, plugin)

    await usePluginLoader().unloadPlugin(plugin.id)

    expect(providers.value.has('kb-plugin')).toBe(false)
  })

  it('unregisters overlay contributions on unload', async () => {
    const store = usePluginOverlaysStore()
    const plugin = loadedPlugin({ id: 'ovl-plugin', name: 'Ovl', version: '1.0.0' })
    plugin.exports = {
      overlay: [{ id: 'ovl-plugin:fab', component: defineComponent({ render: () => null }) }],
    }
    loadedPlugins.set(plugin.id, plugin)
    // The real loadPlugin activate step isn't exercised by this suite; seed the
    // store the way activation registration would.
    store.register(plugin.id, plugin.exports.overlay!)
    expect(store.overlays).toHaveLength(1)

    await usePluginLoader().unloadPlugin(plugin.id)

    expect(store.overlays).toHaveLength(0)
  })

  it('forwards cwd and env options to streaming process spawns', () => {
    const urls: string[] = []
    class CapturingWebSocket {
      onmessage: ((event: MessageEvent) => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor(url: string | URL) {
        urls.push(String(url))
      }

      close() {}
    }
    vi.stubGlobal('WebSocket', CapturingWebSocket)

    const context = usePluginLoader().getPluginContext('native-plugin')
    context.exec.spawn(['serve'], { cwd: 'work', env: { MODE: 'test' } })

    const url = new URL(urls[0])
    expect(JSON.parse(url.searchParams.get('args')!)).toEqual(['serve'])
    expect(JSON.parse(url.searchParams.get('options')!)).toEqual({
      cwd: 'work',
      env: { MODE: 'test' },
    })
  })
})

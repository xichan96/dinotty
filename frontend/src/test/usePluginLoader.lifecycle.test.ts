import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

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
  usePluginLoader,
  type LoadedPlugin,
  type PluginManifest,
} from '../composables/usePluginLoader'

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

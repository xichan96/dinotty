import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ authFetch: vi.fn() }))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: apiMocks.authFetch,
  getApiBase: vi.fn(async () => ''),
  hasAuthToken: () => true,
}))

import {
  __resetSettingsLoadStateForTest,
  loadSettings,
  saveSettings,
  settings,
} from '../composables/useSettings'

function response(body: object = {}) {
  return new Response(JSON.stringify(body), { status: 200 })
}

function serverShell(shell: string, wslDistro: string | null = null) {
  return {
    shell,
    shell_path: null,
    wsl_distro: wslDistro,
  }
}

describe('settings load/save ordering', () => {
  beforeEach(() => {
    settings.shell = 'auto'
    settings.shell_path = null
    settings.wsl_distro = null
    __resetSettingsLoadStateForTest()
    apiMocks.authFetch.mockReset()
  })

  it('does not let a late refresh overwrite and re-save a new Shell selection', async () => {
    apiMocks.authFetch.mockResolvedValueOnce(response(serverShell('wsl', 'Ubuntu-22.04')))
    await loadSettings()

    let resolveRefresh: ((value: Response) => void) | undefined
    let savedPayload: Record<string, unknown> | undefined
    apiMocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        savedPayload = JSON.parse(String(init.body)) as Record<string, unknown>
        return response()
      }
      return new Promise<Response>((resolve) => {
        resolveRefresh = resolve
      })
    })

    const refresh = loadSettings()
    await vi.waitFor(() => expect(resolveRefresh).toBeTypeOf('function'))

    settings.shell = 'auto'
    settings.wsl_distro = null
    const save = saveSettings()
    await save

    resolveRefresh!(response(serverShell('wsl', 'Ubuntu-22.04')))
    await refresh

    expect(settings.shell).toBe('auto')
    expect(settings.wsl_distro).toBeNull()
    expect(savedPayload).toMatchObject({ shell: 'auto', wsl_distro: null })
  })

  it('serializes PUT requests so the latest Shell selection is saved last', async () => {
    apiMocks.authFetch.mockResolvedValueOnce(response(serverShell('wsl', 'Ubuntu-22.04')))
    await loadSettings()

    const payloads: Array<Record<string, unknown>> = []
    let resolveFirstSave: ((value: Response) => void) | undefined
    apiMocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return response(serverShell('wsl', 'Ubuntu-22.04'))
      payloads.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      if (payloads.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirstSave = resolve
        })
      }
      return response()
    })

    settings.shell = 'auto'
    settings.wsl_distro = null
    const firstSave = saveSettings()
    await vi.waitFor(() => expect(resolveFirstSave).toBeTypeOf('function'))

    settings.shell = 'powershell'
    const secondSave = saveSettings()
    await Promise.resolve()
    expect(payloads).toHaveLength(1)

    resolveFirstSave!(response())
    await Promise.all([firstSave, secondSave])

    expect(payloads).toHaveLength(2)
    expect(payloads[0]).toMatchObject({ shell: 'auto', wsl_distro: null })
    expect(payloads[1]).toMatchObject({ shell: 'powershell', wsl_distro: null })
  })

  it('waits for an existing save before refreshing settings', async () => {
    apiMocks.authFetch.mockResolvedValueOnce(response(serverShell('wsl', 'Ubuntu-22.04')))
    await loadSettings()

    let persistedShell = serverShell('wsl', 'Ubuntu-22.04')
    let resolveSave: (() => void) | undefined
    let getCalls = 0
    apiMocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const payload = JSON.parse(String(init.body)) as {
          shell: string
          wsl_distro: string | null
        }
        await new Promise<void>((resolve) => {
          resolveSave = resolve
        })
        persistedShell = serverShell(payload.shell, payload.wsl_distro)
        return response()
      }
      getCalls++
      return response(persistedShell)
    })

    settings.shell = 'auto'
    settings.wsl_distro = null
    const save = saveSettings()
    await vi.waitFor(() => expect(resolveSave).toBeTypeOf('function'))

    const refresh = loadSettings()
    await Promise.resolve()
    expect(getCalls).toBe(0)

    resolveSave!()
    await Promise.all([save, refresh])

    expect(getCalls).toBe(1)
    expect(settings.shell).toBe('auto')
    expect(settings.wsl_distro).toBeNull()
  })
})

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

describe('notification presentation save boundary before presentation init', () => {
  const loadedChannels = { sound: false, vibration: true, panel: false, tab_indicator: true }
  const loadedSounds = { info: { source: 'builtin', value: 'ding', volume: 0.5 } }

  beforeEach(async () => {
    __resetSettingsLoadStateForTest()
    apiMocks.authFetch.mockReset()
    apiMocks.authFetch.mockImplementation(
      async (_url, init?: RequestInit) =>
        new Response(
          init?.method === 'PUT'
            ? '{}'
            : JSON.stringify({
                ...(settings as any),
                notification: {
                  ...(settings as any).notification,
                  enabled: true,
                  bell: { enabled: true, debounce_ms: 300 },
                  osc_notify: true,
                  channels: loadedChannels,
                  sounds: loadedSounds,
                },
              }),
          { status: 200 }
        )
    )
    await loadSettings()
    ;(settings.notification as any).channels = {
      sound: true,
      vibration: false,
      panel: true,
      tab_indicator: false,
    }
    ;(settings.notification as any).sounds = {
      info: { source: 'custom', value: 'local-diverged', volume: 0.2 },
    }
  })

  it('echoes values captured at settings load without initializing the presentation store', async () => {
    await saveSettings()

    const calls = apiMocks.authFetch.mock.calls
    const request = calls[calls.length - 1]?.[1] as RequestInit
    const payload = JSON.parse(String(request.body))
    expect(payload.notification).toMatchObject({
      enabled: true,
      bell: { enabled: true, debounce_ms: 300 },
      osc_notify: true,
      channels: loadedChannels,
      sounds: loadedSounds,
    })
    for (const key of [
      'presentation_enabled',
      'dnd_level',
      'ignore_current_tab',
      'quiet_hours',
      'coalesce_window_ms',
    ]) {
      expect(payload.notification).not.toHaveProperty(key)
    }
  })

  it('does not PUT settings when the initial settings load fails', async () => {
    __resetSettingsLoadStateForTest()
    apiMocks.authFetch.mockReset()
    apiMocks.authFetch.mockResolvedValue(new Response('{}', { status: 500 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await loadSettings()
    await saveSettings()

    expect(
      apiMocks.authFetch.mock.calls.some(
        ([url, init]) => url === '/api/settings' && init?.method === 'PUT'
      )
    ).toBe(false)
    warn.mockRestore()
  })
})

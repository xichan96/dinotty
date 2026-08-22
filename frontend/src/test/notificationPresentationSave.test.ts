import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ authFetch: vi.fn() }))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: apiMocks.authFetch,
  getApiBase: vi.fn(async () => ''),
  hasAuthToken: () => true,
}))
vi.mock('../composables/useTransport', () => ({ isTauri: () => false }))

import {
  __resetSettingsLoadStateForTest,
  loadSettings,
  saveSettings,
  settings,
} from '../composables/useSettings'
import {
  __resetNotificationPresentationForTest,
  useNotificationPresentation,
} from '../composables/useNotificationPresentation'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value))
  }
}

describe('notification presentation server save boundary', () => {
  const loadedChannels = { sound: true, vibration: false, panel: true, tab_indicator: false }
  const loadedSounds = {
    info: { source: 'builtin', value: 'ding', volume: 0.7 },
    success: { source: 'builtin', value: 'chime-up', volume: 0.7 },
    warning: { source: 'builtin', value: 'double-beep', volume: 0.8 },
    error: { source: 'builtin', value: 'error-buzz', volume: 0.8 },
    urgent: { source: 'builtin', value: 'alarm', volume: 1 },
  }

  beforeEach(async () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    __resetNotificationPresentationForTest()
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
  })

  it('echoes pristine server channels/sounds while excluding all other local-only fields', async () => {
    const local = useNotificationPresentation()
    local.settings.channels = {
      sound: false,
      vibration: true,
      popup: true,
      panel: false,
      tab_indicator: true,
    }
    local.settings.sounds.info = { source: 'custom', value: 'local-only', volume: 0.1 }
    local.settings.dnd_level = 'silent'
    local.settings.ignore_current_tab = false
    local.settings.coalesce_window_ms = 875

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
    expect(payload.notification.channels).toEqual(loadedChannels)
    expect(payload.notification.channels).not.toHaveProperty('popup')
    for (const key of [
      'presentation_enabled',
      'dnd_level',
      'ignore_current_tab',
      'quiet_hours',
      'coalesce_window_ms',
    ])
      expect(payload.notification).not.toHaveProperty(key)
  })

  it('refreshes the pristine echo after every successful settings load', async () => {
    const refreshedChannels = {
      sound: false,
      vibration: true,
      panel: false,
      tab_indicator: true,
    }
    const refreshedSounds = {
      ...loadedSounds,
      info: { source: 'custom', value: 'server-b', volume: 0.4 },
    }
    apiMocks.authFetch.mockImplementation(
      async (_url, init?: RequestInit) =>
        new Response(
          init?.method === 'PUT'
            ? '{}'
            : JSON.stringify({
                ...(settings as any),
                notification: {
                  ...(settings as any).notification,
                  channels: refreshedChannels,
                  sounds: refreshedSounds,
                },
              }),
          { status: 200 }
        )
    )

    await loadSettings()
    settings.text.font_size += 1
    await saveSettings()

    const calls = apiMocks.authFetch.mock.calls
    const request = calls[calls.length - 1]?.[1] as RequestInit
    const payload = JSON.parse(String(request.body))
    expect(payload.notification.channels).toEqual(refreshedChannels)
    expect(payload.notification.sounds).toEqual(refreshedSounds)
  })
})

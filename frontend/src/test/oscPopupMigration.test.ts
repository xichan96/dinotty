import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ authFetch: vi.fn() }))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: apiMocks.authFetch,
  getApiBase: vi.fn(async () => ''),
  hasAuthToken: () => true,
}))
vi.mock('../composables/useTransport', () => ({ isTauri: () => false }))

import { __resetSettingsLoadStateForTest, loadSettings, settings } from '../composables/useSettings'
import {
  __resetNotificationPresentationForTest,
  useNotificationPresentation,
  presentationGate,
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

// 用户桌面端 ~/Library/Application Support/dinotty/settings.json 的实际值
const USER_SERVER_NOTIFICATION = {
  enabled: true,
  bell: { enabled: true, debounce_ms: 300 },
  osc_notify: true,
  osc_notify_debounce_ms: 2000,
  idle_reminder: false,
  command_complete: { enabled: false, threshold_seconds: 10 },
  keyword_match: [],
  channels: { sound: true, vibration: true, panel: false, tab_indicator: true },
  sounds: {
    info: { source: 'builtin', value: 'ding', volume: 0.7 },
    success: { source: 'builtin', value: 'chime-up', volume: 0.7 },
    warning: { source: 'builtin', value: 'double-beep', volume: 0.8 },
    error: { source: 'builtin', value: 'error-buzz', volume: 0.8 },
    urgent: { source: 'builtin', value: 'alarm', volume: 1.0 },
  },
  hooks: [{ enabled: false, notification_type: null, command: '' }],
}

describe('OSC notify: user settings migration regression', () => {
  beforeEach(async () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    __resetNotificationPresentationForTest()
    __resetSettingsLoadStateForTest()
    apiMocks.authFetch.mockReset()
    apiMocks.authFetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ...(settings as any),
            notification: USER_SERVER_NOTIFICATION,
          }),
          { status: 200 }
        )
    )
    await loadSettings()
  })

  it('seeds popup from legacy panel=false -> popup disabled', () => {
    const local = useNotificationPresentation()
    expect(local.settings.channels.popup).toBe(false)
  })

  it('background-pane OSC notify: gate suppresses popup', () => {
    const local = useNotificationPresentation()
    const out = presentationGate(
      {
        kind: 'pane',
        paneId: 'pane-bg',
        severity: 'info',
        title: null,
        body: 'Task done',
      } as any,
      {
        settings: local.settings,
        focusedPaneId: 'pane-other',
        activeTabPaneIds: ['pane-other'],
        isAppForeground: true,
        now: () => new Date('2026-08-25T14:00:00'),
      }
    )
    expect(out.showPopup).toBe(false)
    expect(out.playSound).toBe(true)
  })
})

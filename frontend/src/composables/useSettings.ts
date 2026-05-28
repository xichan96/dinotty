import { reactive } from 'vue'
import { getThemeByName, applyThemeToDOM, getXtermTheme } from '../themes'
import { getApiBase, apiUrl, authFetch } from './apiBase'
export interface SettingsData {
  theme: {
    preset: string
    custom: {
      foreground?: string
      background?: string
      cursor?: string
      ansi?: (string | undefined)[]
    } | null
  }
  background: {
    color: string | null
  }
  text: TextConfig
  bookmarks: CommandBookmark[]
  action_keyboard: ActionKeyboardConfig | null
  keyboard_sound: boolean
  show_virtual_keyboard: boolean
  locale: string
  panel_position: 'auto' | 'right' | 'left' | 'top' | 'bottom'
  port?: number | null
  monitor: MonitorConfig
  notification: NotificationConfig
  open_api: OpenApiConfig
}

export interface OpenApiConfig {
  enabled: boolean
}

export interface NotificationConfig {
  enabled: boolean
  bell: { enabled: boolean; debounce_ms: number }
  osc_notify: boolean
  command_complete: { enabled: boolean; threshold_seconds: number }
  keyword_match: { pattern: string; notification_type: string; case_sensitive: boolean }[]
  channels: {
    sound: boolean
    vibration: boolean

    panel: boolean
    tab_indicator: boolean
  }
  sounds: Record<string, { source: 'builtin' | 'custom'; value: string; volume: number }>
  hooks: NotificationHook[]
}

export interface NotificationHook {
  enabled: boolean
  notification_type: string | null
  command: string
}

export interface MonitorConfig {
  enabled: boolean
  cpu: boolean
  memory: boolean
  disk: boolean
  network: boolean
}

export interface TextConfig {
  font_size: number
  font_family: string
  line_height: number
  letter_spacing: number
  cursor_style: 'block' | 'underline' | 'bar'
  cursor_blink: boolean
  scrollback: number
}

export interface CommandBookmark {
  id: string
  name: string
  command: string
  group: string | null
}

export interface ActionKey {
  label: string
  send: string
  style?: string
  repeat?: boolean
  special?: string
  auto_enter?: boolean
  grow?: number
}

export interface ActionKeyboardConfig {
  rows: ActionKey[][]
}

export const DEFAULT_ACTION_KEYBOARD: ActionKeyboardConfig = {
  rows: [
    [
      { label: 'cc', send: 'claude', auto_enter: true },
      { label: 'oc', send: 'opencode', auto_enter: true },
    ],
    [
      { label: 'esc', send: '\x1b', style: 'danger', auto_enter: true },
      { label: 'ctrl+c', send: '\x03', style: 'danger', auto_enter: true },
      { label: 'clear', send: 'clear', auto_enter: true },
      { label: '⌫', send: '', repeat: true, grow: 1.5 },
    ],
    [
      { label: 'PlanMode', send: '\x1b[Z', auto_enter: true, grow: 1.75 },
      { label: '/', send: '/', grow: 1.5 },
      { label: 'tab', send: '\t', grow: 1.5 },
      { label: '1', send: '1', auto_enter: true },
      { label: '2', send: '2', auto_enter: true },
      { label: '3', send: '3', auto_enter: true },
      { label: '4', send: '4', auto_enter: true },
    ],
  ],
}

export const settings = reactive<SettingsData>({
  theme: { preset: 'dark', custom: null },
  background: { color: null },
  text: {
    font_size: 14,
    font_family: '',
    line_height: 1.2,
    letter_spacing: 0,
    cursor_style: 'block',
    cursor_blink: true,
    scrollback: 10000,
  },
  bookmarks: [],
  action_keyboard: null,
  keyboard_sound: false,
  show_virtual_keyboard: false,
  locale: 'zh',
  panel_position: 'auto',
  monitor: {
    enabled: true,
    cpu: true,
    memory: true,
    disk: true,
    network: true,
  },
  notification: {
    enabled: true,
    bell: { enabled: true, debounce_ms: 300 },
    osc_notify: true,
    command_complete: { enabled: false, threshold_seconds: 10 },
    keyword_match: [],
    channels: {
      sound: true,
      vibration: true,

      panel: true,
      tab_indicator: true,
    },
    sounds: {
      info: { source: 'builtin', value: 'ding', volume: 0.7 },
      success: { source: 'builtin', value: 'chime-up', volume: 0.7 },
      warning: { source: 'builtin', value: 'double-beep', volume: 0.8 },
      error: { source: 'builtin', value: 'error-buzz', volume: 0.8 },
      urgent: { source: 'builtin', value: 'alarm', volume: 1.0 },
    },
    hooks: [],
  },
  open_api: {
    enabled: false,
  },
})

let loaded = false

export function useSettings() {
  if (!loaded) {
    loadSettings()
    loaded = true
  }
  return { settings, saveSettings, applyCurrentTheme, getCurrentXtermTheme }
}

async function loadSettings() {
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/settings'))
    if (res.ok) {
      const data = await res.json()
      Object.assign(settings, data)
      applyCurrentTheme()
      // Sync action keyboard to localStorage for static mobile-keyboard.js
      if (settings.action_keyboard) {
        localStorage.setItem('dinotty_action_keyboard', JSON.stringify(settings.action_keyboard))
      }
    }
  } catch {}
}

async function saveSettings() {
  try {
    // Sync action keyboard to localStorage for static mobile-keyboard.js
    if (settings.action_keyboard) {
      localStorage.setItem('dinotty_action_keyboard', JSON.stringify(settings.action_keyboard))
    } else {
      localStorage.removeItem('dinotty_action_keyboard')
    }
    await getApiBase()
    await authFetch(apiUrl('/api/settings'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
  } catch {}
}

const themeChangeListeners = new Set<(xtermTheme: ReturnType<typeof getXtermTheme>) => void>()

export function onThemeChange(fn: (xtermTheme: ReturnType<typeof getXtermTheme>) => void) {
  themeChangeListeners.add(fn)
  return () => { themeChangeListeners.delete(fn) }
}

const textChangeListeners = new Set<(text: TextConfig) => void>()

export function onTextChange(fn: (text: TextConfig) => void) {
  textChangeListeners.add(fn)
  return () => { textChangeListeners.delete(fn) }
}

export function notifyTextChange() {
  textChangeListeners.forEach((fn) => fn(settings.text))
}

export function applyCurrentTheme() {
  const theme = getThemeByName(settings.theme.preset)
  applyThemeToDOM(theme)

  // Apply custom color overrides
  const custom = settings.theme.custom
  if (custom) {
    if (custom.foreground) {
      document.documentElement.style.setProperty('--fg', custom.foreground)
    }
    if (custom.background) {
      document.documentElement.style.setProperty('--bg', custom.background)
    }
    if (custom.cursor) {
      document.documentElement.style.setProperty('--fg-muted', custom.cursor)
    }
    if (custom.ansi) {
      const keys = [
        '--color-black', '--color-red', '--color-green', '--color-yellow',
        '--color-blue', '--color-magenta', '--color-cyan', '--color-white',
        '--color-bright-black', '--color-bright-red', '--color-bright-green', '--color-bright-yellow',
        '--color-bright-blue', '--color-bright-magenta', '--color-bright-cyan', '--color-bright-white',
      ]
      custom.ansi.forEach((c, i) => {
        if (c) document.documentElement.style.setProperty(keys[i], c)
      })
    }
  }

  if (settings.background.color) {
    document.documentElement.style.setProperty('--bg', settings.background.color)
  }

  // Sync theme-color to final resolved background color (after overrides)
  const finalBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  if (finalBg) {
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', finalBg)
  }

  const xtermTheme = getCurrentXtermTheme()
  themeChangeListeners.forEach((fn) => fn(xtermTheme))
}

export function getCurrentXtermTheme() {
  const theme = getThemeByName(settings.theme.preset)
  const xtermTheme = getXtermTheme(theme)
  // Apply custom color overrides
  const custom = settings.theme.custom
  if (custom) {
    if (custom.foreground) xtermTheme.foreground = custom.foreground
    if (custom.background) xtermTheme.background = custom.background
    if (custom.cursor) xtermTheme.cursor = custom.cursor
    if (custom.ansi) {
      const keys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
        'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const
      custom.ansi.forEach((c, i) => {
        if (c) (xtermTheme as any)[keys[i]] = c
      })
    }
  }
  return xtermTheme
}

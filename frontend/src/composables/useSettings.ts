import { reactive } from 'vue'
import { getThemeByName, applyThemeToDOM, getXtermTheme } from '../themes'
import { getApiBase, apiUrl, authFetch, hasAuthToken } from './apiBase'
import ClaudeLogo from '../components/icons/ClaudeLogo.vue'
import CodexLogo from '../components/icons/CodexLogo.vue'
import OpencodeLogo from '../components/icons/OpencodeLogo.vue'
import { isWindowsClient } from '../utils/clientPlatform'
import type { KeyBinding } from './useKeybindings'
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
    mode: string
    color: string | null
    opacity: number
    has_image: boolean
  }
  text: TextConfig
  bookmarks: CommandBookmark[]
  workspace_bookmarks: WorkspaceBookmark[]
  web_bookmarks: WebBookmark[]
  recent_files: RecentEntry[]
  recent_urls: RecentEntry[]
  action_keyboard: ActionKeyboardConfig | null
  upload_dir: string
  upload_cap_mb: number
  upload_file_cap_mb: number
  upload_cap_count: number
  keyboard_sound: boolean
  show_virtual_keyboard: boolean
  confirm_before_close_tab: boolean
  windowsAltAsCmd: boolean
  locale: string
  panel_position: 'auto' | 'right' | 'left' | 'top' | 'bottom'
  port?: number | null
  monitor: MonitorConfig
  notification: NotificationConfig
  open_api: OpenApiConfig
  auth_token?: string
  ip_whitelist: string[]
  auth: {
    allowed_origins: string[]
    trusted_proxies: string[]
    lockout_strategy: string
    session_ttl_days: number
    lockout_max_failures: number
    lockout_secs: number
    global_lockout_max_failures: number
    global_lockout_secs: number
  }
  preview: {
    allow_external: boolean
  }
  keybindings: Record<string, KeyBinding>
  log: LogConfig
  ssh_profiles: SshProfile[]
}

export interface OpenApiConfig {
  enabled: boolean
}

export interface LogConfig {
  enabled: boolean
  path: string
  max_size_mb: number
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
  gpu: boolean
}

export interface TextConfig {
  font_size: number
  font_family: string
  line_height: number
  letter_spacing: number
  cursor_style: 'block' | 'underline' | 'bar'
  cursor_blink: boolean
  scrollback: number
  scroll_sensitivity: number
  scroll_acceleration: number
  scrollbar_width: number
}

export interface SshProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_method: SshAuthMethod
  group?: string | null
  default_command?: string | null
}

export type SshAuthMethod =
  | { type: 'password'; password: string }
  | { type: 'key_file'; key_path: string; passphrase?: string | null }
  | { type: 'key_inline'; private_key: string; passphrase?: string | null }

export interface CommandBookmark {
  id: string
  name: string
  command: string
  group: string | null
}

export interface WorkspaceBookmark {
  id: string
  name: string
  path: string
  is_dir: boolean
  group: string | null
}

export interface WebBookmark {
  id: string
  name: string
  url: string
  group: string | null
}

export interface RecentEntry {
  path_or_url: string
  name: string
  visited_at: number
}

export interface ActionKey {
  label: string
  send: string
  style?: string
  repeat?: boolean
  special?: string
  auto_enter?: boolean
  grow?: number
  icon?: object
}

export interface ActionKeyboardConfig {
  rows: ActionKey[][]
}

export const DEFAULT_ACTION_KEYBOARD: ActionKeyboardConfig = {
  rows: [
    [
      { label: '🔖', send: '', special: 'bookmarks' },
      { label: 'claude', send: 'claude', auto_enter: true, icon: ClaudeLogo },
      { label: 'codex', send: 'codex', auto_enter: true, icon: CodexLogo },
      { label: 'opencode', send: 'opencode', auto_enter: true, icon: OpencodeLogo },
    ],
    [
      { label: 'esc', send: '\x1b', style: 'danger', auto_enter: true },
      { label: 'ctrl+c', send: '\x03', style: 'danger', auto_enter: true },
      { label: 'clear', send: 'clear', auto_enter: true },
      { label: '⌫', send: '\x7f', repeat: true, grow: 1.5 },
    ],
    [
      { label: 'PlanMode', send: '\x1b[Z', auto_enter: true, grow: 1.75 },
      { label: 'tab', send: '\t', grow: 1.5 },
      { label: '/', send: '/' },
      { label: '/clear', send: '/clear', auto_enter: true },
      { label: '/model', send: '/model', auto_enter: true },
    ],
  ],
}

export const settings = reactive<SettingsData>({
  theme: { preset: 'dark', custom: null },
  background: { mode: 'solid', color: null, opacity: 1.0, has_image: false },
  text: {
    font_size: 14,
    font_family: '',
    line_height: 1.2,
    letter_spacing: 0,
    cursor_style: 'block',
    cursor_blink: true,
    scrollback: 10000,
    scroll_sensitivity: 1,
    scroll_acceleration: 0,
    scrollbar_width: 8,
  },
  bookmarks: [],
  workspace_bookmarks: [],
  web_bookmarks: [],
  recent_files: [],
  recent_urls: [],
  action_keyboard: null,
  upload_dir: '',
  upload_cap_mb: 200,
  upload_file_cap_mb: 0,
  upload_cap_count: 100,
  keyboard_sound: false,
  show_virtual_keyboard: false,
  confirm_before_close_tab: true,
  windowsAltAsCmd: isWindowsClient,
  locale: 'zh',
  panel_position: 'auto',
  monitor: {
    enabled: true,
    cpu: true,
    memory: true,
    disk: false,
    network: true,
    gpu: true,
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
  ip_whitelist: ['127.0.0.1', '::1'],
  auth: {
    allowed_origins: [],
    trusted_proxies: [],
    lockout_strategy: 'ip',
    session_ttl_days: 7,
    lockout_max_failures: 5,
    lockout_secs: 60,
    global_lockout_max_failures: 50,
    global_lockout_secs: 300,
  },
  preview: {
    allow_external: false,
  },
  keybindings: {},
  log: {
    enabled: true,
    path: '',
    max_size_mb: 50,
  },
  ssh_profiles: [],
})

let loaded = false
let loadPromise: Promise<void> | null = null

export function useSettings() {
  if (!loaded) {
    loadPromise = loadSettings()
    loaded = true
  }
  return { settings, saveSettings, loadSettings, applyCurrentTheme, getCurrentXtermTheme }
}

function restoreActionIcons() {
  const cfg = settings.action_keyboard
  if (!cfg?.rows) return
  // Build a lookup from send → icon using DEFAULT_ACTION_KEYBOARD
  const iconMap = new Map<string, object>()
  for (const row of DEFAULT_ACTION_KEYBOARD.rows) {
    for (const k of row) {
      if (k.icon) iconMap.set(k.send, k.icon)
    }
  }
  for (const row of cfg.rows) {
    for (const k of row) {
      if (!k.icon) {
        const icon = iconMap.get(k.send)
        if (icon) k.icon = icon
      }
    }
  }
}

function syncActionKeyboardStorage() {
  if (typeof localStorage === 'undefined') return
  if (settings.action_keyboard) {
    localStorage.setItem('dinotty_action_keyboard', JSON.stringify(settings.action_keyboard))
  } else {
    localStorage.removeItem('dinotty_action_keyboard')
  }
}

async function loadSettings() {
  if (!hasAuthToken()) return
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/settings'))
    if (res.ok) {
      const data = await res.json()
      Object.assign(settings, data)
      restoreActionIcons()
      applyCurrentTheme()
      // Sync action keyboard to localStorage for static mobile-keyboard.js
      syncActionKeyboardStorage()
    }
  } catch (e) {
    console.error('[settings] load failed:', e)
  }
}

export async function saveSettings() {
  try {
    // Wait for initial load to complete before saving, to avoid overwriting server data with defaults
    if (loadPromise) await loadPromise
    // Sync action keyboard to localStorage for static mobile-keyboard.js
    syncActionKeyboardStorage()
    await getApiBase()
    const res = await authFetch(apiUrl('/api/settings'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    if (!res.ok) {
      console.error('[settings] save failed:', res.status, await res.text())
    }
  } catch (e) {
    console.error('[settings] save failed:', e)
  }
}

const themeChangeListeners = new Set<(xtermTheme: ReturnType<typeof getXtermTheme>) => void>()

export function onThemeChange(fn: (xtermTheme: ReturnType<typeof getXtermTheme>) => void) {
  themeChangeListeners.add(fn)
  return () => {
    themeChangeListeners.delete(fn)
  }
}

const textChangeListeners = new Set<(text: TextConfig) => void>()

export function onTextChange(fn: (text: TextConfig) => void) {
  textChangeListeners.add(fn)
  return () => {
    textChangeListeners.delete(fn)
  }
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
        '--color-black',
        '--color-red',
        '--color-green',
        '--color-yellow',
        '--color-blue',
        '--color-magenta',
        '--color-cyan',
        '--color-white',
        '--color-bright-black',
        '--color-bright-red',
        '--color-bright-green',
        '--color-bright-yellow',
        '--color-bright-blue',
        '--color-bright-magenta',
        '--color-bright-cyan',
        '--color-bright-white',
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
      const keys = [
        'black',
        'red',
        'green',
        'yellow',
        'blue',
        'magenta',
        'cyan',
        'white',
        'brightBlack',
        'brightRed',
        'brightGreen',
        'brightYellow',
        'brightBlue',
        'brightMagenta',
        'brightCyan',
        'brightWhite',
      ] as const
      custom.ansi.forEach((c, i) => {
        if (c) (xtermTheme as any)[keys[i]] = c
      })
    }
  }
  return xtermTheme
}

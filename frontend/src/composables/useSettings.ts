import { reactive, readonly, ref } from 'vue'
import { applyThemeToDOM, getXtermTheme } from '../themes'
import { getApiBase, apiUrl, authFetch, hasAuthToken } from './apiBase'
import { resolveEffectiveTheme } from './useDeviceThemeSelection'
import ClaudeLogo from '../components/icons/ClaudeLogo.vue'
import CodexLogo from '../components/icons/CodexLogo.vue'
import OpencodeLogo from '../components/icons/OpencodeLogo.vue'
import { isWindowsClient } from '../utils/clientPlatform'
import type { KeyBinding } from './useKeybindings'
import type { SavedTheme } from './useDeviceThemeSelection'
export type WorkspaceBadgeMode = 'off' | 'tab' | 'icon' | 'both'

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
  custom_themes: SavedTheme[]
  hidden_builtins: string[]
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
  action_keyboard_user_default?: ActionKeyboardConfig | null
  toolbar_quick_keys: ActionKey[]
  upload_dir: string
  default_base_dir?: string | null
  default_workspace_root?: string | null
  default_workspace_name?: string | null
  default_workspace_abbr?: string | null
  default_workspace_color?: string | null
  default_workspace_tab_badge?: boolean | null
  upload_cap_mb: number
  upload_file_cap_mb: number
  upload_cap_count: number
  keyboard_sound: boolean
  show_virtual_keyboard: boolean
  keyboard_keep_on_scroll: boolean
  workspace_badge_mode: WorkspaceBadgeMode | null
  confirm_before_close_tab: boolean
  reload_after_supervise_tabs: boolean
  space_confirms_dialogs: boolean
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
  idle_reminder: boolean
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
  plugin_series: Record<string, boolean>
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
  custom_fonts?: string[] | null
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
  kind?: 'send' | 'action'
  action?: string
  display?: 'icon' | 'text'
  send?: string
  style?: string
  shape?: 'arrow' | 'button'
  repeat?: boolean
  special?: string
  auto_enter?: boolean
  grow?: number
  icon?: object
}

export interface ActionBottomCluster {
  rows: ActionKey[][]
  enter: ActionKey
  enter_width?: number
}

export interface ActionKeyboardConfig {
  rows: ActionKey[][]
  bottom?: ActionBottomCluster
}

export const DEFAULT_ACTION_BOTTOM: ActionBottomCluster = {
  rows: [
    [ { label: 'yes',      send: 'yes\r',      grow: 1, shape: 'button' },
      { label: 'no',       send: 'no\r',       grow: 1, shape: 'button' },
      { label: '↑',        send: '\x1b[A', repeat: true, grow: 1, shape: 'arrow' } ],
    [ { label: 'continue', send: 'continue\r', grow: 2, shape: 'button' },
      { label: '↓',        send: '\x1b[B', repeat: true, grow: 1, shape: 'arrow' } ],
  ],
  enter: { label: '↵', kind: 'send', send: '\r' },
  enter_width: 0.28,
}

export const DEFAULT_ACTION_KEYBOARD: ActionKeyboardConfig & {
  rows: (ActionKey & { send: string })[][]
} = {
  rows: [
    [
      { label: '🔖', send: '', special: 'bookmarks' },
      { label: 'claude', send: 'claude', auto_enter: true, icon: ClaudeLogo },
      { label: 'codex', send: 'codex', auto_enter: true, icon: CodexLogo },
      { label: 'opencode', send: 'opencode', auto_enter: true, icon: OpencodeLogo },
    ],
    [
      { label: 'esc', send: '\x1b', style: 'danger' },
      { label: 'ctrl+c', send: '\x03', style: 'danger' },
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
  bottom: DEFAULT_ACTION_BOTTOM,
}

function normalizeActionKey(key: ActionKey): void {
  if (key.grow !== undefined) {
    if (!Number.isFinite(key.grow)) delete key.grow
    else key.grow = Math.min(12, Math.max(0.5, key.grow))
  }

  if (typeof key.kind === 'string' && key.kind !== 'send' && key.kind !== 'action') {
    key.kind = 'send'
  }

  if (key.display !== 'icon' && key.display !== 'text') delete key.display

  if (key.shape !== 'arrow' && key.shape !== 'button') delete key.shape

  if (key.kind !== 'action' || typeof key.action !== 'string' || key.action.trim() === '') return
  delete key.send
  delete key.special
  delete key.repeat
  delete key.auto_enter
  delete key.icon
}

export function normalizeActionKeyboard(
  cfg: ActionKeyboardConfig | null,
): ActionKeyboardConfig | null {
  if (cfg === null) return null

  for (const row of cfg.rows) {
    for (const key of row) normalizeActionKey(key)
  }

  const bottom = cfg.bottom
  if (!bottom) return cfg

  for (const row of bottom.rows) {
    for (const key of row) normalizeActionKey(key)
  }

  if (bottom.enter) normalizeActionKey(bottom.enter)
  if (!bottom.enter || bottom.enter.kind !== 'send' || bottom.enter.send !== '\r') {
    const label = typeof bottom.enter?.label === 'string' && bottom.enter.label.trim() !== ''
      ? bottom.enter.label
      : DEFAULT_ACTION_BOTTOM.enter.label
    bottom.enter = { ...DEFAULT_ACTION_BOTTOM.enter, label }
  }

  if (bottom.enter_width !== undefined) {
    if (!Number.isFinite(bottom.enter_width)) delete bottom.enter_width
    else bottom.enter_width = Math.min(0.5, Math.max(0.15, bottom.enter_width))
  }

  return cfg
}

function cloneActionKeyWithoutIcon(key: ActionKey): ActionKey {
  const clone = { ...key }
  delete clone.icon
  return clone
}

export function cloneWithoutIcons(cfg: ActionKeyboardConfig): ActionKeyboardConfig {
  const clone: ActionKeyboardConfig = {
    ...cfg,
    rows: cfg.rows.map((row) => row.map(cloneActionKeyWithoutIcon)),
  }
  if (cfg.bottom) {
    clone.bottom = {
      ...cfg.bottom,
      rows: cfg.bottom.rows.map((row) => row.map(cloneActionKeyWithoutIcon)),
      enter: cloneActionKeyWithoutIcon(cfg.bottom.enter),
    }
  }
  return clone
}

export function effectiveActionKeyboard(): ActionKeyboardConfig {
  const cfg = settings.action_keyboard
  if (!cfg) return DEFAULT_ACTION_KEYBOARD
  return { rows: cfg.rows ?? [], bottom: cfg.bottom ?? DEFAULT_ACTION_BOTTOM }
}

export function saveActionKeyboardUserDefault(): void {
  settings.action_keyboard_user_default = cloneWithoutIcons(effectiveActionKeyboard())
}

export function restoreActionKeyboardUserDefault(): void {
  const snapshot = settings.action_keyboard_user_default
  if (!snapshot) return
  settings.action_keyboard = cloneWithoutIcons(snapshot)
  restoreActionIcons()
}

export function resetActionKeyboard(): void {
  settings.action_keyboard = null
}

export function ensureBottom(): ActionBottomCluster {
  if (!settings.action_keyboard) {
    settings.action_keyboard = {
      rows: DEFAULT_ACTION_KEYBOARD.rows.map((row) => row.map((key) => ({ ...key }))),
    }
  }
  if (!settings.action_keyboard.bottom) {
    settings.action_keyboard.bottom = structuredClone(DEFAULT_ACTION_BOTTOM)
  }
  return settings.action_keyboard.bottom
}

export const settings = reactive<SettingsData>({
  theme: { preset: 'dark', custom: null },
  custom_themes: [],
  hidden_builtins: [],
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
    custom_fonts: null,
  },
  bookmarks: [],
  workspace_bookmarks: [],
  web_bookmarks: [],
  recent_files: [],
  recent_urls: [],
  action_keyboard: null,
  action_keyboard_user_default: null,
  toolbar_quick_keys: [],
  upload_dir: '',
  upload_cap_mb: 200,
  upload_file_cap_mb: 0,
  upload_cap_count: 100,
  keyboard_sound: false,
  show_virtual_keyboard: false,
  keyboard_keep_on_scroll: false,
  workspace_badge_mode: null,
  confirm_before_close_tab: true,
  reload_after_supervise_tabs: false,
  space_confirms_dialogs: false,
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
    plugin_series: {},
  },
  notification: {
    enabled: true,
    bell: { enabled: true, debounce_ms: 300 },
    osc_notify: true,
    idle_reminder: false,
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
let loadGeneration = 0
let loadsInFlight = 0
let loadedNotificationPresentationEcho: {
  channels?: unknown
  sounds?: unknown
} | null = null
const settingsLoadedState = ref(false)
export const settingsLoaded = readonly(settingsLoadedState)

export function __setSettingsLoadedForTest(value: boolean) {
  settingsLoadedState.value = value
}

export function __resetSettingsLoadStateForTest() {
  loaded = false
  loadPromise = null
  loadGeneration = 0
  loadsInFlight = 0
  loadedNotificationPresentationEcho = null
  settingsLoadedState.value = false
}

export function currentLoadGeneration(): number {
  return loadGeneration
}

export function isLoadInFlight(): boolean {
  return loadsInFlight > 0
}

export function useSettings() {
  if (!loaded) {
    loadPromise = loadSettings()
    loaded = true
  }
  return {
    settings,
    settingsLoaded,
    saveSettings,
    loadSettings,
    applyCurrentTheme,
    getCurrentXtermTheme,
  }
}

export function restoreActionIcons() {
  // Toolbar quick keys are plain user-defined labels/sends; do not attach default icons.
  // Build a lookup from send → icon using DEFAULT_ACTION_KEYBOARD
  const iconMap = new Map<string, object>()
  for (const row of DEFAULT_ACTION_KEYBOARD.rows) {
    for (const k of row) {
      if (k.icon && k.send !== undefined) iconMap.set(k.send, k.icon)
    }
  }

  const restoreKey = (k: ActionKey) => {
    if (k.kind === 'action' || k.icon || k.send === undefined) return
    const icon = iconMap.get(k.send)
    if (icon) k.icon = icon
  }
  const restoreConfig = (cfg: ActionKeyboardConfig | null | undefined) => {
    if (!cfg) return
    for (const row of cfg.rows) {
      for (const k of row) restoreKey(k)
    }
    if (cfg.bottom) {
      for (const row of cfg.bottom.rows) {
        for (const k of row) restoreKey(k)
      }
      if (cfg.bottom.enter) restoreKey(cfg.bottom.enter)
    }
  }

  restoreConfig(settings.action_keyboard)
  restoreConfig(settings.action_keyboard_user_default)
}

export async function loadSettings() {
  if (!hasAuthToken()) return
  let requestStarted = false
  try {
    loadGeneration++
    loadsInFlight++
    requestStarted = true
    await getApiBase()
    const res = await authFetch(apiUrl('/api/settings'))
    if (res.ok) {
      const data = await res.json()
      const notification = data?.notification as Record<string, unknown> | undefined
      if (notification) notification.idle_reminder = notification.idle_reminder === true
      loadedNotificationPresentationEcho = {
        ...(notification && Object.prototype.hasOwnProperty.call(notification, 'channels')
          ? { channels: JSON.parse(JSON.stringify(notification.channels)) }
          : {}),
        ...(notification && Object.prototype.hasOwnProperty.call(notification, 'sounds')
          ? { sounds: JSON.parse(JSON.stringify(notification.sounds)) }
          : {}),
      }
      Object.assign(settings, data)
      loadGeneration++
      settings.action_keyboard = normalizeActionKeyboard(settings.action_keyboard)
      settings.action_keyboard_user_default = normalizeActionKeyboard(
        settings.action_keyboard_user_default ?? null,
      )
      restoreActionIcons()
      applyCurrentTheme()
      settingsLoadedState.value = true
    }
  } catch (e) {
    console.error('[settings] load failed:', e)
  } finally {
    if (requestStarted) loadsInFlight = Math.max(0, loadsInFlight - 1)
  }
}

export async function saveSettings() {
  try {
    // Wait for initial load to complete before saving, to avoid overwriting server data with defaults
    if (loadPromise) await loadPromise
    // A save before any successful settings load would strip the server-owned
    // notification.channels/sounds; the server's full-overwrite PUT (#[serde(default)])
    // would then reset them to defaults across every device. Defer until a load has
    // established the presentation echo.
    if (!loadedNotificationPresentationEcho) {
      console.warn('[settings] save skipped: settings have not loaded yet')
      return
    }
    const payload = JSON.parse(JSON.stringify(settings)) as SettingsData
    if (payload.action_keyboard) {
      payload.action_keyboard = cloneWithoutIcons(payload.action_keyboard)
    }
    if (payload.action_keyboard_user_default) {
      payload.action_keyboard_user_default = cloneWithoutIcons(payload.action_keyboard_user_default)
    }
    delete (payload as unknown as Record<string, unknown>).reload_after_supervise_tabs
    const notification = payload.notification as unknown as Record<string, unknown>
    for (const key of [
      'presentation_enabled', 'channels', 'sounds', 'dnd_level', 'ignore_current_tab',
      'quiet_hours', 'coalesce_window_ms',
    ]) {
      delete notification[key]
    }
    if (loadedNotificationPresentationEcho) {
      if (Object.prototype.hasOwnProperty.call(loadedNotificationPresentationEcho, 'channels')) {
        notification.channels = JSON.parse(JSON.stringify(loadedNotificationPresentationEcho.channels))
      }
      if (Object.prototype.hasOwnProperty.call(loadedNotificationPresentationEcho, 'sounds')) {
        notification.sounds = JSON.parse(JSON.stringify(loadedNotificationPresentationEcho.sounds))
      }
    }
    await getApiBase()
    const res = await authFetch(apiUrl('/api/settings'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
  const resolved = resolveEffectiveTheme()
  applyThemeToDOM({ name: 'resolved', label: '', colors: resolved.colors })

  if (settings.background.color) {
    document.documentElement.style.setProperty('--bg', settings.background.color)
  }

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
  const resolved = resolveEffectiveTheme()
  return getXtermTheme({ name: 'resolved', label: '', colors: resolved.colors })
}

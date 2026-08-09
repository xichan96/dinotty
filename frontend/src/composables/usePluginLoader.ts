import type { Component } from 'vue'
import { reactive, ref, computed, watch, onMounted, onUnmounted, h } from 'vue'
import { authFetch, apiUrl, wsUrlWithToken, getApiBase } from './apiBase'
import { usePluginMonitorStore } from '../stores/pluginMonitor'
import type { MonitorSeries } from '../stores/pluginMonitor'
import { subscribe as eventSubscribe, emit as eventEmit } from './useEventBridge'
import type { SyncEvent } from '../types/protocol'
import { useI18n, type Locale } from './useI18n'
import { describeHttpError } from '../utils/httpError'

// Bypass Vite's static analysis of import()
// eslint-disable-next-line no-new-func
const dynamicImport: (url: string) => Promise<any> = new Function('url', 'return import(url)') as (
  url: string
) => Promise<any>

// ─── Binary helpers for ctx.crypto ──────────────────────────────────────────

function toBytes(data: string | Uint8Array): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return data
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PluginManifest {
  id: string
  name: string
  version: string
  minAppVersion?: string
  description?: string
  icon?: string
  entry?: string
  bin?: {
    mode: string
    entry?: string
    entries?: Record<string, string>
    lifecycle?: {
      scope?: 'ui' | 'host'
      stdinLease?: boolean
      shutdownDeadlineMs?: number
      forceKillAfterMs?: number
    }
  }
  commands?: Array<{ id: string; title: string }>
  styles?: string
  permissions?: string[]
  category?: string
  targets?: string[]
  showInToolbar?: boolean
}

export interface Disposable {
  dispose(): void
}

export interface QuickPickItem {
  label: string
  detail?: string
  icon?: string
  action: () => void
}

export interface QuickPickOptions {
  title: string
  items: () => QuickPickItem[] | Promise<QuickPickItem[]>
}

export type PluginLocale = Locale

export interface PluginContext {
  reactive: typeof reactive
  ref: typeof ref
  computed: typeof computed
  watch: typeof watch
  onMounted: typeof onMounted
  onUnmounted: typeof onUnmounted
  h: typeof h

  i18n: {
    getLocale(): PluginLocale
    onDidChangeLocale(callback: (locale: PluginLocale) => void): Disposable
  }

  exec: {
    run(
      args: string[],
      options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
    ): Promise<{ code: number; stdout: string; stderr: string }>
    spawn(
      args: string[],
      options?: { cwd?: string; env?: Record<string, string> }
    ): { stdout: ReadableStream<string>; stderr: ReadableStream<string>; kill(): void }
  }

  terminal: {
    send(paneId: string, data: string): void
    activePaneId(): string | null
    listPanes(): Array<{ id: string; title: string; active: boolean }>
    onOutput(callback: (paneId: string, data: string) => void): Disposable
    createTab(command?: string): Promise<string>
    /** Open a terminal tab in cwd and execute argv directly, without an intermediary shell. */
    createTerminalTab(opts: { cwd: string; argv: string[]; title?: string }): Promise<string>
  }

  settings: {
    get(): Record<string, any>
    onDidChange(callback: (settings: Record<string, any>) => void): Disposable
  }

  storage: {
    get(key: string): Promise<any>
    set(key: string, value: any): Promise<void>
    delete(key: string): Promise<void>
    list(): Promise<string[]>
  }

  commands: {
    register(id: string, handler: () => void): Disposable
    registerQuickPick(id: string, options: QuickPickOptions): Disposable
  }

  ui: {
    notify(message: string, level?: 'info' | 'warn' | 'error', title?: string): void
    confirm(message: string): Promise<boolean>
  }

  /** Open this plugin's tab in the UI */
  open(): void

  process: {
    start(
      args: string[],
      options?: { cwd?: string; env?: Record<string, string> }
    ): Promise<ProcessHandle>
    list(): Promise<ProcessInfo[]>
    stop(pid: number): Promise<void>
    stopAll(): Promise<void>
  }

  /**
   * Cryptographic helpers backed by the server. Use these instead of
   * `crypto.subtle` so plugins keep working in non-secure HTTP contexts
   * (e.g. `http://192.168.x.x`) where Web Crypto is unavailable.
   */
  crypto: {
    hash(
      algorithm: 'sha1' | 'sha256' | 'sha384' | 'sha512' | 'md5',
      data: string | Uint8Array
    ): Promise<Uint8Array>
    hmac(
      algorithm: 'sha1' | 'sha256' | 'sha384' | 'sha512' | 'md5',
      key: Uint8Array | string,
      data: string | Uint8Array
    ): Promise<Uint8Array>
    toHex(bytes: Uint8Array): string
    fromHex(hex: string): Uint8Array
  }

  events: {
    subscribe<T = unknown>(eventName: string, handler: (data: T, e: SyncEvent) => void): () => void
    emit(
      eventName: string,
      data: unknown,
      opts?: { target_plugin_id?: string },
    ): void
  }

  workspace: {
    readDir(path: string): Promise<{
      path: string
      entries: Array<{ name: string; is_dir: boolean; size: number }>
    }>
    readFile(path: string): Promise<{
      kind: string
      content: string | null
      truncated: boolean
      language: string | null
    }>
    writeFile(path: string, content: string): Promise<void>
    stat(path: string): Promise<{
      size: number
      is_dir: boolean
      modified: number | null
    }>
    watch(
      path: string,
      cb: (event: {
        type: 'file_event' | 'error'
        path?: string
        kind?: string
        message?: string
      }) => void
    ): Disposable
    mkdir(path: string): Promise<void>
    delete(path: string): Promise<void>
    rename(path: string, newName: string): Promise<void>
    move(src: string, dest: string): Promise<void>
  }

  /** 获取插件资源的 HTTP URL（不含认证信息，认证由调用方处理）
   *  @param relativePath 相对于插件目录的路径，如 './vendor/lib.js'
   *  @returns 完整 HTTP URL，路径段已 encodeURIComponent
   */
  assetUrl(relativePath: string): string

  /** 以当前认证身份请求插件资源，返回 Response。
   *  浏览器模式自动带 cookie；Tauri 模式走 tauri_fetch 带 Bearer。
   *  用于 vendor JS 等需要 header 认证的场景；JSON/图片可直接用 fetch(ctx.assetUrl(path))。
   */
  fetchAsset(relativePath: string, init?: RequestInit): Promise<Response>
}

export interface ProcessInfo {
  pid: number
  command: string
  args: string[]
  state: 'running' | 'exited'
  exitCode?: number
}

export interface ProcessHandle {
  info: ProcessInfo
  stop(): Promise<void>
}

export interface PluginExports {
  component?: Component
  dispose?: () => void
  deactivate?: () => void
  monitor?: { series: MonitorSeries[] }
}

export interface PluginModule {
  activate(context: PluginContext): PluginExports | void | Promise<PluginExports | void>
  deactivate?: () => void
}

export interface LoadedPlugin {
  id: string
  manifest: PluginManifest
  module: PluginModule
  exports: PluginExports | null
  state: 'active' | 'error'
  error?: string
  isDevLink?: boolean
}

// ─── Module Scope State ───────────────────────────────────────────────────────

export const loadedPlugins = reactive(new Map<string, LoadedPlugin>())
const pluginCommands = reactive(new Map<string, { pluginId: string; handler: () => void }>())
const pluginQuickPicks = reactive(
  new Map<string, { pluginId: string; options: QuickPickOptions }>()
)
const pluginWatchSockets = new Map<string, Set<WebSocket>>()

// ─── Window API Injection Points ──────────────────────────────────────────────

declare global {
  interface Window {
    __dinotty_terminal_api?: PluginContext['terminal']
    __dinotty_ui_notify?: PluginContext['ui']['notify']
    __dinotty_ui_confirm?: PluginContext['ui']['confirm']
    __dinotty_open_plugin?: (pluginId: string) => void
    __dinotty_settings_listener?: PluginContext['settings']['onDidChange']
    // Test hooks for P3 verification (focusActive + isComposing guard).
    __dinotty_test_focus_active?: () => void
    __dinotty_test_is_composing?: (paneId: string) => boolean
  }
}

// ─── CSS Management ───────────────────────────────────────────────────────────

function removePluginCSS(id: string) {
  document
    .querySelectorAll(`link[data-plugin-id="${id}"], style[data-plugin-id="${id}"]`)
    .forEach((el) => el.remove())
}

// ─── Plugin Context Factory (module scope) ───────────────────────────────────

function buildAssetUrl(pluginId: string, relativePath: string): string {
  const clean = relativePath.replace(/^\.\//, '')
  const segments = clean.split('/').map(encodeURIComponent)
  return apiUrl(`/api/plugins/${pluginId}/${segments.join('/')}`)
}

function createPluginContext(pluginId: string): PluginContext {
  const { locale } = useI18n()
  const exec: PluginContext['exec'] = {
    async run(args, options) {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/exec`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args, ...options }),
      })
      if (!res.ok) throw new Error(await describeHttpError(res, 'Plugin command failed'))
      return res.json()
    },
    spawn(args, options) {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const query = new URLSearchParams({ args: JSON.stringify(args) })
      if (options) query.set('options', JSON.stringify(options))
      const ws = new WebSocket(
        wsUrlWithToken(
          `${proto}//${location.host}/api/plugins/${pluginId}/spawn?${query.toString()}`
        )
      )
      let stdoutCtrl: ReadableStreamDefaultController<string>
      let stderrCtrl: ReadableStreamDefaultController<string>

      const stdout = new ReadableStream<string>({
        start(controller) {
          stdoutCtrl = controller
        },
      })
      const stderr = new ReadableStream<string>({
        start(controller) {
          stderrCtrl = controller
        },
      })

      const closeStreams = () => {
        try {
          stdoutCtrl.close()
        } catch {
          /* noop */
        }
        try {
          stderrCtrl.close()
        } catch {
          /* noop */
        }
      }

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'stdout') stdoutCtrl.enqueue(msg.data)
        if (msg.type === 'stderr') stderrCtrl.enqueue(msg.data)
        if (msg.type === 'done') closeStreams()
      }
      ws.onclose = closeStreams
      ws.onerror = closeStreams

      return { stdout, stderr, kill: () => ws.close() }
    },
  }

  const process: PluginContext['process'] = {
    async start(args, options) {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/process/start`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args, ...options }),
      })
      if (!res.ok) throw new Error(await describeHttpError(res, 'Unable to start plugin process'))
      const data = await res.json()
      return {
        info: data,
        stop: async () => {
          const stopRes = await authFetch(apiUrl(`/api/plugins/${pluginId}/process/${data.pid}`), {
            method: 'DELETE',
          })
          if (!stopRes.ok) {
            throw new Error(await describeHttpError(stopRes, 'Unable to stop plugin process'))
          }
        },
      }
    },
    async list() {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/process`))
      return res.json()
    },
    async stop(pid) {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/process/${pid}`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await describeHttpError(res, 'Unable to stop plugin process'))
    },
    async stopAll() {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/process`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await describeHttpError(res, 'Unable to stop plugin processes'))
    },
  }

  const storage: PluginContext['storage'] = {
    async get(key) {
      const res = await authFetch(
        apiUrl(`/api/plugins/${pluginId}/storage/${encodeURIComponent(key)}`)
      )
      if (res.status === 404) return undefined
      return (await res.json()).value
    },
    async set(key, value) {
      await authFetch(apiUrl(`/api/plugins/${pluginId}/storage/${encodeURIComponent(key)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
    },
    async delete(key) {
      await authFetch(apiUrl(`/api/plugins/${pluginId}/storage/${encodeURIComponent(key)}`), {
        method: 'DELETE',
      })
    },
    async list() {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/storage`))
      return (await res.json()).keys
    },
  }

  const workspace: PluginContext['workspace'] = {
    async readDir(path) {
      const res = await authFetch(
        apiUrl(`/api/plugins/${pluginId}/workspace/readDir?path=${encodeURIComponent(path)}`)
      )
      if (!res.ok) throw new Error(await describeHttpError(res, 'workspace.readDir failed'))
      return res.json()
    },
    async readFile(path) {
      const res = await authFetch(
        apiUrl(`/api/plugins/${pluginId}/workspace/readFile?path=${encodeURIComponent(path)}`)
      )
      if (!res.ok) throw new Error(await describeHttpError(res, 'workspace.readFile failed'))
      return res.json()
    },
    async writeFile(path, content) {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/workspace/file`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      })
      if (!res.ok) throw new Error(await describeHttpError(res, 'workspace.writeFile failed'))
    },
    async stat(path) {
      const res = await authFetch(
        apiUrl(`/api/plugins/${pluginId}/workspace/stat?path=${encodeURIComponent(path)}`)
      )
      if (!res.ok) throw new Error(await describeHttpError(res, 'workspace.stat failed'))
      return res.json()
    },
    watch(path, cb) {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const query = new URLSearchParams({ path })
      const ws = new WebSocket(
        wsUrlWithToken(
          `${proto}//${location.host}/ws/plugins/${pluginId}/workspace/watch?${query.toString()}`
        )
      )
      let sockets = pluginWatchSockets.get(pluginId)
      if (!sockets) {
        sockets = new Set()
        pluginWatchSockets.set(pluginId, sockets)
      }
      sockets.add(ws)
      ws.onmessage = (ev) => {
        try {
          cb(JSON.parse(ev.data))
        } catch {
          /* ignore malformed */
        }
      }
      ws.onclose = () => {
        sockets?.delete(ws)
      }
      return {
        dispose: () => {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close()
          }
          sockets?.delete(ws)
        },
      }
    },
    async mkdir(path) {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/workspace/mkdir`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      if (!res.ok) throw new Error(await describeHttpError(res, 'workspace.mkdir failed'))
    },
    async delete(path) {
      const res = await authFetch(
        apiUrl(`/api/plugins/${pluginId}/workspace/delete?path=${encodeURIComponent(path)}`),
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error(await describeHttpError(res, 'workspace.delete failed'))
    },
    async rename(path, newName) {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/workspace/rename`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, new_name: newName }),
      })
      if (!res.ok) throw new Error(await describeHttpError(res, 'workspace.rename failed'))
    },
    async move(src, dest) {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/workspace/move`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src, dest }),
      })
      if (!res.ok) throw new Error(await describeHttpError(res, 'workspace.move failed'))
    },
  }

  const commands: PluginContext['commands'] = {
    register(id, handler) {
      pluginCommands.set(id, { pluginId, handler })
      return { dispose: () => pluginCommands.delete(id) }
    },
    registerQuickPick(id, options) {
      pluginQuickPicks.set(id, { pluginId, options })
      return { dispose: () => pluginQuickPicks.delete(id) }
    },
  }

  const crypto: PluginContext['crypto'] = {
    async hash(algorithm, data) {
      const dataB64 = bytesToBase64(toBytes(data))
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/crypto/hash`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ algorithm, data: dataB64 }),
      })
      if (!res.ok) throw new Error(`crypto.hash(${algorithm}) failed: ${res.status}`)
      const { bytes } = await res.json()
      return base64ToBytes(bytes)
    },
    async hmac(algorithm, key, data) {
      const keyB64 = bytesToBase64(toBytes(key))
      const dataB64 = bytesToBase64(toBytes(data))
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/crypto/hmac`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ algorithm, key: keyB64, data: dataB64 }),
      })
      if (!res.ok) throw new Error(`crypto.hmac(${algorithm}) failed: ${res.status}`)
      const { bytes } = await res.json()
      return base64ToBytes(bytes)
    },
    toHex(bytes) {
      let hex = ''
      for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
      return hex
    },
    fromHex(hex) {
      const clean = hex.length % 2 === 0 ? hex : hex.slice(0, -1)
      const out = new Uint8Array(clean.length / 2)
      for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
      return out
    },
  }

  const context: PluginContext = {
    reactive,
    ref,
    computed,
    watch,
    onMounted,
    onUnmounted,
    h,
    i18n: {
      getLocale: () => locale.value,
      onDidChangeLocale(callback) {
        const stop = watch(locale, (locale, previous) => {
          if (locale !== previous) callback(locale)
        })
        return { dispose: stop }
      },
    },
    exec,
    process,
    crypto,
    terminal: window.__dinotty_terminal_api ?? {
      send() {},
      activePaneId: () => null,
      listPanes: () => [],
      onOutput: () => ({ dispose() {} }),
      createTab: async () => '',
      createTerminalTab: async () => '',
    },
    settings: {
      get: () => (window as any).__dinotty_settings_data ?? {},
      onDidChange: window.__dinotty_settings_listener ?? (() => ({ dispose() {} })),
    },
    storage,
    commands,
    workspace,
    ui: {
      notify: window.__dinotty_ui_notify ?? (() => {}),
      confirm: window.__dinotty_ui_confirm ?? (async () => false),
    },
    open() {
      window.__dinotty_open_plugin?.(pluginId)
    },
    events: {
      subscribe: <T = unknown>(name: string, handler: (data: T, e: SyncEvent) => void) =>
        eventSubscribe(name, handler, { pluginId: pluginId }),
      emit: (name: string, data: unknown, opts?: { target_plugin_id?: string }) =>
        eventEmit(name, data, { plugin_id: pluginId, ...opts }),
    },
    assetUrl(relativePath: string): string {
      return buildAssetUrl(pluginId, relativePath)
    },
    async fetchAsset(relativePath: string, init?: RequestInit): Promise<Response> {
      return authFetch(buildAssetUrl(pluginId, relativePath), init)
    },
  }

  return context
}

// ─── Plugin Load / Unload (module scope) ─────────────────────────────────────

async function loadPlugin(id: string): Promise<LoadedPlugin> {
  // 1. Fetch manifest
  const manifestRes = await authFetch(apiUrl(`/api/plugins/${id}/plugin.json`))
  if (!manifestRes.ok) throw new Error(`Plugin ${id}: manifest not found (${manifestRes.status})`)
  const manifest: PluginManifest = await manifestRes.json()

  // 2. Fetch main.js via authFetch (includes auth token) then import from blob URL
  const entry = manifest.entry || './main.js'
  const jsUrl = apiUrl(`/api/plugins/${id}/${entry.replace('./', '')}`)
  const jsRes = await authFetch(jsUrl)
  if (!jsRes.ok) throw new Error(`Plugin ${id}: failed to fetch ${entry} (${jsRes.status})`)
  const jsContent = await jsRes.text()
  const blob = new Blob([jsContent], { type: 'application/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  let mod: PluginModule
  try {
    mod = await dynamicImport(blobUrl)
  } catch (e: any) {
    URL.revokeObjectURL(blobUrl)
    throw new Error(`Plugin ${id}: failed to load ${jsUrl}: ${e.message}`)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }

  if (typeof mod.activate !== 'function') {
    throw new Error(`Plugin ${id}: main.js must export activate(context)`)
  }

  // 3. Load optional CSS (fetch via authFetch then inject as style element)
  if (manifest.styles) {
    const cssUrl = apiUrl(`/api/plugins/${id}/${manifest.styles.replace('./', '')}`)
    const cssRes = await authFetch(cssUrl)
    if (cssRes.ok) {
      const cssText = await cssRes.text()
      const globalSelectorRe = /(?:^|,)\s*(html|body|:root|\*)\s*[{,]/gm
      const offenders = new Set<string>()
      let m: RegExpExecArray | null
      while ((m = globalSelectorRe.exec(cssText)) !== null) {
        offenders.add(m[1])
      }
      if (offenders.size > 0) {
        console.warn(
          `[plugin ${id}] CSS uses global selector(s): ${[...offenders].join(', ')}. ` +
            `Scope to \`.plugin-host-${id}\` to avoid polluting the host UI.`
        )
      }
      const styleEl = document.createElement('style')
      styleEl.textContent = cssText
      styleEl.dataset.pluginId = id
      document.head.appendChild(styleEl)
    } else {
      console.error(`[plugin] loadPlugin(${id}): CSS fetch failed, status=${cssRes.status}`)
    }
  }

  // 4. Activate
  const context = createPluginContext(id)
  let exports: PluginExports | null = null
  try {
    const ACTIVATE_TIMEOUT_MS = 10_000
    const result = await Promise.race([
      mod.activate(context),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`activate() timed out after ${ACTIVATE_TIMEOUT_MS}ms`)),
          ACTIVATE_TIMEOUT_MS
        )
      ),
    ])
    exports = (result as PluginExports) || null
  } catch (e: any) {
    // Roll back side effects injected before activate() (CSS, commands, quickPicks)
    removePluginCSS(id)
    for (const [cmdId, entry] of pluginCommands) {
      if (entry.pluginId === id) pluginCommands.delete(cmdId)
    }
    for (const [qpId, entry] of pluginQuickPicks) {
      if (entry.pluginId === id) pluginQuickPicks.delete(qpId)
    }
    throw new Error(`Plugin ${id}: activate() threw: ${e.message}`)
  }

  // 5. Register monitor series contributions
  if (exports?.monitor?.series?.length) {
    usePluginMonitorStore().register(id, exports.monitor.series)
  }

  const plugin: LoadedPlugin = { id, manifest, module: mod, exports, state: 'active' }
  loadedPlugins.set(id, plugin)
  return plugin
}

async function unloadPlugin(id: string, options: { stopUiProcesses?: boolean } = {}) {
  const plugin = loadedPlugins.get(id)
  if (!plugin) return

  if (options.stopUiProcesses) {
    const res = await authFetch(apiUrl(`/api/plugins/${id}/process?scope=ui`), {
      method: 'DELETE',
    })
    if (!res.ok) {
      throw new Error(await describeHttpError(res, 'Unable to stop plugin UI processes'))
    }
  }

  // Unregister monitor series first so sampling stops touching plugin state
  usePluginMonitorStore().unregister(id)

  try {
    plugin.module.deactivate?.()
  } catch {
    /* noop */
  }
  try {
    plugin.exports?.deactivate?.()
  } catch {
    /* noop */
  }
  try {
    plugin.exports?.dispose?.()
  } catch {
    /* noop */
  }

  // Clean up commands
  for (const [cmdId, entry] of pluginCommands) {
    if (entry.pluginId === id) pluginCommands.delete(cmdId)
  }

  // Clean up quick picks
  for (const [qpId, entry] of pluginQuickPicks) {
    if (entry.pluginId === id) pluginQuickPicks.delete(qpId)
  }

  // Close any lingering workspace watch WebSockets the plugin forgot to dispose
  const watchSockets = pluginWatchSockets.get(id)
  if (watchSockets) {
    for (const ws of watchSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }
    pluginWatchSockets.delete(id)
  }

  removePluginCSS(id)
  loadedPlugins.delete(id)
}

// ─── Hot-reload handler (called from App.vue sync WS) ───────────────────────

let reloadTimer: ReturnType<typeof setTimeout> | null = null
const pendingReloads = new Map<string, string>()

export async function handlePluginChanged(pluginId: string, change: string) {
  // Debounce: collect events for 300ms, then batch-process
  pendingReloads.set(pluginId, change)
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(async () => {
    const tasks = Array.from(pendingReloads.entries())
    pendingReloads.clear()
    for (const [id, ch] of tasks) {
      try {
        if (ch === 'deleted') {
          await unloadPlugin(id, { stopUiProcesses: true })
        } else {
          await unloadPlugin(id, { stopUiProcesses: true })
          await usePluginLoader().loadAll()
        }
      } catch (e: any) {
        console.error(`[plugin] hot-reload failed for ${id}:`, e.message)
      }
    }
  }, 300)
}

// ─── Loader Composable ───────────────────────────────────────────────────────

export function usePluginLoader() {
  async function loadAll() {
    try {
      await getApiBase()
      const res = await authFetch(apiUrl('/api/plugins'))
      if (!res.ok) {
        console.warn('[plugin] GET /api/plugins returned', res.status)
        return
      }
      const list: Array<{
        manifest: PluginManifest
        isDevLink?: boolean
        state?: string
        error?: string
      }> = await res.json()

      for (const item of list) {
        const id = item.manifest.id
        const existing = loadedPlugins.get(id)
        if (item.state && item.state !== 'active') {
          if (existing?.state === 'active') {
            await unloadPlugin(id, { stopUiProcesses: true })
          }
          loadedPlugins.set(id, {
            id,
            manifest: item.manifest,
            module: {
              activate() {
                return {}
              },
            },
            exports: null,
            state: 'error',
            error: item.error || 'Plugin is not compatible with this host',
            isDevLink: item.isDevLink,
          })
          continue
        }
        if (existing?.state === 'active') {
          existing.manifest = item.manifest
          existing.isDevLink = item.isDevLink
          continue
        }
        if (existing) await unloadPlugin(id)
        try {
          await loadPlugin(id)
          const lp = loadedPlugins.get(id)
          if (lp) lp.isDevLink = item.isDevLink
        } catch (e: any) {
          console.error(`[plugin] loadAll: failed ${id}:`, e.message)
          loadedPlugins.set(id, {
            id,
            manifest: item.manifest,
            module: {
              activate() {
                return {}
              },
            },
            exports: null,
            state: 'error',
            error: e.message,
            isDevLink: item.isDevLink,
          })
        }
      }
    } catch (e: any) {
      console.error('[plugin] failed to load plugins:', e.message)
    }
  }

  function getPluginContext(pluginId: string): PluginContext {
    return createPluginContext(pluginId)
  }

  const allCommands = computed(() => {
    const result: Array<{ id: string; pluginId: string; handler: () => void }> = []
    for (const [id, { pluginId, handler }] of pluginCommands) {
      const plugin = loadedPlugins.get(pluginId)
      if (plugin?.state === 'active') {
        result.push({ id, pluginId, handler })
      }
    }
    return result
  })

  const allQuickPicks = computed(() => {
    const result: Array<{ id: string; pluginId: string; options: QuickPickOptions }> = []
    for (const [id, { pluginId, options }] of pluginQuickPicks) {
      const plugin = loadedPlugins.get(pluginId)
      if (plugin?.state === 'active') {
        result.push({ id, pluginId, options })
      }
    }
    return result
  })

  const pluginList = computed(() => {
    return Array.from(loadedPlugins.values())
      .map((p) => ({
        id: p.id,
        name: p.manifest.name,
        description: p.manifest.description,
        icon: p.manifest.icon,
        state: p.state,
        isDevLink: p.isDevLink,
        category: p.manifest.category,
        showInToolbar: p.manifest.showInToolbar,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  return {
    loadedPlugins,
    loadPlugin,
    unloadPlugin,
    loadAll,
    allCommands,
    allQuickPicks,
    getPluginContext,
    pluginList,
  }
}

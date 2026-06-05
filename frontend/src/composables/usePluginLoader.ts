import type { Component } from 'vue'
import { reactive, ref, computed, watch, onMounted, onUnmounted, h } from 'vue'
import { authFetch, apiUrl, wsUrlWithToken } from './apiBase'

// Bypass Vite's static analysis of import()
// eslint-disable-next-line no-new-func
const dynamicImport: (url: string) => Promise<any> =
  new Function('url', 'return import(url)') as (url: string) => Promise<any>

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PluginManifest {
  id: string
  name: string
  version: string
  minAppVersion?: string
  description?: string
  icon?: string
  entry?: string
  bin?: { mode: string; entry: string }
  commands?: Array<{ id: string; title: string }>
  styles?: string
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

export interface PluginContext {
  reactive: typeof reactive
  ref: typeof ref
  computed: typeof computed
  watch: typeof watch
  onMounted: typeof onMounted
  onUnmounted: typeof onUnmounted
  h: typeof h

  exec: {
    run(args: string[], options?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<{ code: number; stdout: string; stderr: string }>
    spawn(args: string[], options?: { cwd?: string; env?: Record<string, string> }): { stdout: ReadableStream<string>; stderr: ReadableStream<string>; kill(): void }
  }

  terminal: {
    send(paneId: string, data: string): void
    activePaneId(): string | null
    listPanes(): Array<{ id: string; title: string; active: boolean }>
    onOutput(callback: (paneId: string, data: string) => void): Disposable
    createTab(command?: string): Promise<string>
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
    notify(message: string, level?: 'info' | 'warn' | 'error'): void
    confirm(message: string): Promise<boolean>
  }

  process: {
    start(args: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<ProcessHandle>
    list(): Promise<ProcessInfo[]>
    stop(pid: number): Promise<void>
    stopAll(): Promise<void>
  }
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
}

// ─── Module Scope State ───────────────────────────────────────────────────────

export const loadedPlugins = reactive(new Map<string, LoadedPlugin>())
const pluginCommands = new Map<string, { pluginId: string; handler: () => void }>()
const pluginQuickPicks = new Map<string, { pluginId: string; options: QuickPickOptions }>()

// ─── Window API Injection Points ──────────────────────────────────────────────

declare global {
  interface Window {
    __dinotty_terminal_api?: PluginContext['terminal']
    __dinotty_ui_notify?: PluginContext['ui']['notify']
    __dinotty_ui_confirm?: PluginContext['ui']['confirm']
    __dinotty_settings_listener?: PluginContext['settings']['onDidChange']
  }
}

// ─── CSS Management ───────────────────────────────────────────────────────────

function removePluginCSS(id: string) {
  document.querySelectorAll(`link[data-plugin-id="${id}"], style[data-plugin-id="${id}"]`).forEach(el => el.remove())
}

// ─── Plugin Context Factory (module scope) ───────────────────────────────────

function createPluginContext(pluginId: string): PluginContext {
  const exec: PluginContext['exec'] = {
    async run(args, options) {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/exec`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args, ...options }),
      })
      return res.json()
    },
    spawn(args) {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(
        wsUrlWithToken(
          `${proto}//${location.host}/api/plugins/${pluginId}/spawn?args=${encodeURIComponent(JSON.stringify(args))}`
        )
      )
      let stdoutCtrl: ReadableStreamDefaultController<string>
      let stderrCtrl: ReadableStreamDefaultController<string>

      const stdout = new ReadableStream<string>({
        start(controller) { stdoutCtrl = controller },
      })
      const stderr = new ReadableStream<string>({
        start(controller) { stderrCtrl = controller },
      })

      const closeStreams = () => {
        try { stdoutCtrl.close() } catch { /* noop */ }
        try { stderrCtrl.close() } catch { /* noop */ }
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
      const data = await res.json()
      return {
        info: data,
        stop: async () => {
          await authFetch(apiUrl(`/api/plugins/${pluginId}/process/${data.pid}`), {
            method: 'DELETE',
          })
        },
      }
    },
    async list() {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/process`))
      return res.json()
    },
    async stop(pid) {
      await authFetch(apiUrl(`/api/plugins/${pluginId}/process/${pid}`), {
        method: 'DELETE',
      })
    },
    async stopAll() {
      await authFetch(apiUrl(`/api/plugins/${pluginId}/process`), {
        method: 'DELETE',
      })
    },
  }

  const storage: PluginContext['storage'] = {
    async get(key) {
      const res = await authFetch(apiUrl(`/api/plugins/${pluginId}/storage/${encodeURIComponent(key)}`))
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

  const context: PluginContext = {
    reactive, ref, computed, watch, onMounted, onUnmounted, h,
    exec,
    process,
    terminal: window.__dinotty_terminal_api ?? {
      send() {},
      activePaneId: () => null,
      listPanes: () => [],
      onOutput: () => ({ dispose() {} }),
      createTab: async () => '',
    },
    settings: {
      get: () => (window as any).__dinotty_settings_data ?? {},
      onDidChange: window.__dinotty_settings_listener ?? (() => ({ dispose() {} })),
    },
    storage,
    commands,
    ui: {
      notify: window.__dinotty_ui_notify ?? (() => {}),
      confirm: window.__dinotty_ui_confirm ?? (async () => false),
    },
  }

  return context
}

// ─── Plugin Load / Unload (module scope) ─────────────────────────────────────

async function loadPlugin(id: string): Promise<LoadedPlugin> {
  // 1. Fetch manifest
  console.log(`[plugin] loadPlugin(${id}): fetching manifest`)
  const manifestRes = await authFetch(apiUrl(`/api/plugins/${id}/plugin.json`))
  if (!manifestRes.ok) throw new Error(`Plugin ${id}: manifest not found (${manifestRes.status})`)
  const manifest: PluginManifest = await manifestRes.json()
  console.log(`[plugin] loadPlugin(${id}): manifest ok, entry=${manifest.entry || './main.js'}`)

  // 2. Fetch main.js via authFetch (includes auth token) then import from blob URL
  const entry = manifest.entry || './main.js'
  const jsUrl = apiUrl(`/api/plugins/${id}/${entry.replace('./', '')}`)
  console.log(`[plugin] loadPlugin(${id}): fetching ${jsUrl}`)
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
  console.log(`[plugin] loadPlugin(${id}): module loaded, activate=${typeof mod.activate}`)

  if (typeof mod.activate !== 'function') {
    throw new Error(`Plugin ${id}: main.js must export activate(context)`)
  }

  // 3. Load optional CSS (fetch via authFetch then inject as style element)
  if (manifest.styles) {
    const cssUrl = apiUrl(`/api/plugins/${id}/${manifest.styles.replace('./', '')}`)
    console.log(`[plugin] loadPlugin(${id}): loading CSS from ${cssUrl}`)
    const cssRes = await authFetch(cssUrl)
    console.log(`[plugin] loadPlugin(${id}): CSS response status=${cssRes.status}`)
    if (cssRes.ok) {
      const cssText = await cssRes.text()
      console.log(`[plugin] loadPlugin(${id}): CSS loaded, ${cssText.length} bytes`)
      const styleEl = document.createElement('style')
      styleEl.textContent = cssText
      styleEl.dataset.pluginId = id
      document.head.appendChild(styleEl)
    } else {
      console.error(`[plugin] loadPlugin(${id}): CSS fetch failed, status=${cssRes.status}`)
    }
  } else {
    console.log(`[plugin] loadPlugin(${id}): no styles defined in manifest`)
  }

  // 4. Activate
  const context = createPluginContext(id)
  let exports: PluginExports | null = null
  try {
    const ACTIVATE_TIMEOUT_MS = 10_000
    const result = await Promise.race([
      mod.activate(context),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`activate() timed out after ${ACTIVATE_TIMEOUT_MS}ms`)), ACTIVATE_TIMEOUT_MS)
      ),
    ])
    exports = (result as PluginExports) || null
    console.log(`[plugin] loadPlugin(${id}): activated, has component=${!!exports?.component}`)
  } catch (e: any) {
    throw new Error(`Plugin ${id}: activate() threw: ${e.message}`)
  }

  const plugin: LoadedPlugin = { id, manifest, module: mod, exports, state: 'active' }
  loadedPlugins.set(id, plugin)
  return plugin
}

async function unloadPlugin(id: string) {
  const plugin = loadedPlugins.get(id)
  if (!plugin) return

  try { plugin.module.deactivate?.() } catch { /* noop */ }
  try { plugin.exports?.dispose?.() } catch { /* noop */ }

  // Kill all managed processes for this plugin
  try {
    await authFetch(apiUrl(`/api/plugins/${id}/process`), { method: 'DELETE' })
  } catch { /* noop */ }

  // Clean up commands
  for (const [cmdId, entry] of pluginCommands) {
    if (entry.pluginId === id) pluginCommands.delete(cmdId)
  }

  // Clean up quick picks
  for (const [qpId, entry] of pluginQuickPicks) {
    if (entry.pluginId === id) pluginQuickPicks.delete(qpId)
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
          await unloadPlugin(id)
          console.log(`[plugin] hot-reload: unloaded ${id}`)
        } else {
          await unloadPlugin(id)
          await loadPlugin(id)
          console.log(`[plugin] hot-reload: reloaded ${id} (${ch})`)
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
      const res = await authFetch(apiUrl('/api/plugins'))
      if (!res.ok) {
        console.warn('[plugin] GET /api/plugins returned', res.status)
        return
      }
      const list: PluginManifest[] = await res.json()
      console.log('[plugin] loadAll: backend returned', list.length, 'plugins:', list.map(p => p.id))

      for (const manifest of list) {
        if (loadedPlugins.has(manifest.id)) {
          console.log('[plugin] loadAll: skipping', manifest.id, '(already loaded)')
          continue
        }
        try {
          await loadPlugin(manifest.id)
          console.log('[plugin] loadAll: loaded', manifest.id)
        } catch (e: any) {
          console.error(`[plugin] loadAll: failed ${manifest.id}:`, e.message)
          loadedPlugins.set(manifest.id, {
            id: manifest.id,
            manifest,
            module: { activate() { return {} } },
            exports: null,
            state: 'error',
            error: e.message,
          })
        }
      }
      console.log('[plugin] loadAll: done. loadedPlugins keys:', [...loadedPlugins.keys()])
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
    return Array.from(loadedPlugins.values()).map(p => ({
      id: p.id,
      name: p.manifest.name,
      description: p.manifest.description,
      icon: p.manifest.icon,
      state: p.state,
    }))
  })

  return { loadedPlugins, loadPlugin, unloadPlugin, loadAll, allCommands, allQuickPicks, getPluginContext, pluginList }
}

import type { Component, Ref, UnwrapRef, VNode } from 'vue'

export type MonitorSeriesScale = 'percent' | 'auto'

export interface MonitorSeriesDetailRow {
  label: string
  value: string
}

/**
 * A plugin-contributed time-series metric. The framework samples `current()`
 * (or `multiSeries()`) at the system monitor cadence (~1s) and renders a Line
 * chart in the Monitor settings tab, mirroring the built-in CPU/Memory charts.
 *
 * Provide `statusText()` to also render a compact entry in the bottom status bar;
 * omit it for a chart-only series.
 */
export interface MonitorSeries {
  /** Globally unique, recommend `plugin-id:series-name` */
  id: string
  /** Chart title in Monitor tab + status bar tooltip */
  label: string
  /** Y-axis scale: 'percent' = 0-100 fixed, 'auto' = begin-at-zero dynamic. Defaults to 'auto'. */
  scale?: MonitorSeriesScale
  /** Optional explicit line color (CSS color or hex). Defaults to a palette color. */
  color?: string
  /** Sample the current value at ~1s cadence. Return null for a gap in the chart. */
  current?: () => number | null
  /** Multi-series variant (e.g. rx + tx). When present, `current` is ignored. */
  multiSeries?: () => Array<{ label?: string; value: number | null; color?: string }>
  /** Compact status bar text. Return null to hide the status bar entry (chart still renders). */
  statusText?: () => string | null
  /** Status bar Lucide icon name. One of: Activity, Cpu, MemoryStick, HardDrive, Wifi, Gpu, Gauge, Cloud, Server, Database, Zap, Clock. Defaults to 'Activity'. */
  statusIcon?: string
  /** Detail rows shown in the click-through popover. */
  detail?: () => MonitorSeriesDetailRow[]
  /** Default visibility (applies to both chart and status bar entry). Defaults to true. */
  defaultVisible?: boolean
  /** Dynamic visibility check (e.g. hide when sensor is absent). */
  visible?: () => boolean
}

export type PluginLocale = 'en' | 'zh'

export interface PluginContext {
  // Vue 响应式 API
  reactive: <T extends object>(target: T) => UnwrapRef<T>
  ref: <T>(value: T) => Ref<T>
  computed: <T>(getter: () => T) => Ref<T>
  watch: typeof import('vue').watch
  onMounted: typeof import('vue').onMounted
  onUnmounted: typeof import('vue').onUnmounted
  h: typeof import('vue').h

  /** The Dinotty UI locale. Plugins own and render their translated strings. */
  i18n: {
    getLocale(): PluginLocale
    onDidChangeLocale(callback: (locale: PluginLocale) => void): Disposable
  }

  exec: {
    run(args: string[], options?: ExecOptions): Promise<ExecResult>
    spawn(args: string[], options?: ProcessStartOptions): SpawnHandle
  }

  terminal: {
    send(paneId: string, data: string): void
    activePaneId(): string | null
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
    get<T = any>(key: string): Promise<T | undefined>
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

  process: {
    start(args: string[], options?: ProcessStartOptions): Promise<ProcessHandle>
    list(): Promise<ProcessInfo[]>
    stop(pid: number): Promise<void>
    stopAll(): Promise<void>
  }

  events: {
    /**
     * Subscribe to a named event. Returns a dispose function.
     * The handler receives the event data and the full event envelope.
     */
    subscribe<T = unknown>(
      eventName: string,
      handler: (data: T, e: PluginEvent) => void,
    ): Disposable
    /**
     * Emit an event to other clients/plugins. `plugin_id` is automatically
     * set to this plugin's id; pass `target_plugin_id` to restrict delivery
     * to handlers subscribed by that specific plugin.
     */
    emit(
      eventName: string,
      data: unknown,
      opts?: { target_plugin_id?: string },
    ): void
  }
}

export interface PluginEvent {
  event_name: string
  data: unknown
  source_pane_id?: string
  plugin_id?: string
  target_plugin_id?: string
}

export interface ExecOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface SpawnHandle {
  stdout: ReadableStream<string>
  stderr: ReadableStream<string>
  kill(): void
}

export interface ProcessStartOptions {
  cwd?: string
  env?: Record<string, string>
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

export interface Disposable {
  dispose(): void
}

export interface PluginExports {
  /** 插件主视图的 Vue 组件 */
  component?: Component
  /** 卸载时调用 */
  dispose?: () => void
  /** 监控图表 + 状态栏贡献的 series 列表 */
  monitor?: { series: MonitorSeries[] }
}

/** 插件必须导出此函数 */
export declare function activate(context: PluginContext): PluginExports | void | Promise<PluginExports | void>

/** 插件卸载时调用（可选） */
export declare function deactivate(): void

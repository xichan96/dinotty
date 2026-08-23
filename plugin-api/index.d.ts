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

/**
 * A plugin-contributed global overlay. Rendered into the host-owned floating
 * layer (z-index band 600, sibling of #app-root) above all views — FABs, info
 * dashboards, terminal pets. The host owns dragging, position clamp, and
 * persistence; the widget only renders and owns its runtime visibility.
 */
export interface OverlayContribution {
  /** Globally unique, recommend `plugin-id:overlay-name` (like MonitorSeries.id) */
  id: string
  /** Overlay component. Host injects the plugin's own PluginContext as the `api` prop (same as PluginView). */
  component: Component
  /** Whether the widget body is interactive. Default true (clickable/draggable, only its own pixels).
   *  false = pure-display layer, pointer-events:none, never intercepts clicks;
   *  a passive layer has no drag handle — reposition it via the plugin tab's Overlays
   *  section ("Adjust position"), which temporarily lifts pointer-events. */
  interactive?: boolean
  /** Drag mode (interactive=true): 'whole' = whole widget draggable (tap = click, drag = move, FAB case);
   *  'grip' = the widget's OWN header is the drag surface: mark the header element with a
   *  `data-drag-handle` attribute (host attaches pointer capture to it, so the rest of the
   *  widget keeps its own gestures/scroll). If a grip widget declares no `[data-drag-handle]`,
   *  the whole widget becomes a strict long-press (hold ~300ms) drag surface. Default 'whole'. */
  dragHandle?: 'whole' | 'grip'
  /** Default position: viewport px or corner anchor. Default 'bottom-right' (clears the status bar). */
  defaultPosition?:
    | { x: number; y: number }
    | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** One-time visibility check, evaluated ONCE at registration (merged with defaultVisible;
   *  on throw defaults to visible). Runtime visibility is the component's own reactive state. */
  visible?: () => boolean
  defaultVisible?: boolean
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
    /** 订阅当前聚焦 pane 变化（paneId 变化即回调，替代轮询 activePaneId()）。
     *  keyboard-plugin-design.md §三 B，Phase 2。 */
    onDidChangeActivePane(callback: (paneId: string | null) => void): Disposable
    /** Returns the active terminal tab's cwd, or the last known terminal cwd,
     *  or the active workspace path. null if none are available. */
    activeCwd(): string | null
    listPanes(): Array<{ id: string; title: string; active: boolean }>
    onOutput(callback: (paneId: string, data: string) => void): Disposable
    createTab(command?: string): Promise<string>
    /** Open a terminal tab in cwd and execute argv directly, without an intermediary shell. */
    createTerminalTab(opts: { cwd: string; argv: string[]; title?: string }): Promise<string>
    /** Split the active terminal pane. Returns the new pane id, or null if no
     *  terminal tab is active. The new pane spawns a shell (use ctx.terminal.send
     *  to launch a command inside it). */
    splitTerminalPane(opts?: {
      direction?: 'horizontal' | 'vertical'
      cwd?: string
    }): Promise<string | null>
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

  /** Open this plugin's tab in the UI */
  open(): void

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

  /**
   * File system access. Paths must be absolute (use `~/` for home dir).
   * Sensitive system directories (e.g. `/etc`, `~/.ssh`) are blocked.
   * Declare `workspace.read` / `workspace.write` in manifest permissions.
   */
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
      }) => void,
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

// ===== Keyboard provider API =====
// 核心冻结块（见 .claude/doc/keyboard-plugin-design.md §4.3）：定稿后只增不改，
// 加字段/加事件 = minor 兼容；改语义/删字段 = major 走废弃期。
// 字段以 builtin（MobileKeyboard.vue）+ system（SystemKeyboardToolbar.vue）实际用量反推。

/** app-action 事件携带的附加选项 */
export interface KeyboardAppActionOptions {
  autoEnter?: boolean
}

/** 修饰键状态（modifier-change 事件携带） */
export interface KeyboardModifiers {
  ctrl: 'off' | 'once' | 'locked'
  shift: 'off' | 'once' | 'locked'
  alt: 'off' | 'once' | 'locked'
  meta: 'off' | 'once' | 'locked'
}

/** 命令历史建议（history.fetchSuggestions 返回） */
export interface KeyboardHistorySuggestion {
  command: string
  frequency: number
}

/** 键盘 -> 宿主 的事件（宿主消费并分发，如 app-action -> dispatchAppAction） */
export interface KeyboardHostEventMap {
  'app-action': { id: string; options?: KeyboardAppActionOptions }
  'bookmarks': undefined
  'dismiss': undefined
  'typing-change': { focused: boolean }
  'modifier-change': { modifiers: KeyboardModifiers }
  'focus-xterm': undefined
  'paste-text': { text: string }
  'toggle-ime': undefined
  /** 宿主收到后转发为 window CustomEvent（兼容现有 dinotty-upload-status 订阅方） */
  'upload-status': { saved?: string[]; error?: string; [key: string]: unknown }
}

/** 宿主/其他组件 -> 键盘的事件 */
export interface KeyboardIncomingEventMap {
  /**
   * 终端消费虚拟修饰键后通知（mobile modifier 被按键消耗）。
   * modifiers 为消费后的残留状态（locked 保留、once 变 off）；缺省时键盘应全量清空。
   */
  'modifiers-consumed': { paneId: string; modifiers?: KeyboardModifiers }
}

/**
 * 宿主注入给键盘 provider 的上下文（核心冻结块 #2）。
 * 组合输入时序由宿主发送管道处理（对键盘透明），键盘只调 send() 发裸数据。
 */
export interface KeyboardContext {
  /** 接口版本，宿主按此版本兼容加载 */
  version: number

  /** 键盘是否可见（双向：宿主按聚焦/tap 状态决定，键盘可写以请求显隐） */
  visible: Ref<boolean>

  /** 当前聚焦的终端 pane */
  activePaneId: Ref<string | null>

  /**
   * 输入注入。
   * target: 'active' = 当前聚焦 pane | 'broadcast' = 广播所有 pane（对应 frozenSend）
   *        | 其他 string = 指定 pane id
   * 返回 Promise，await 后再补 \r 等后续输入（builtin 现有语义）。
   */
  send(target: 'active' | 'broadcast' | string, data: string): Promise<void>

  /** 上报期望高度，宿主据此预留空间、终端缩小 */
  setDesiredHeight(h: number): void

  /** 视口变化订阅，回调带 offsetTop/baseline 供键盘定位 */
  onViewportResize(
    cb: (info: { height: number; offsetTop: number; baseline: number }) => void,
  ): Disposable

  /** i18n（PluginContext.i18n 形状 + 宿主翻译函数 t，builtin/system 实际用量） */
  i18n: PluginContext['i18n'] & {
    t(key: string, params?: Record<string, string | number>): string
  }

  /**
   * 宿主 settings 响应式单例（与宿主 useSettings().settings 同一引用，
   * 可直接绑定模板或 watch；onThemeChange/onTextChange 可经 watch 合成）。
   */
  settingsData: Record<string, any>

  /** settings 变更订阅（供不使用 vue 响应式的插件） */
  onDidChangeSettings(cb: (settings: Record<string, any>) => void): Disposable

  /** 事件通道：emit 到宿主 / 订阅宿主与其他组件的事件 */
  events: {
    emit<K extends keyof KeyboardHostEventMap>(event: K, data: KeyboardHostEventMap[K]): void
    on<K extends keyof KeyboardIncomingEventMap>(
      event: K,
      cb: (data: KeyboardIncomingEventMap[K]) => void,
    ): Disposable
  }

  /** 原生 IME 开关状态（system 键盘使用，双向：宿主同步，键盘可写以请求切换） */
  nativeImeOpen: Ref<boolean>

  /** 请求宿主切换原生 IME */
  setNativeImeOpen(open: boolean): void

  /** 命令历史/建议（suggestions 与宿主 useHistory() 同一响应式引用） */
  history: {
    suggestions: Ref<KeyboardHistorySuggestion[]>
    /** limit 默认 20，历史面板等需要更多时传入 */
    fetchSuggestions(prefix?: string, limit?: number): Promise<KeyboardHistorySuggestion[]>
    /** 防抖拉取（宿主实现 ~150ms 防抖） */
    fetchDebounced(prefix?: string): void
    deleteSuggestion(command: string): Promise<void>
  }

  /** 文件面板当前选中路径（与宿主 useSelectedPath() 同一响应式引用） */
  selectedPath: Ref<string | null>
}

/** 键盘贡献点（PluginExports.keyboard） */
export interface KeyboardContribution {
  /** 键盘渲染组件，宿主渲染到预留 band 内 */
  component: Component
  /** provider 唯一 id；缺省回落到 manifest.id（必须与之一致） */
  id?: string
  /** 期望预留高度：固定值或 'auto'（渲染后按实际测量上报） */
  desiredHeight?: number | 'auto'
  /** 用户是否需显式在设置中启用（默认 true = 需启用） */
  defaultEnabled?: boolean
}

export interface PluginExports {
  /** 插件主视图的 Vue 组件 */
  component?: Component
  /** 卸载时调用 */
  dispose?: () => void
  /** 监控图表 + 状态栏贡献的 series 列表 */
  monitor?: { series: MonitorSeries[] }
  /** 键盘 provider 贡献点（渲染进宿主预留 band） */
  keyboard?: KeyboardContribution
  /** 全局浮层贡献点（渲染进宿主 fixed overlay layer，#app-root 之外） */
  overlay?: OverlayContribution[]
}

/**
 * Plugin manifest (`plugin.json`) schema. Mirrors the backend `PluginManifest`.
 *
 * `category`, `targets`, and `showInToolbar` are optional metadata used by the
 * host UI for filtering, sorting, and toolbar visibility.
 */
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
  /** One of: 'system' | 'dev' | 'ai' | 'files' | 'network' | 'other' */
  category?: string
  /** Supported host targets, e.g. ['macos-aarch64', 'linux-x86_64']. Omit = all platforms. */
  targets?: string[]
  /** Whether the plugin should appear in the toolbar dropdown by default. Defaults to true. */
  showInToolbar?: boolean
  /** Required KeyboardContext.version for keyboard contributions. Host rejects higher versions. */
  keyboardApiVersion?: number
}

/** 插件必须导出此函数 */
export declare function activate(context: PluginContext): PluginExports | void | Promise<PluginExports | void>

/** 插件卸载时调用（可选） */
export declare function deactivate(): void

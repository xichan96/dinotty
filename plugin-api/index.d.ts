import type { Component, Ref, UnwrapRef } from 'vue'

export interface PluginContext {
  // Vue 响应式 API
  reactive: <T extends object>(target: T) => UnwrapRef<T>
  ref: <T>(value: T) => Ref<T>
  computed: <T>(getter: () => T) => Ref<T>
  watch: typeof import('vue').watch
  onMounted: typeof import('vue').onMounted
  onUnmounted: typeof import('vue').onUnmounted
  h: typeof import('vue').h

  exec: {
    run(args: string[], options?: ExecOptions): Promise<ExecResult>
    spawn(args: string[], options?: ExecOptions): SpawnHandle
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
}

/** 插件必须导出此函数 */
export declare function activate(context: PluginContext): PluginExports | void | Promise<PluginExports | void>

/** 插件卸载时调用（可选） */
export declare function deactivate(): void

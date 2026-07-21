import type { ClientMsg, ServerMsg } from '../types/protocol'
import { wsUrlWithToken } from './apiBase'

export interface Transport {
  send(msg: ClientMsg): void
  onMessage(handler: (msg: ServerMsg) => void): void
  onConnect(handler: () => void): void
  onDisconnect(handler: () => void): void
  disconnect(): void
}

export function isTauri(): boolean {
  const w = window as any
  const hasIpc = !!(w.__TAURI_INTERNALS__?.invoke || w.__TAURI__?.core?.invoke)
  if (!hasIpc) return false
  // Tauri injects its IPC bootstrap into every page the webview loads,
  // including remotely-served ones (e.g. the Android thin client pointed at a
  // Dinotty server). Tauri mode is only valid on the app's own bundled/dev
  // origins; a remote origin must use browser mode (cookies + WebSocket) —
  // its host has none of the desktop IPC commands.
  const { protocol, hostname } = location
  return (
    protocol === 'tauri:' ||
    hostname === 'tauri.localhost' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  )
}

export function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const tauri = (window as any).__TAURI__
  const invoke =
    tauri?.core?.invoke ??
    ((c: string, a?: object) => (window as any).__TAURI_INTERNALS__.invoke(c, a ?? {}))
  return invoke(cmd, args ?? {})
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null
  private _messageHandler: ((msg: ServerMsg) => void) | null = null
  private _connectHandler: (() => void) | null = null
  private _disconnectHandler: (() => void) | null = null
  private _destroyed = false
  private _reconnectAttempts = 0
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private paneId: string,
    private host?: string
  ) {
    this._connect()
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  onMessage(handler: (msg: ServerMsg) => void) {
    this._messageHandler = handler
  }

  onConnect(handler: () => void) {
    this._connectHandler = handler
  }

  onDisconnect(handler: () => void) {
    this._disconnectHandler = handler
  }

  disconnect() {
    this._destroyed = true
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    if (this.ws) {
      this.ws.close(1000)
      this.ws = null
    }
  }

  private _connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = this.host || location.host
    const url = wsUrlWithToken(`${proto}//${host}/ws?paneId=${encodeURIComponent(this.paneId)}`)
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this._reconnectAttempts = 0
      this._connectHandler?.()
    }

    this.ws.onmessage = (e) => {
      try {
        const msg: ServerMsg = JSON.parse(e.data)
        this._messageHandler?.(msg)
      } catch {}
    }

    this.ws.onclose = (e) => {
      if (this._destroyed) return
      this._disconnectHandler?.()
      if (e.code !== 1000) {
        this._scheduleReconnect()
      }
    }

    this.ws.onerror = () => {}
  }

  private _scheduleReconnect() {
    if (this._destroyed) return
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000)
    this._reconnectAttempts++
    this._reconnectTimer = setTimeout(() => this._connect(), delay)
  }
}

export class TauriIpcTransport implements Transport {
  private _messageHandler: ((msg: ServerMsg) => void) | null = null
  private _connectHandler: (() => void) | null = null
  private _disconnectHandler: (() => void) | null = null
  private _unlistenFns: Array<() => void> = []

  constructor(private paneId: string) {
    this._init()
  }

  private _invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    return tauriInvoke(cmd, { paneId: this.paneId, ...args })
  }

  private async _init() {
    const tauri = (window as any).__TAURI__
    const listen = tauri?.event?.listen
    if (!listen) {
      console.error('Tauri event API missing; enable app.withGlobalTauri in tauri.conf.json')
      this._disconnectHandler?.()
      return
    }

    this._unlistenFns.push(
      await listen('pty-output', (e: any) => {
        if (e.payload.pane_id === this.paneId) {
          this._messageHandler?.({ type: 'output', data: e.payload.data })
        }
      })
    )
    this._unlistenFns.push(
      await listen('pty-reconnected', (e: any) => {
        const p = e.payload
        if (p.pane_id === this.paneId) {
          this._messageHandler?.({ type: 'reconnected', cols: p.cols, rows: p.rows })
        }
      })
    )
    this._unlistenFns.push(
      await listen('pty-resize', (e: any) => {
        const p = e.payload
        if (p.pane_id === this.paneId) {
          this._messageHandler?.({ type: 'resize', cols: p.cols, rows: p.rows })
        }
      })
    )
    this._unlistenFns.push(
      await listen('pty-exit', (e: any) => {
        if (e.payload.pane_id === this.paneId) {
          this._disconnectHandler?.()
        }
      })
    )
    this._unlistenFns.push(
      await listen('pty-sync', (e: any) => {
        if (e.payload.pane_id === this.paneId) {
          this._messageHandler?.({ type: e.payload.active ? 'sync_begin' : 'sync_end' })
        }
      })
    )
    this._unlistenFns.push(
      await listen('pty-replay-begin', (e: any) => {
        if (e.payload.pane_id === this.paneId) {
          this._messageHandler?.({
            type: 'replay_begin',
            cols: e.payload.cols,
            rows: e.payload.rows,
          })
        }
      })
    )
    this._unlistenFns.push(
      await listen('pty-replay-end', (e: any) => {
        if (e.payload.pane_id === this.paneId) {
          this._messageHandler?.({ type: 'replay_end' })
        }
      })
    )

    try {
      const shellType: string = (await this._invoke('pty_spawn')) as string
      this._connectHandler?.()
      this._messageHandler?.({ type: 'shell_info', shell_type: shellType })
    } catch (e) {
      console.error('pty_spawn failed:', e)
      this._disconnectHandler?.()
    }
  }

  send(msg: ClientMsg) {
    if (msg.type === 'input') {
      this._invoke('pty_write', { data: msg.data }).catch((err: unknown) => {
        const errStr = typeof err === 'string' ? err : String(err)
        if (errStr.includes('timeout') || errStr.includes('exited')) {
          this._disconnectHandler?.()
        }
      })
    } else if (msg.type === 'resize') {
      this._invoke('pty_resize', { cols: msg.cols, rows: msg.rows }).catch(() => {})
    } else if (msg.type === 'snapshot_request') {
      this._invoke('pty_snapshot_request', { cols: msg.cols, rows: msg.rows }).catch((err: unknown) => {
        console.error('pty_snapshot_request failed:', err)
      })
    }
  }

  onMessage(handler: (msg: ServerMsg) => void) {
    this._messageHandler = handler
  }

  onConnect(handler: () => void) {
    this._connectHandler = handler
  }

  onDisconnect(handler: () => void) {
    this._disconnectHandler = handler
  }

  disconnect() {
    this._invoke('pty_detach')
    for (const u of this._unlistenFns) {
      u()
    }
    this._unlistenFns = []
  }
}

export function createTransport(paneId: string, host?: string): Transport {
  if (isTauri()) {
    return new TauriIpcTransport(paneId)
  }
  return new WebSocketTransport(paneId, host)
}

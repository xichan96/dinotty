import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import type { ClientMsg, ServerMsg } from '../types/protocol'
import { isTauri, createTransport, type Transport } from './useTransport'
import { onThemeChange, settings, onTextChange } from './useSettings'
import { wsUrlWithToken } from './apiBase'

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

let tauriDragDropRegistered = false
let lastFocusedInstance: TerminalInstance | null = null

// Guard for Tauri WKWebView multi-focus: only the active pane should send input.
let _activePaneId: string | null = null
export function setActivePaneId(paneId: string | null) { _activePaneId = paneId }

function setupGlobalTauriDragDrop() {
  if (tauriDragDropRegistered) return
  tauriDragDropRegistered = true

  const w = window as any
  const listen = w.__TAURI__?.event?.listen
  if (!listen) return

  listen('file-drop-paths', (event: any) => {
    const paths: string[] = event.payload || []
    if (paths.length > 0 && lastFocusedInstance) {
      const escaped = paths.map((p: string) =>
        /[\s'"\\()&;|<>$!`{}[\]#?*~]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
      )
      lastFocusedInstance.sendData(escaped.join(' '))
    }
  })
}

export class TerminalInstance {
  paneId: string
  xterm: XTerm | null = null
  fitAddon: FitAddon | null = null
  searchAddon: SearchAddon | null = null
  ws: WebSocket | null = null
  private _transport: Transport | null = null

  private _wrapper: HTMLElement | null = null
  private _destroyed = false
  private _reconnectAttempts = 0
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _onDataRegistered = false
  private _overlay: HTMLElement | null = null
  private _suppressTitleChange = false
  private _touchCleanup: (() => void) | null = null
  private _focusinCleanup: (() => void) | null = null
  private _compositionCleanup: (() => void) | null = null
  private _compositionGuard: ((data: string) => boolean) | null = null
  private _resizeObserver: ResizeObserver | null = null
  private _themeUnsub: (() => void) | null = null
  private _textUnsub: (() => void) | null = null
  private _refitRaf: number = 0
  private _lastCols = 0
  private _lastRows = 0
  private _lastInputData = ''
  private _lastInputTime = 0
  touchMoved = false
  private _visibilityHandler: (() => void) | null = null
  private _dragDropCleanup: (() => void) | null = null
  private _initialResizeTimer: ReturnType<typeof setInterval> | null = null

  onTitleChange: ((title: string) => void) | null = null
  onShellInfo: ((shell: string) => void) | null = null
  onConnect: (() => void) | null = null
  onDisconnect: (() => void) | null = null
  onFileClick: ((path: string, x?: number, y?: number) => void) | null = null
  onPreviewLink: ((url: string, x?: number, y?: number) => void) | null = null
  onRawOutput: ((data: string) => void) | null = null
  onInput: ((data: string) => void) | null = null

  constructor(paneId: string) {
    this.paneId = paneId
  }

  attach(wrapper: HTMLElement) {
    this._wrapper = wrapper

    const s = getComputedStyle(document.documentElement)
    const v = (name: string) => s.getPropertyValue(name).trim()

    const fontFamily = settings.text.font_family || v('--font-mono')

    this.xterm = new XTerm({
      cursorBlink: settings.text.cursor_blink,
      cursorStyle: settings.text.cursor_style as any,
      scrollback: settings.text.scrollback,
      fontSize: settings.text.font_size,
      fontFamily,
      lineHeight: settings.text.line_height,
      letterSpacing: settings.text.letter_spacing,
      allowProposedApi: true,
      linkHandler: {
        activate: (_event, text) => {
          const uri = text.startsWith('http') ? text : `http://${text}`
          if (this.onPreviewLink) {
            this.onPreviewLink(uri)
          } else {
            window.open(uri, '_blank')
          }
        },
      },
      theme: {
        background: v('--bg') || '#1A1A1A',
        foreground: v('--fg') || '#C7C7C7',
        cursor: v('--fg-muted') || '#666666',
        cursorAccent: v('--color-black') || '#000000',
        selectionBackground: 'rgba(77,127,255,0.35)',
        black: v('--color-black') || '#000000',
        red: v('--color-red') || '#C91B00',
        green: v('--color-green') || '#00C200',
        yellow: v('--color-yellow') || '#C7C400',
        blue: v('--color-blue') || '#0225C7',
        magenta: v('--color-magenta') || '#CA30C7',
        cyan: v('--color-cyan') || '#00C5C7',
        white: v('--color-white') || '#C7C7C7',
        brightBlack: v('--color-bright-black') || '#686868',
        brightRed: v('--color-bright-red') || '#FF6E67',
        brightGreen: v('--color-bright-green') || '#5FFA68',
        brightYellow: v('--color-bright-yellow') || '#FFFC67',
        brightBlue: v('--color-bright-blue') || '#6871FF',
        brightMagenta: v('--color-bright-magenta') || '#FF77FF',
        brightCyan: v('--color-bright-cyan') || '#60FDFF',
        brightWhite: v('--color-bright-white') || '#FFFFFF',
      },
    })

    this.fitAddon = new FitAddon()
    this.xterm.loadAddon(this.fitAddon)

    this.xterm.open(wrapper)

    const unicode11 = new Unicode11Addon()
    this.xterm.loadAddon(unicode11)
    this.xterm.unicode.activeVersion = '11'

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      this.xterm.loadAddon(webgl)
    } catch { /* DOM renderer fallback */ }

    this.searchAddon = new SearchAddon()
    this.xterm.loadAddon(this.searchAddon)

    const textarea = wrapper.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    if (textarea && isTouchDevice()) {
      textarea.inputMode = 'none'
      textarea.setAttribute('virtualkeyboardpolicy', 'manual')
    }
    if (textarea) {
      let compositionJustEnded = false
      let compositionData = ''
      const onCompositionEnd = (e: Event) => {
        compositionJustEnded = true
        compositionData = ''
        setTimeout(() => { compositionJustEnded = false; compositionData = '' }, 0)
      }
      textarea.addEventListener('compositionend', onCompositionEnd)
      this._compositionCleanup = () => {
        textarea.removeEventListener('compositionend', onCompositionEnd)
      }
      this._compositionGuard = (data: string): boolean => {
        if (!compositionJustEnded) return true
        if (compositionData === '') {
          compositionData = data
          return true
        }
        if (data === compositionData) return false
        return true
      }
    }

    // Register file path link provider
    this.xterm.registerLinkProvider({
      provideLinks: (bufferLineNumber: number, callback: (links: any[] | undefined) => void) => {
        const line = this.xterm!.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString()
        const regex = /(?:^|\s)((?:\/|\.\/|~\/)[^\s:]+)/g
        const links: any[] = []
        let match
        while ((match = regex.exec(text)) !== null) {
          const path = match[1]
          const startX = match.index + (match[0].length - match[1].length)
          links.push({
            range: { start: { x: startX + 1, y: bufferLineNumber }, end: { x: startX + path.length + 1, y: bufferLineNumber } },
            text: path,
            activate: (event: MouseEvent) => { this.onFileClick?.(path, event.clientX, event.clientY) },
          })
        }
        callback(links.length > 0 ? links : undefined)
      },
    })

    // Register URL link provider (localhost → preview, others → new tab)
    this.xterm.registerLinkProvider({
      provideLinks: (bufferLineNumber: number, callback: (links: any[] | undefined) => void) => {
        const line = this.xterm!.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString()
        const regex = /(?:https?:\/\/[^\s"'<>]+|(?:www\.)[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})+(?:\/[^\s"'<>]*)?)/g
        const links: any[] = []
        let match
        while ((match = regex.exec(text)) !== null) {
          const raw = match[0]
          const uri = raw.startsWith('http') ? raw : `http://${raw}`
          const startX = match.index
          links.push({
            range: { start: { x: startX + 1, y: bufferLineNumber }, end: { x: startX + raw.length + 1, y: bufferLineNumber } },
            text: uri,
            activate: (event: MouseEvent) => {
              if (this.onPreviewLink) {
                this.onPreviewLink(uri, event.clientX, event.clientY)
              } else {
                window.open(uri, '_blank')
              }
            },
          })
        }
        callback(links.length > 0 ? links : undefined)
      },
    })

    // Retry the initial resize until it actually reaches the server.
    // On new tabs the WebGL renderer and WebSocket may not be ready when the
    // first RAF fires, so we loop until _doFitAndResize successfully sends.
    this._scheduleInitialResize()

    this.xterm.onTitleChange((title) => {
      if (this._suppressTitleChange) return
      this.onTitleChange?.(title)
    })

    if (isTauri()) {
      this._connectViaTransport()
    } else {
      this._connectWS()
    }
    this._setupDragDrop(wrapper)
    this._setupTouchScroll(wrapper)

    this._resizeObserver = new ResizeObserver(() => this._refit())
    this._resizeObserver.observe(wrapper)

    this._visibilityHandler = () => {
      if (!document.hidden) this._doFitAndResize(true)
    }
    document.addEventListener('visibilitychange', this._visibilityHandler)

    this._themeUnsub = onThemeChange((xtermTheme) => {
      if (this.xterm) this.xterm.options.theme = xtermTheme
    })

    this._textUnsub = onTextChange((text) => {
      if (!this.xterm) return
      this.xterm.options.fontSize = text.font_size
      this.xterm.options.fontFamily = text.font_family || getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
      this.xterm.options.lineHeight = text.line_height
      this.xterm.options.letterSpacing = text.letter_spacing
      this.xterm.options.cursorBlink = text.cursor_blink
      this.xterm.options.cursorStyle = text.cursor_style as any
      this.xterm.options.scrollback = text.scrollback
      this._refit()
    })
  }

  focus() {
    this.xterm?.focus()
  }

  blur() {
    this.xterm?.blur()
  }

  fit() {
    this._refit()
  }

  sendData(data: string, force = false) {
    // Guard: only the active pane sends input (prevents WKWebView multi-focus duplication)
    if (!force && _activePaneId !== null && _activePaneId !== this.paneId) return
    if (this._transport) {
      this._transport.send({ type: 'input', data })
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data } as ClientMsg))
    }
  }

  getSelection(): string {
    return this.xterm?.getSelection() ?? ''
  }

  selectAll() {
    this.xterm?.selectAll()
  }

  pasteText(text: string) {
    this.sendData(text)
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    if (this._initialResizeTimer) clearInterval(this._initialResizeTimer)
    if (this._refitRaf) cancelAnimationFrame(this._refitRaf)
    this._resizeObserver?.disconnect()
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler)
    }
    this._touchCleanup?.()
    this._focusinCleanup?.()
    this._compositionCleanup?.()
    this._dragDropCleanup?.()
    this._themeUnsub?.()
    this._textUnsub?.()
    if (this._transport) {
      this._transport.disconnect()
      this._transport = null
    }
    if (this.ws) {
      this.ws.close(1000)
      this.ws = null
    }
    if (this.xterm) {
      const xt = this.xterm
      this.xterm = null
      this.fitAddon = null
      try { xt.dispose() } catch { /* already disposed or addon race */ }
    }
  }

  private _connectViaTransport() {
    this._transport = createTransport(this.paneId)

    this._transport.onConnect(() => {
      this.onConnect?.()
      this._doFitAndResize(true)
    })

    this._transport.onMessage((msg) => {
      if (this._destroyed || !this.xterm) return
      if (msg.type === 'output') {
        this.xterm.write(msg.data)
        this.onRawOutput?.(msg.data)
      } else if (msg.type === 'shell_info') {
        this.onShellInfo?.(msg.shell_type)
      } else if (msg.type === 'reconnected') {
        this._suppressTitleChange = true
        this.xterm.reset()
        this._suppressTitleChange = false
        this._doFitAndResize(true)
      }
    })

    this._transport.onDisconnect(() => {
      this.onDisconnect?.()
    })

    if (!this._onDataRegistered) {
      this._onDataRegistered = true
      this.xterm!.onData((data) => {
        if (this._compositionGuard && !this._compositionGuard(data)) return
        // Guard: only the active pane sends input (prevents WKWebView multi-focus duplication)
        if (_activePaneId !== null && _activePaneId !== this.paneId) return
        // Deduplicate: WKWebView may fire onData twice for the same keystroke
        const now = performance.now()
        if (data === this._lastInputData && now - this._lastInputTime < 5) return
        this._lastInputData = data
        this._lastInputTime = now
        this.onInput?.(data)
        this._transport?.send({ type: 'input', data })
      })
    }
  }

  // ── Private ──────────────────────────────────────────────

  private _connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = wsUrlWithToken(`${proto}//${location.host}/ws?paneId=${encodeURIComponent(this.paneId)}`)
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this._reconnectAttempts = 0
      this._hideOverlay()
      this.onConnect?.()
      this._doFitAndResize(true)
    }

    this.ws.onmessage = (e) => {
      if (this._destroyed) return
      let msg: ServerMsg
      try { msg = JSON.parse(e.data) } catch { return }
      if (!this.xterm) return
      if (msg.type === 'reconnected') {
        this._suppressTitleChange = true
        this.xterm.reset()
        this._suppressTitleChange = false
        this._reconnectAttempts = 0
        this._hideOverlay()
        this._doFitAndResize(true)
      } else if (msg.type === 'output') {
        this.xterm.write(msg.data)
        this.onRawOutput?.(msg.data)
      } else if (msg.type === 'shell_info') {
        this.onShellInfo?.(msg.shell_type)
      }
    }

    this.ws.onclose = (e) => {
      if (this._destroyed) return
      this.onDisconnect?.()
      if (e.code === 1000) {
        this.xterm?.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n')
      } else {
        this._scheduleReconnect()
      }
    }

    this.ws.onerror = (e) => {
      console.error(`[TerminalInstance] WS error: pane=${this.paneId}`, e)
    }

    if (!this._onDataRegistered) {
      this._onDataRegistered = true
      this.xterm!.onData((data) => {
        if (this._compositionGuard && !this._compositionGuard(data)) return
        // Guard: only the active pane sends input (prevents WKWebView multi-focus duplication)
        if (_activePaneId !== null && _activePaneId !== this.paneId) return
        // Deduplicate: WKWebView may fire onData twice for the same keystroke
        const now = performance.now()
        if (data === this._lastInputData && now - this._lastInputTime < 5) return
        this._lastInputData = data
        this._lastInputTime = now
        this.onInput?.(data)
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'input', data } as ClientMsg))
        }
      })
    }
  }

  private _scheduleReconnect() {
    if (this._destroyed) return
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000)
    this._reconnectAttempts++
    this._showOverlay()
    this._reconnectTimer = setTimeout(() => this._connectWS(), delay)
  }

  private _showOverlay() {
    if (!this._wrapper || this._overlay) return
    this._overlay = document.createElement('div')
    this._overlay.className = 'reconnect-overlay'

    const text = document.createElement('span')
    text.textContent = 'Connection lost. Reconnecting...'

    const btn = document.createElement('button')
    btn.className = 'reconnect-retry-btn'
    btn.textContent = 'Retry Now'
    btn.addEventListener('click', () => {
      window.location.reload()
    })

    this._overlay.appendChild(text)
    this._overlay.appendChild(btn)
    this._wrapper.style.position = 'relative'
    this._wrapper.appendChild(this._overlay)
  }

  private _hideOverlay() {
    if (this._overlay) {
      this._overlay.remove()
      this._overlay = null
    }
  }

  _refit() {
    if (!this.fitAddon || !this._wrapper) return
    if (this._refitRaf) return
    this._refitRaf = requestAnimationFrame(() => {
      this._refitRaf = 0
      this._doFitAndResize()
    })
  }

  /**
   * Retry the initial resize in a loop until it succeeds.
   * Handles the race where the WebGL renderer, DOM layout, or WebSocket
   * aren't ready when the first attempt fires.
   */
  private _scheduleInitialResize() {
    if (this._initialResizeTimer) return
    let attempts = 0
    const MAX_ATTEMPTS = 40 // 40 × 50ms = 2s max
    this._initialResizeTimer = setInterval(() => {
      attempts++
      if (this._destroyed || attempts > MAX_ATTEMPTS) {
        if (this._initialResizeTimer) {
          clearInterval(this._initialResizeTimer)
          this._initialResizeTimer = null
        }
        return
      }
      // If we've already sent a resize (lastCols/lastRows are non-zero), stop.
      if (this._lastCols > 0 && this._lastRows > 0) {
        clearInterval(this._initialResizeTimer!)
        this._initialResizeTimer = null
        return
      }
      this._doFitAndResize(true)
    }, 50)
  }

  private _doFitAndResize(force = false) {
    if (!this.fitAddon || !this.xterm || !this._wrapper) return
    const rect = this._wrapper.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    try { this.fitAddon.fit() } catch { return }
    const cols = this.xterm.cols
    const rows = this.xterm.rows
    if (cols < 2 || rows < 2) return
    if (!force && cols === this._lastCols && rows === this._lastRows) return
    const heightChanged = rows !== this._lastRows
    this._lastCols = cols
    this._lastRows = rows
    if (heightChanged && !this.isMouseModeEnabled()) {
      this.xterm.scrollToBottom()
    }
    const resizeMsg: ClientMsg = { type: 'resize', cols, rows }
    if (this._transport) {
      this._transport.send(resizeMsg)
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(resizeMsg))
    }
  }

  private _setupDragDrop(wrapper: HTMLElement) {
    if (isTauri()) {
      lastFocusedInstance = this
      const handler = () => { lastFocusedInstance = this }
      wrapper.addEventListener('focusin', handler)
      this._focusinCleanup = () => wrapper.removeEventListener('focusin', handler)
      setupGlobalTauriDragDrop()
    }

    // Listen for custom 'terminal-drop-path' events dispatched by the file tree
    // when Tauri's native layer intercepts HTML5 drop events.
    const dropPathHandler = ((e: CustomEvent) => {
      const path = e.detail?.path as string
      if (!path) return
      const escaped = /[\s'"\\()&;|<>$!`{}[\]#?*~]/.test(path)
        ? `'${path.replace(/'/g, "'\\''")}'`
        : path
      this.sendData(escaped)
    }) as EventListener
    wrapper.addEventListener('terminal-drop-path', dropPathHandler)

    const xtermEl = wrapper.querySelector('.xterm') as HTMLElement
    const target = xtermEl || wrapper

    const dragoverHandler = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e as DragEvent).dataTransfer!.dropEffect = 'copy'
    }
    target.addEventListener('dragover', dragoverHandler, true)

    const dropHandler = (e: Event) => {
      const de = e as DragEvent
      de.preventDefault()
      de.stopPropagation()

      const dt = de.dataTransfer!
      const types = Array.from(dt.types)
      const paths: string[] = []

      if (types.includes('text/uri-list')) {
        const uriList = dt.getData('text/uri-list')
        uriList.split('\n').forEach((u) => {
          u = u.trim()
          if (!u || u.startsWith('#')) return
          try { paths.push(decodeURIComponent(new URL(u).pathname)) } catch {}
        })
      }

      if (paths.length === 0 && types.includes('text/plain')) {
        const text = dt.getData('text/plain').trim()
        const absPlain =
          text &&
          (text.startsWith('/') ||
            /^[A-Za-z]:[\\/]/.test(text) ||
            text.startsWith('\\\\'))
        if (absPlain) {
          text.split('\n').forEach((l) => { if (l.trim()) paths.push(l.trim()) })
        }
      }

      if (paths.length === 0 && dt.files.length > 0) {
        Array.from(dt.files).forEach((f: any) => {
          if (f.path) paths.push(f.path)
          else if (f.name) paths.push(f.name)
        })
      }

      if (paths.length > 0) {
        const escaped = paths.map((p) =>
          /[\s'"\\()&;|<>$!`{}[\]#?*~]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
        )
        this.sendData(escaped.join(' '))
      }
    }
    target.addEventListener('drop', dropHandler, true)

    this._dragDropCleanup = () => {
      wrapper.removeEventListener('terminal-drop-path', dropPathHandler)
      target.removeEventListener('dragover', dragoverHandler, true)
      target.removeEventListener('drop', dropHandler, true)
    }
  }

  private _setupTouchScroll(wrapper: HTMLElement) {
    requestAnimationFrame(() => {
      const screen = wrapper.querySelector('.xterm-screen') as HTMLElement
      const viewport = wrapper.querySelector('.xterm-viewport') as HTMLElement
      if (!screen || !viewport) return

      // Prevent native browser scroll on the viewport from conflicting with our
      // custom touch-to-wheel translation.  Without this, both the browser's
      // overflow-y:scroll and our JS handler fire simultaneously → chaotic scroll.
      wrapper.style.touchAction = 'none'

      let startX = 0
      let startY = 0
      let lastY = 0
      let lastTime = 0
      let accumulatedDeltaY = 0
      let velocity = 0
      let momentumId = 0
      let mode: 'undecided' | 'scroll' | 'select' = 'undecided'
      const THRESHOLD = 10
      const SCROLL_THRESHOLD = 12 // Lower threshold for more responsive feel

      const clearMomentum = () => {
        if (momentumId) { cancelAnimationFrame(momentumId); momentumId = 0 }
      }

      const onTouchStart = (e: TouchEvent) => {
        clearMomentum()
        this.touchMoved = false
        startX = e.touches[0].clientX
        startY = e.touches[0].clientY
        lastY = startY
        lastTime = Date.now()
        accumulatedDeltaY = 0
        velocity = 0
        mode = 'undecided'
      }
      const onTouchMove = (e: TouchEvent) => {
        const cx = e.touches[0].clientX
        const cy = e.touches[0].clientY
        const now = Date.now()
        if (mode === 'undecided') {
          const dx = Math.abs(cx - startX)
          const dy = Math.abs(cy - startY)
          if (dy > THRESHOLD || dx > THRESHOLD) {
            mode = dy > dx ? 'scroll' : 'select'
            if (mode === 'scroll') this.touchMoved = true
          } else {
            return
          }
        }
        if (mode === 'scroll') {
          e.preventDefault() // suppress native scroll — safe because passive: false
          const deltaY = lastY - cy
          const dt = now - lastTime || 1
          velocity = deltaY / dt // px/ms
          accumulatedDeltaY += deltaY

          if (this.xterm && Math.abs(accumulatedDeltaY) >= SCROLL_THRESHOLD) {
            this._sendWheelEvent(screen, accumulatedDeltaY, cx, cy)
            accumulatedDeltaY = 0
          }
        }
        lastY = cy
        lastTime = now
      }

      const onTouchEnd = () => {
        if (mode !== 'scroll') return
        // Flush remaining delta
        if (this.xterm && Math.abs(accumulatedDeltaY) > 2) {
          this._sendWheelEvent(screen, accumulatedDeltaY, lastY, lastY)
        }
        accumulatedDeltaY = 0

        // Momentum: keep sending wheel events with decaying velocity
        if (this.xterm && Math.abs(velocity) > 0.15) {
          const friction = 0.92
          let v = velocity
          const step = () => {
            v *= friction
            if (Math.abs(v) < 0.05) return
            const delta = v * 16 // ~1 frame at 60fps
            this._sendWheelEvent(screen, delta, lastY, lastY)
            momentumId = requestAnimationFrame(step)
          }
          momentumId = requestAnimationFrame(step)
        }
      }

      // passive: false so we can preventDefault() in touchmove
      wrapper.addEventListener('touchstart', onTouchStart, { passive: true })
      screen.addEventListener('touchmove', onTouchMove, { passive: false })
      screen.addEventListener('touchend', onTouchEnd, { passive: true })
      this._touchCleanup = () => {
        clearMomentum()
        wrapper.removeEventListener('touchstart', onTouchStart)
        screen.removeEventListener('touchmove', onTouchMove)
        screen.removeEventListener('touchend', onTouchEnd)
      }
    })
  }

  private _sendWheelEvent(target: HTMLElement, deltaY: number, clientX: number, clientY: number) {
    if (!this.xterm || deltaY === 0) return

    if (this.isMouseModeEnabled()) {
      // App has mouse tracking active (e.g. Codex, Claude Code TUI):
      // let xterm convert the wheel event into escape sequences for the app.
      // Do NOT call scrollLines() — that shifts xterm's viewport into the main-screen
      // scrollback while the app is rendering on the alternate screen, causing a
      // garbled display when both effects are applied simultaneously.
      target.dispatchEvent(new WheelEvent('wheel', {
        deltaY,
        deltaX: 0,
        deltaZ: 0,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      }))
    } else {
      // No mouse tracking: scroll xterm's viewport directly (normal shell / less / man).
      const lineHeight = (this.xterm.rows && target.clientHeight)
        ? (target.clientHeight / this.xterm.rows) : 20
      const lines = Math.round(deltaY / lineHeight)
      if (lines !== 0) this.xterm.scrollLines(lines)
    }
  }

  isMouseModeEnabled(): boolean {
    // Detects DECSET mouse tracking modes (1000/1002/1003/…) via xterm.js internal API.
    // Both paths access _core which is private — if xterm.js is upgraded and the structure
    // changes, we warn once so the breakage is visible rather than silently falling back.
    if (!this.xterm) return false
    try {
      const core = (this.xterm as any)._core
      const mouseService = core?.mouseService
      if (mouseService) {
        return mouseService.areMouseEventsActive?.() ?? false
      }
      const modes = core?.services?.coreMouseService?._activeProtocol
      if (modes !== undefined) {
        return modes !== 'NONE'
      }
      return false
    } catch {
      return false
    }
  }
}

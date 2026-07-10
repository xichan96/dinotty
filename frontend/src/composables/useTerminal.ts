import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import type { ClientMsg, ServerMsg } from '../types/protocol'
import { isTauri, createTransport, type Transport } from './useTransport'
import { onThemeChange, saveSettings, settings, onTextChange } from './useSettings'
import { computeWheelPlan, type WheelPlanInput } from './computeWheelPlan'
import { wsUrlWithToken } from './apiBase'
import { terminalKeyBindingDefs, useKeybindings, type KeyBinding } from './useKeybindings'
import { isWindowsClient } from '../utils/clientPlatform'
import { trailingPathDeleteLen } from '../utils/shell'
import { setupTouchScroll } from '../utils/touchScroll'

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

let tauriDragDropRegistered = false
let lastFocusedInstance: TerminalInstance | null = null

// Guard for Tauri WKWebView multi-focus: only the active pane should send input.
let _activePaneId: string | null = null
export function setActivePaneId(paneId: string | null) {
  _activePaneId = paneId
}

// Dedup window (ms) for WKWebView onData double-fire.
// xterm.js + WKWebView on macOS can produce 2 onData events for one key
// (modifier-prefixed sequence + actual char). The inter-event gap in
// WKWebView multi-focus replay is sub-millisecond, while the gap between
// the modifier-prefixed event and the real char in a Shift+key press is
// typically > 2ms. A 2ms window rejects the multi-focus duplicate but
// keeps the modifier sequence intact. (was 5ms — caused Shift+punct to
// require a double press.)
export const DEDUP_WINDOW_MS = 2

const IME_SYM_PAIR_MS = 400

/**
 * Determine whether an incoming onData payload should be dropped because
 * it is a WKWebView multi-focus replay of the previous event. Exported
 * for unit testing.
 */
export function isDuplicateOnData(
  data: string,
  prev: string,
  prevAt: number,
  now: number
): boolean {
  if (prev === '') return false
  if (data !== prev) return false
  return now - prevAt < DEDUP_WINDOW_MS
}

// Contiguous codepoint ranges of Shift+key punctuation that macOS Chinese IME can emit.
// Covers the WHOLE finite alphabet by block, not a per-key whitelist:
//   ASCII punct · General Punctuation (— – ' ' " " …) · CJK Symbols & Punctuation (、。《》「」『』【】〈〉)
//   · Fullwidth Forms punct subranges. Excludes fullwidth letters/digits and U+3000 ideographic space.
const SHIFT_SYMBOL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x21, 0x2f],
  [0x3a, 0x40],
  [0x5b, 0x60],
  [0x7b, 0x7e],
  [0x2010, 0x2027],
  [0x3001, 0x301f],
  [0xff01, 0xff0f],
  [0xff1a, 0xff20],
  [0xff3b, 0xff40],
  [0xff5b, 0xff5e],
]
// Standalone Shift+key punctuation outside any range: ¥(U+00A5 macOS pinyin shift+4) ·(U+00B7) ￥(U+FFE5).
const SHIFT_SYMBOL_SINGLETONS = new Set([0x00a5, 0x00b7, 0xffe5])

// Single char produced by Shift+key that is a symbol/punctuation (NOT a letter/digit/space).
// Excludes pinyin preedit letters (n,i,h,...) and digits, so the rescue can never touch CJK composition.
function isShiftSymbolChar(data: string): boolean {
  // Doubled CJK punctuation emitted by one keypress: —— (U+2014×2) / …… (U+2026×2)
  if (data.length === 2) {
    const d = data.charCodeAt(0)
    return d === data.charCodeAt(1) && (d === 0x2014 || d === 0x2026)
  }
  if (data.length !== 1) return false
  const cp = data.charCodeAt(0)
  return (
    SHIFT_SYMBOL_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) || SHIFT_SYMBOL_SINGLETONS.has(cp)
  )
}
function stripImeConfirmSpace(data: string): string {
  // Candidate-confirm space leaks as <sym><space> (incl. ——/…… + space); strip the trailing ws.
  if (
    data.length >= 2 &&
    /\s/.test(data[data.length - 1]) &&
    isShiftSymbolChar(data.slice(0, -1))
  ) {
    return data.slice(0, -1)
  }
  return data
}

export { isShiftSymbolChar, stripImeConfirmSpace }

export function isSinglePrintableAscii(data: string): boolean {
  return data.length === 1 && data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) <= 0x7e
}

export function isSinglePrintableGrapheme(data: string, allowSpace = false): boolean {
  if (data.length !== 1) return false
  const cp = data.charCodeAt(0)
  if (cp === 0x20) return allowSpace
  if (cp < 0x20 || cp === 0x7f) return false
  return cp <= 0x7e || (cp >= 0xff01 && cp <= 0xff5e)
}

export function terminalKeybindingMatches(
  e: KeyboardEvent,
  binding: KeyBinding,
  virtualMeta = false
): boolean {
  const effMeta = e.metaKey || virtualMeta
  const effAlt = virtualMeta ? false : e.altKey
  return (
    e.key.toLowerCase() === binding.key.toLowerCase() &&
    e.shiftKey === !!binding.shift &&
    effMeta === !!binding.meta &&
    e.ctrlKey === !!binding.ctrl &&
    effAlt === !!binding.alt
  )
}

export function handleTerminalShortcutKeydown(
  e: KeyboardEvent,
  sendData: (data: string) => void,
  virtualMeta = false,
  getLineBeforeCursor?: () => string | null
): boolean {
  const key = e.key.toLowerCase()
  if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && (key === 'c' || key === 'v'))
    return false

  const { getBinding } = useKeybindings()
  for (const def of terminalKeyBindingDefs) {
    const sequence = def.sequence
    if (!sequence) continue
    if (terminalKeybindingMatches(e, getBinding(def.id), virtualMeta)) {
      e.preventDefault()
      e.stopPropagation()
      if (def.id === 'term.deleteToLineStart' && getLineBeforeCursor) {
        const line = getLineBeforeCursor()
        if (line !== null) {
          const len = trailingPathDeleteLen(line)
          if (len > 0) {
            sendData('\x7f'.repeat(len))
            return true
          }
        }
      }
      sendData(sequence)
      return true
    }
  }
  return false
}

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
  private _sessionExited = false
  private _shellType: string | null = null
  sshHost: string | null = null // "user@host:port" for SSH tabs
  private _suppressTitleChange = false
  private _touchCleanup: (() => void) | null = null
  private _focusinCleanup: (() => void) | null = null
  private _compositionCleanup: (() => void) | null = null
  private _resizeObserver: ResizeObserver | null = null
  private _themeUnsub: (() => void) | null = null
  private _textUnsub: (() => void) | null = null
  private _refitRaf: number = 0
  private _lastCols = 0
  private _lastRows = 0
  private _resizeDebounce: number = 0
  private _lastInputData = ''
  private _lastInputTime = 0
  private _wheelBypass = false
  private _lastWheelTime = 0
  private _symCredits: Array<{ data: string; src: 0 | 1; at: number }> = []
  private _writeQueue: string[] = []
  private _writing = false
  touchMoved = false
  inTouchSelection = false
  selStartRow = 0
  selStartCol = 0
  private _visibilityHandler: (() => void) | null = null
  private _dragDropCleanup: (() => void) | null = null
  private _initialResizeTimer: ReturnType<typeof setInterval> | null = null
  onFileUpload?: (files: File[]) => void

  onTitleChange: ((title: string) => void) | null = null
  onShellInfo: ((shell: string) => void) | null = null
  onConnect: (() => void) | null = null
  onDisconnect: (() => void) | null = null
  onFileClick: ((path: string, x?: number, y?: number) => void) | null = null
  onPreviewLink: ((url: string, x?: number, y?: number) => void) | null = null
  onRawOutput: ((data: string) => void) | null = null
  onInput: ((data: string) => void) | null = null
  onSessionExit: (() => void) | null = null
  onReconnect: (() => void) | null = null

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

    // Ctrl+Shift+C/V: Linux-style copy/paste (macOS uses Cmd+C/V natively)
    const xt = this.xterm
    const { isAppShortcut } = useKeybindings()
    xt.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type === 'keydown') {
        if (e.isComposing || (e as any).keyCode === 229 || e.key === 'Process') return true

        // Web only: let the OS-native Ctrl+V fire so the capture-phase paste listener
        // (_setupPasteUpload) receives clipboardData files/images for upload; plain text
        // still pastes via xterm's own paste handler. Returning false makes xterm skip
        // sending the control char and skip preventDefault, so the browser dispatches the native paste
        // event. The native (Tauri) build has its own clipboard path and is excluded.
        if (
          !isTauri() &&
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          e.code === 'KeyV'
        ) {
          return false
        }

        if (e.ctrlKey && e.shiftKey) {
          if (e.key === 'C' && xt.hasSelection()) {
            navigator.clipboard.writeText(xt.getSelection())
            e.preventDefault()
            return false
          }
          if (e.key === 'V') {
            navigator.clipboard
              .readText()
              .then((text) => {
                if (text) xt.paste(text)
              })
              .catch(() => {})
            e.preventDefault()
            return false
          }
        }

        const virtualMeta = settings.windowsAltAsCmd && isWindowsClient && e.altKey && !e.ctrlKey
        if (virtualMeta && !e.shiftKey) {
          if (e.code === 'KeyC' && xt.hasSelection()) {
            navigator.clipboard.writeText(xt.getSelection())
            e.preventDefault()
            e.stopPropagation()
            return false
          }
          if (e.code === 'KeyV') {
            navigator.clipboard
              .readText()
              .then((text) => {
                if (text) xt.paste(text)
              })
              .catch(() => {})
            e.preventDefault()
            e.stopPropagation()
            return false
          }
        }

        if (
          handleTerminalShortcutKeydown(
            e,
            (data) => this.sendData(data),
            virtualMeta,
            () => {
              const xt = this.xterm
              if (!xt) return null
              const buf = xt.buffer.active
              const line = buf.getLine(buf.cursorY)
              if (!line) return null
              return line.translateToString(true).slice(0, buf.cursorX)
            }
          )
        )
          return false

        if (virtualMeta && isAppShortcut(e)) return false
      }
      return true
    })

    // OSC 52: clipboard write — enables copy from inside mouse-tracking apps (tmux/zellij/etc.)
    this.xterm.parser.registerOscHandler(52, (data: string) => {
      const sep = data.indexOf(';')
      if (sep === -1) return true
      const payload = data.slice(sep + 1)
      if (payload === '?') return true // read request — not supported
      try {
        const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
        const text = new TextDecoder('utf-8').decode(bytes)
        if (text) navigator.clipboard?.writeText(text).catch(() => {})
      } catch {
        /* ignore malformed payload */
      }
      return true
    })

    const unicode11 = new Unicode11Addon()
    this.xterm.loadAddon(unicode11)
    this.xterm.unicode.activeVersion = '11'

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      this.xterm.loadAddon(webgl)
    } catch {
      /* DOM renderer fallback */
    }

    this.searchAddon = new SearchAddon()
    this.xterm.loadAddon(this.searchAddon)

    const textarea = wrapper.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    if (textarea && isTouchDevice()) {
      textarea.inputMode = 'none'
      textarea.setAttribute('virtualkeyboardpolicy', 'manual')
    }
    if (textarea && isTauri()) {
      const onImeInput = (e: InputEvent) => {
        if (e.inputType !== 'insertText') return
        const data = stripImeConfirmSpace(e.data || '')
        if (!isShiftSymbolChar(data)) return
        if (this._resolveSym(data, 0, performance.now())) this._emitInput(data)
      }
      textarea.addEventListener('input', onImeInput as EventListener)
      this._compositionCleanup = () => {
        textarea.removeEventListener('input', onImeInput as EventListener)
        this._symCredits = []
      }
    }

    // Register file path link provider
    this.xterm.registerLinkProvider({
      provideLinks: (bufferLineNumber: number, callback: (links: any[] | undefined) => void) => {
        const line = this.xterm!.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) {
          callback(undefined)
          return
        }
        const text = line.translateToString()
        const regex = /(?:^|\s)((?:\/|\.\/|~\/)[^\s:]+)/g
        const links: any[] = []
        let match
        while ((match = regex.exec(text)) !== null) {
          const path = match[1]
          const startX = match.index + (match[0].length - match[1].length)
          links.push({
            range: {
              start: { x: startX + 1, y: bufferLineNumber },
              end: { x: startX + path.length + 1, y: bufferLineNumber },
            },
            text: path,
            activate: (event: MouseEvent) => {
              this.onFileClick?.(path, event.clientX, event.clientY)
            },
          })
        }
        callback(links.length > 0 ? links : undefined)
      },
    })

    // Register URL link provider (localhost → preview, others → new tab)
    this.xterm.registerLinkProvider({
      provideLinks: (bufferLineNumber: number, callback: (links: any[] | undefined) => void) => {
        const line = this.xterm!.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) {
          callback(undefined)
          return
        }
        const text = line.translateToString()
        const regex =
          /(?:https?:\/\/[^\s"'<>]+|(?:www\.)[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})+(?:\/[^\s"'<>]*)?)/g
        const links: any[] = []
        let match
        while ((match = regex.exec(text)) !== null) {
          const raw = match[0]
          const uri = raw.startsWith('http') ? raw : `http://${raw}`
          const startX = match.index
          links.push({
            range: {
              start: { x: startX + 1, y: bufferLineNumber },
              end: { x: startX + raw.length + 1, y: bufferLineNumber },
            },
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
    this._setupPasteUpload((wrapper.querySelector('.xterm') as HTMLElement | null) || wrapper)
    this._touchCleanup = setupTouchScroll(wrapper, {
      getXterm: () => this.xterm,
      isInTouchSelection: () => this.inTouchSelection,
      setTouchMoved: (v) => {
        this.touchMoved = v
      },
      sendWheelEvent: (deltaY, clientX, clientY) =>
        this._sendWheelEvent(deltaY, clientX, clientY),
    })
    this._setupAdaptiveWheel()

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
      this.xterm.options.fontFamily =
        text.font_family ||
        getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
      this.xterm.options.lineHeight = text.line_height
      this.xterm.options.letterSpacing = text.letter_spacing
      this.xterm.options.cursorBlink = text.cursor_blink
      this.xterm.options.cursorStyle = text.cursor_style as any
      this.xterm.options.scrollback = text.scrollback
      this._refit()
    })
  }

  focus() {
    if (!this.xterm) return
    this.xterm.focus()
  }

  blur() {
    this.xterm?.blur()
  }

  fit() {
    this._refit()
  }

  adjustFontSize(delta: number) {
    const xt = this.xterm
    if (!xt) return
    const newSize = Math.max(8, Math.min(72, (xt.options.fontSize ?? 14) + delta))
    xt.options.fontSize = newSize
    settings.text.font_size = newSize
    saveSettings()
    this._refit()
  }

  resetFontSize() {
    if (!this.xterm) return
    const defaultSize = 14
    this.xterm.options.fontSize = defaultSize
    settings.text.font_size = defaultSize
    saveSettings()
    this._refit()
  }

  sendData(data: string, force = false) {
    if (this._sessionExited) return
    // Guard: only the active pane sends input (prevents WKWebView multi-focus duplication)
    if (!force && _activePaneId !== null && _activePaneId !== this.paneId) return
    if (this._transport) {
      this._transport.send({ type: 'input', data })
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data } as ClientMsg))
    }
  }

  private _resolveSym(data: string, src: 0 | 1, now: number): boolean {
    if (this._symCredits.length)
      this._symCredits = this._symCredits.filter((c) => now - c.at < IME_SYM_PAIR_MS)
    const i = this._symCredits.findIndex((c) => c.data === data && c.src !== src)
    if (i >= 0) {
      this._symCredits.splice(i, 1)
      return false
    }
    this._symCredits.push({ data, src, at: now })
    return true
  }

  private _handleXtermData(rawData: string) {
    const tauri = isTauri()
    const data = tauri ? stripImeConfirmSpace(rawData) : rawData
    if (!data) return
    const now = performance.now()
    if (isDuplicateOnData(data, this._lastInputData, this._lastInputTime, now)) return
    this._lastInputData = data
    this._lastInputTime = now
    if (tauri && isShiftSymbolChar(data)) {
      if (!this._resolveSym(data, 1, now)) return
    }
    this._emitInput(data)
  }

  private _emitInput(data: string): boolean {
    if (this._sessionExited) return false
    if (_activePaneId !== null && _activePaneId !== this.paneId) return false
    this.onInput?.(data)
    this.sendData(data)
    return true
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
    if (this._resizeDebounce) clearTimeout(this._resizeDebounce)
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
    this._writeQueue = []
    this._writing = false
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
      try {
        xt.dispose()
      } catch {
        /* already disposed or addon race */
      }
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
        this._enqueueWrite(msg.data)
        this.onRawOutput?.(msg.data)
      } else if (msg.type === 'shell_info') {
        this._shellType = msg.shell_type
        this.onShellInfo?.(msg.shell_type)
      } else if (msg.type === 'reconnected') {
        this._suppressTitleChange = true
        this.xterm.reset()
        this._suppressTitleChange = false
        this._writeQueue = []
        this._writing = false
        this._doFitAndResize(true)
      } else if (msg.type === 'session_exit') {
        this._handleSessionExit()
      }
    })

    this._transport.onDisconnect(() => {
      this.onDisconnect?.()
    })

    if (!this._onDataRegistered) {
      this._onDataRegistered = true
      this.xterm!.onData((d) => this._handleXtermData(d))
    }
  }

  // ── Private ──────────────────────────────────────────────

  private _connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = wsUrlWithToken(
      `${proto}//${location.host}/ws?paneId=${encodeURIComponent(this.paneId)}`
    )
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
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (!this.xterm) return
      if (msg.type === 'reconnected') {
        this._suppressTitleChange = true
        this.xterm.reset()
        this._suppressTitleChange = false
        this._reconnectAttempts = 0
        this._hideOverlay()
        this._doFitAndResize(true)
      } else if (msg.type === 'output') {
        this._enqueueWrite(msg.data)
        this.onRawOutput?.(msg.data)
      } else if (msg.type === 'shell_info') {
        this._shellType = msg.shell_type
        this.onShellInfo?.(msg.shell_type)
      } else if (msg.type === 'session_exit') {
        this._handleSessionExit()
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
      this.xterm!.onData((d) => this._handleXtermData(d))
    }
  }

  private _enqueueWrite(data: string) {
    if (!this.xterm) return
    // Cap queue depth to prevent UI thread starvation on desktop (Tauri)
    // where app.emit() has no backpressure. If the queue grows unbounded,
    // xterm.write() callbacks monopolize the event loop and keyboard input
    // is starved — the terminal appears frozen while output keeps flowing.
    // Dropping intermediate chunks is safe: the terminal state is determined
    // by the latest output.
    const MAX_WRITE_QUEUE = 64
    if (this._writeQueue.length >= MAX_WRITE_QUEUE) {
      this._writeQueue = [this._writeQueue.join('') + data]
    } else {
      this._writeQueue.push(data)
    }
    if (!this._writing) this._processWriteQueue()
  }

  private _processWriteQueue() {
    if (!this.xterm || this._writeQueue.length === 0) {
      this._writing = false
      return
    }
    this._writing = true

    // Process up to SYNC_BATCH_LIMIT chunks per frame, then yield.
    // This prevents the xterm.write() callback chain from monopolizing
    // the main thread and starving keyboard input events.
    const SYNC_BATCH_LIMIT = 4
    let processed = 0
    const MAX_CHUNK = 32 * 1024

    const processNext = () => {
      if (!this.xterm || this._writeQueue.length === 0 || processed >= SYNC_BATCH_LIMIT) {
        if (this._writeQueue.length > 0) {
          // More data to process — yield to the browser, then continue
          requestAnimationFrame(() => this._processWriteQueue())
        } else {
          this._writing = false
        }
        return
      }
      processed++
      const chunk = this._writeQueue.shift()!
      // Split large writes to prevent UI thread blocking.
      // A single xterm.write() with hundreds of KB synchronously blocks rendering.
      if (chunk.length > MAX_CHUNK) {
        this._writeQueue.unshift(chunk.slice(MAX_CHUNK))
        this.xterm.write(chunk.slice(0, MAX_CHUNK), () => processNext())
      } else {
        this.xterm.write(chunk, () => processNext())
      }
    }

    processNext()
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

  private _handleSessionExit() {
    if (this._sessionExited) return
    this._sessionExited = true
    this._showExitOverlay()
    this.onSessionExit?.()
  }

  private _showExitOverlay() {
    if (!this._wrapper || this._overlay) return
    this._overlay = document.createElement('div')
    this._overlay.className = 'reconnect-overlay'

    const isSsh = this._shellType === 'ssh'

    const text = document.createElement('span')
    text.textContent = isSsh ? 'Connection Lost' : 'Process exited'

    if (isSsh && this.sshHost) {
      const hostInfo = document.createElement('span')
      hostInfo.className = 'reconnect-host-info'
      hostInfo.textContent = this.sshHost
      this._overlay.appendChild(text)
      this._overlay.appendChild(hostInfo)
    } else {
      this._overlay.appendChild(text)
    }

    const btn = document.createElement('button')
    btn.className = 'reconnect-retry-btn'
    btn.textContent = isSsh ? 'Reconnect' : 'New Tab'
    btn.addEventListener('click', () => {
      if (isSsh && this.onReconnect) {
        this.onReconnect()
      } else {
        window.location.reload()
      }
    })

    this._overlay.appendChild(btn)
    this._wrapper.style.position = 'relative'
    this._wrapper.appendChild(this._overlay)
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
    try {
      this.fitAddon.fit()
    } catch {
      return
    }

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
    const sendResize = () => {
      const resizeMsg: ClientMsg = { type: 'resize', cols, rows }
      if (this._transport) {
        this._transport.send(resizeMsg)
      } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(resizeMsg))
      }
    }
    if (force) {
      // Initial resize: send immediately
      sendResize()
    } else {
      // Debounce: coalesce rapid resize events during window drag
      if (this._resizeDebounce) clearTimeout(this._resizeDebounce)
      this._resizeDebounce = window.setTimeout(() => {
        this._resizeDebounce = 0
        sendResize()
      }, 25)
    }
  }

  private _setupDragDrop(wrapper: HTMLElement) {
    if (isTauri()) {
      lastFocusedInstance = this
      const handler = () => {
        lastFocusedInstance = this
      }
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
      const dt = de.dataTransfer!
      if (!isTauri() && (dt.files?.length ?? 0) > 0) {
        e.preventDefault()
        e.stopPropagation()
        this.onFileUpload?.([...dt.files])
        return
      }

      de.preventDefault()
      de.stopPropagation()
      const types = Array.from(dt.types)
      const paths: string[] = []

      if (types.includes('text/uri-list')) {
        const uriList = dt.getData('text/uri-list')
        uriList.split('\n').forEach((u) => {
          u = u.trim()
          if (!u || u.startsWith('#')) return
          try {
            paths.push(decodeURIComponent(new URL(u).pathname))
          } catch {}
        })
      }

      if (paths.length === 0 && types.includes('text/plain')) {
        const text = dt.getData('text/plain').trim()
        const absPlain =
          text && (text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\'))
        if (absPlain) {
          text.split('\n').forEach((l) => {
            if (l.trim()) paths.push(l.trim())
          })
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

  private _setupPasteUpload(target: HTMLElement) {
    let suppressPasteUpload = false
    let torn = false

    const pasteHandler = (e: ClipboardEvent) => {
      if (suppressPasteUpload) return
      if (isTauri()) return
      const files = [...(e.clipboardData?.items ?? [])]
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter((f): f is File => f != null)
      if (!files.length) return
      e.preventDefault()
      e.stopPropagation()
      this.onFileUpload?.(files)
    }
    target.addEventListener('paste', pasteHandler, true)

    const keydownHandler = (e: KeyboardEvent) => {
      if (isTauri()) return
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') return
      const readClipboard = navigator.clipboard?.read
      if (!readClipboard) return
      suppressPasteUpload = true
      setTimeout(() => {
        suppressPasteUpload = false
      }, 0)

      void readClipboard
        .call(navigator.clipboard)
        .then(async (items) => {
          const files = await Promise.all(
            items.flatMap((item) => {
              const type = item.types.find((itemType) => itemType.startsWith('image/'))
              if (!type) return []
              return [
                item.getType(type).then((blob) => {
                  const ext = type.split('/')[1]?.split('+')[0] || 'png'
                  return new File([blob], `pasted-image-${Date.now()}.${ext}`, { type })
                }),
              ]
            })
          )
          if (!torn && files.length) this.onFileUpload?.(files)
        })
        .catch(() => {
          // Clipboard image reads may be denied; keep normal text paste behavior intact.
        })
    }
    target.addEventListener('keydown', keydownHandler, true)

    const prevCleanup = this._dragDropCleanup
    let removed = false
    this._dragDropCleanup = () => {
      if (removed) return
      removed = true
      torn = true
      prevCleanup?.()
      target.removeEventListener('paste', pasteHandler, true)
      target.removeEventListener('keydown', keydownHandler, true)
    }
  }

  private _sendWheelEvent(
    deltaY: number,
    clientX: number,
    clientY: number,
    deltaMode = 0
  ) {
    if (!this.xterm || deltaY === 0) return

    const xtermEl = this.xterm.element
    if (!xtermEl) return

    // Synthetic dispatches must never re-enter the adaptive-wheel planner.
    this._wheelBypass = true
    try {
      xtermEl.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          deltaX: 0,
          deltaZ: 0,
          deltaMode,
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        })
      )
    } finally {
      this._wheelBypass = false
    }
  }

  private _setupAdaptiveWheel() {
    this.xterm?.attachCustomWheelEventHandler((e: WheelEvent): boolean => {
      if (this._wheelBypass) return true
      if (!this.xterm) return true

      const now = Date.now()
      const dt = now - this._lastWheelTime || 1
      const rowHeight = this._getWheelRowHeight()
      const lines =
        e.deltaMode === 1
          ? Math.abs(e.deltaY)
          : e.deltaMode === 0 && rowHeight > 0
            ? Math.abs(e.deltaY) / rowHeight
            : 0
      const velocity = lines / dt
      this._lastWheelTime = now

      const sensitivity = settings.text.scroll_sensitivity ?? 1
      const acceleration = settings.text.scroll_acceleration ?? 0
      const input: WheelPlanInput = {
        deltaY: e.deltaY,
        deltaX: e.deltaX,
        deltaMode: e.deltaMode,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        velocity,
        isAltScreen: this.xterm.buffer.active.type !== 'normal',
        isMouseTracking: this.isMouseModeEnabled(),
      }
      const plan = computeWheelPlan(input, sensitivity, acceleration)
      if (plan.action === 'native') return true

      e.preventDefault()
      e.stopPropagation()
      for (let i = 0; i < plan.count; i++) {
        this._sendWheelEvent(plan.deltaY, e.clientX, e.clientY, plan.deltaMode)
      }
      return false
    })
  }

  private _getWheelRowHeight(): number {
    try {
      const h = Number(
        (this.xterm as any)?._core?._renderService?.dimensions?.css?.cell?.height
      )
      return Number.isFinite(h) && h > 0 ? h : 0
    } catch {
      return 0
    }
  }

  isMouseModeEnabled(): boolean {
    // Detects DECSET mouse tracking modes (1000/1002/1003/...) via xterm.js internal API.
    // Tolerates both property and method shapes for areMouseEventsActive across xterm.js versions.
    if (!this.xterm) return false
    try {
      const core = (this.xterm as any)._core
      const svc = core?.coreMouseService ?? core?.mouseService
      if (svc) {
        const active = svc.areMouseEventsActive
        // xterm 5.5: boolean getter; tolerate older method shape
        return typeof active === 'function' ? (active.call(svc) ?? false) : !!active
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

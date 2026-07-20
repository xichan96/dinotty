import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import type { ClientMsg, ServerMsg } from '../types/protocol'
import { isTauri, createTransport, type Transport } from './useTransport'
import { onThemeChange, settings } from './useSettings'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  getEffectiveText,
  onEffectiveTextChange,
  resetOverride,
  setOverride,
} from './useDeviceTextSettings'
import {
  computeWheelPlan,
  type TrackingWheelState,
  type WheelPlanInput,
} from './computeWheelPlan'
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
    const payload = event.payload || []
    const paths: string[] = Array.isArray(payload) ? payload : (payload.paths || [])
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
  private _lastInputData = ''
  private _lastInputTime = 0
  private _wheelBypass = false
  private _lastWheelTime = 0
  private _trackingWheelState: TrackingWheelState | null = null
  private _wheelRowHeightWarned = false
  private _symCredits: Array<{ data: string; src: 0 | 1; at: number }> = []
  // IME composition state. Tracked via compositionstart/compositionend on the
  // xterm textarea so focusActive() can avoid .focus()/.blur()/.fit() during
  // composition - those calls interrupt the IME session and cause xterm's
  // diff-fallback to leak preedit text as raw input.
  private _composing = false
  private _writeQueue: string[] = []
  private _writing = false
  // Output transaction buffer shared by DEC mode 2026 (sync_begin/sync_end)
  // and the fit-then-snapshot replay handshake (replay_begin/replay_end). A
  // depth counter supports nesting: a sync_end arriving mid-replay defers the
  // flush until replay_end closes the outer transaction. While depth > 0,
  // server-side Output is held here instead of entering the write pump; on
  // the outermost end the joined buffer is enqueued as a single write so
  // xterm sees a coherent stream and doesn't repaint per 32 KiB / per rAF
  // chunk mid-redraw — and settle-ladder / ResizeObserver cannot interrupt
  // mid-write (which was the root cause of refresh-misalign P2).
  //
  // The 8 MiB cap is a safety net against pathological bursts (an app that
  // emits a huge sync burst and never sends DECRST, or a snapshot that grows
  // beyond reason). The server watchdog + SYNC_BUFFER_LIMIT also bound it,
  // but defense-in-depth on the client is cheap.
  private _transactionDepth = 0
  private _transactionBuffer: string[] = []
  private _transactionBytes = 0
  private static readonly MAX_TRANSACTION_BYTES = 8 * 1024 * 1024
  // Snapshot of the (cols, rows) the client requested in its last
  // SnapshotRequest. Used at replay_end to detect whether the wrapper size
  // changed mid-replay — if so, the snapshot is encoded at the wrong size and
  // we should re-request. Null before the first SnapshotRequest is sent.
  private _snapshotRequestedSize: { cols: number; rows: number } | null = null
  // True between Reconnected and replay_end. While set, _sendResize is
  // suppressed: the server's atomic_resize_and_snapshot does the PTY resize
  // in the same critical section as the snapshot, so a client-sent resize
  // during this window would race it and re-introduce the refresh-misalign.
  // Cleared on replay_end (or _resetTransaction, defensively).
  private _snapshotPending = false
  // Watchdog for silent xterm.write() callback loss. xterm.js can drop the
  // write callback without throwing (observed when resize interleaves with a
  // pending write under high output), which strands _writing=true forever.
  // The watchdog force-advances the pump if the callback hasn't fired within
  // WRITE_WATCHDOG_MS, recovering output without a full page reload.
  private _writeWatchdog: ReturnType<typeof setTimeout> | null = null
  private _writeWatchdogFires = 0
  // Cross-batch viewport pin: survives rAF yields between write batches so
  // trackpad inertia / sub-pixel wheel noise doesn't flip isUserScrolling and
  // drop the viewport above ybase mid-stream. Only a deliberate upward scroll
  // (accumulated |deltaY| past NOISE_THRESHOLD within ACCUM_RESET_MS) un-pins.
  private _writePinnedToBottom = true
  private _wheelUpAccumulated = 0
  private _wheelUpResetTimer: ReturnType<typeof setTimeout> | null = null
  touchMoved = false
  inTouchSelection = false
  selStartRow = 0
  selStartCol = 0
  private _visibilityHandler: (() => void) | null = null
  private _dragDropCleanup: (() => void) | null = null
  private _settleTimeouts: ReturnType<typeof setTimeout>[] = []
  private _settleRaf: number = 0
  private _settleGeneration: number = 0
  // Zero-size watchdog: when the wrapper collapses to 0×0 (cold reload flex
  // chain collapse, hidden tab becoming visible, mobile keyboard
  // dismissing) the settle-ladder [50,120,250,450,700]ms can sample 0×0 at
  // every tick and give up. ResizeObserver should fire when the wrapper
  // recovers, but browsers occasionally fail to recompute an active
  // percent-based flex chain, leaving the terminal permanently 0×0 until
  // an external reflow (drag/refresh). This retry polls every 250ms for up
  // to 30s as a safety net — _refit is idempotent so the cost is trivial
  // when the wrapper is already non-zero.
  private _zeroSizeRetryTimer: ReturnType<typeof setTimeout> | null = null
  private _zeroSizeRetries = 0
  private static readonly ZERO_SIZE_RETRY_MS = 250
  private static readonly ZERO_SIZE_MAX_RETRIES = 120
  private _transportConnected = false
  private _lastSentCols = 0
  private _lastSentRows = 0
  private _resizeCooldownUntil = 0
  private _followingPeer = false
  private _peerFollowGen = 0
  private _peerFollowTimer: ReturnType<typeof setTimeout> | null = null
  private _pendingLocalRefit = false
  private _authWrapperW = 0
  private _authWrapperH = 0
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

    const text = getEffectiveText()
    const fontFamily = text.font_family || v('--font-mono')

    this.xterm = new XTerm({
      cursorBlink: text.cursor_blink,
      cursorStyle: text.cursor_style as any,
      scrollback: text.scrollback,
      fontSize: text.font_size,
      fontFamily,
      lineHeight: text.line_height,
      letterSpacing: text.letter_spacing,
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

        // Windows: Ctrl+C with an active selection copies (cmd.exe behavior);
        // without a selection it falls through and xterm sends SIGINT (\x03).
        // Matches the Ctrl+C hint shown in the terminal context menu.
        if (
          isWindowsClient &&
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          e.code === 'KeyC' &&
          xt.hasSelection()
        ) {
          navigator.clipboard.writeText(xt.getSelection()).catch(() => {})
          e.preventDefault()
          return false
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
      webgl.onContextLoss(() => {
        webgl.dispose()
        // Disposing restores the canvas renderer but doesn't trigger a
        // redraw. Without refresh, the terminal appears frozen until the
        // next resize (e.g. dragging the window) kicks the render service.
        const rows = this.xterm?.rows ?? 1
        this.xterm?.refresh(0, Math.max(0, rows - 1))
      })
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
    // Track IME composition state on all platforms so focusActive() can
    // defer .focus()/.blur()/.fit() during composition. Interrupting an
    // in-flight composition causes xterm's diff-fallback to leak preedit
    // text as raw input (P3).
    if (textarea) {
      const onStart = () => { this._composing = true }
      const onEnd = () => { this._composing = false }
      textarea.addEventListener('compositionstart', onStart)
      textarea.addEventListener('compositionend', onEnd)
      const prevCleanup = this._compositionCleanup
      this._compositionCleanup = () => {
        textarea.removeEventListener('compositionstart', onStart)
        textarea.removeEventListener('compositionend', onEnd)
        this._composing = false
        prevCleanup?.()
      }
    }
    if (textarea && isTauri()) {
      const onImeInput = (e: InputEvent) => {
        if (e.inputType !== 'insertText') return
        const data = stripImeConfirmSpace(e.data || '')
        if (!isShiftSymbolChar(data)) return
        if (this._resolveSym(data, 0, performance.now())) this._emitInput(data)
      }
      textarea.addEventListener('input', onImeInput as EventListener)
      const prevCleanup = this._compositionCleanup
      this._compositionCleanup = () => {
        textarea.removeEventListener('input', onImeInput as EventListener)
        this._symCredits = []
        prevCleanup?.()
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

    // Sample a short settle series while the renderer and DOM layout converge.
    this._scheduleSettleResize()

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

    // Web fonts load asynchronously; if the terminal is fitted before the
    // font is ready, cellWidth is based on the fallback font (usually
    // narrower), so cols is overestimated and long lines overflow the
    // canvas. Refit once after fonts settle to correct cellWidth -> cols.
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => {
        if (this._destroyed || !this.xterm) return
        this._refit()
      })
    }

    this._visibilityHandler = () => {
      if (!document.hidden) this._doFitAndResize(true)
    }
    document.addEventListener('visibilitychange', this._visibilityHandler)

    this._themeUnsub = onThemeChange((xtermTheme) => {
      if (this.xterm) this.xterm.options.theme = xtermTheme
    })

    let lastLayout = {
      font_size: text.font_size,
      font_family: text.font_family,
      line_height: text.line_height,
      letter_spacing: text.letter_spacing,
      scrollback: text.scrollback,
    }
    this._textUnsub = onEffectiveTextChange((text) => {
      if (!this.xterm) return
      const layoutChanged =
        text.font_size !== lastLayout.font_size ||
        text.font_family !== lastLayout.font_family ||
        text.line_height !== lastLayout.line_height ||
        text.letter_spacing !== lastLayout.letter_spacing ||
        text.scrollback !== lastLayout.scrollback
      this.xterm.options.fontSize = text.font_size
      this.xterm.options.fontFamily =
        text.font_family ||
        getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
      this.xterm.options.lineHeight = text.line_height
      this.xterm.options.letterSpacing = text.letter_spacing
      this.xterm.options.cursorBlink = text.cursor_blink
      this.xterm.options.cursorStyle = text.cursor_style as any
      this.xterm.options.scrollback = text.scrollback
      if (layoutChanged) {
        lastLayout = {
          font_size: text.font_size,
          font_family: text.font_family,
          line_height: text.line_height,
          letter_spacing: text.letter_spacing,
          scrollback: text.scrollback,
        }
        this._refit()
      }
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
    if (!this.xterm) return
    const newSize = Math.max(
      FONT_SIZE_MIN,
      Math.min(FONT_SIZE_MAX, getEffectiveText().font_size + delta),
    )
    setOverride('font_size', newSize)
  }

  resetFontSize() {
    if (!this.xterm) return
    resetOverride('font_size')
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
    // Mouse reports produced synchronously by our synthetic wheel dispatches
    // (_sendWheelEvent) are legitimate identical repeats; the WKWebView
    // key-replay dedup below must not eat them.
    if (this._wheelBypass) {
      this._emitInput(rawData)
      return
    }
    const tauri = isTauri()
    const data = tauri ? stripImeConfirmSpace(rawData) : rawData
    if (!data) return
    const now = performance.now()
    // Gate the WKWebView replay dedup to Tauri only. On web, browsers don't
    // multi-fire onData for one key, so the 2ms same-char window only
    // corrupts legitimate fast repeats (e.g. `3000000` -> `30`, held arrow
    // keys, fast paste of repeated chars). On Tauri/WKWebView, keep the
    // dedup to absorb the multi-focus replay (P4).
    if (tauri && isDuplicateOnData(data, this._lastInputData, this._lastInputTime, now)) return
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

  get isComposing(): boolean {
    return this._composing
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
    for (const h of this._settleTimeouts) clearTimeout(h)
    this._settleTimeouts = []
    this._clearZeroSizeRetry()
    if (this._settleRaf) cancelAnimationFrame(this._settleRaf)
    if (this._peerFollowTimer) {
      clearTimeout(this._peerFollowTimer)
      this._peerFollowTimer = null
    }
    this._settleGeneration++
    this._peerFollowGen++
    this._followingPeer = false
    if (this._refitRaf) cancelAnimationFrame(this._refitRaf)
    if (this._wheelUpResetTimer) {
      clearTimeout(this._wheelUpResetTimer)
      this._wheelUpResetTimer = null
    }
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
    this._resetTransaction()
    if (this._writeWatchdog) {
      clearTimeout(this._writeWatchdog)
      this._writeWatchdog = null
    }
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
    this._transportConnected = false
    this._transport = createTransport(this.paneId)

    this._transport.onConnect(() => {
      this._transportConnected = true
      this.onConnect?.()
      this._doFitAndResize(true)
      this._scheduleSettleResize()
    })

    this._transport.onMessage((msg) => {
      if (this._destroyed || !this.xterm) return
      if (msg.type === 'output') {
        if (this._transactionDepth > 0) {
          this._appendToTransaction(msg.data)
        } else {
          this._enqueueWrite(msg.data)
        }
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
        // Reset sync transaction: the server's sync_active state is not
        // replayed across reconnect — any in-flight SyncBegin is lost.
        // Without this, a post-reconnect SyncEnd would flush a stale buffer.
        this._resetTransaction()
        // Mark that we owe the server a snapshot_request. Suppresses _sendResize
        // until replay_end lands — the server's atomic_resize_and_snapshot
        // owns the PTY resize during this window.
        this._snapshotPending = true
        if (this._writeWatchdog) {
          clearTimeout(this._writeWatchdog)
          this._writeWatchdog = null
        }
        this._writePinnedToBottom = true
        this._doFitAndResize(true)
        // Kick off the fit-then-snapshot handshake: the zero-size retry
        // path or settle-ladder will call _maybeSendSnapshotRequest once the
        // wrapper converges to a stable non-zero size.
        this._maybeSendSnapshotRequest()
        this._scheduleSettleResize()
      } else if (msg.type === 'resize') {
        // Server breaks sync mode before broadcasting Resize (see
        // apply_and_broadcast_resize), so SyncEnd lands before Resize in the
        // FIFO channel. If a Resize arrives while a transaction is somehow
        // still active (race), flush first so buffered bytes land before the
        // resize changes xterm geometry.
        if (this._transactionDepth > 0) {
          this._flushTransaction()
          this._transactionDepth = 0
        }
        this._followPeerResize(msg.cols, msg.rows)
      } else if (msg.type === 'session_exit') {
        this._handleSessionExit()
      } else if (msg.type === 'sync_begin') {
        this._handleSyncBegin()
      } else if (msg.type === 'sync_end') {
        this._handleSyncEnd()
      } else if (msg.type === 'replay_begin') {
        this._handleReplayBegin(msg.cols, msg.rows)
      } else if (msg.type === 'replay_end') {
        this._handleReplayEnd()
      }
    })

    this._transport.onDisconnect(() => {
      this._transportConnected = false
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
      this._scheduleSettleResize()
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
        // Reset the write pump: a prior stall may have stranded _writing=true,
        // and xterm.reset() invalidated the old buffer. Without this, output
        // after reconnect queues forever and the terminal stays dead until a
        // full page reload.
        this._writeQueue = []
        this._writing = false
        // Reset transaction: server's sync_active state is not replayed
        // across reconnect — any in-flight SyncBegin is lost.
        this._resetTransaction()
        // Owe the server a snapshot_request; suppress _sendResize until
        // replay_end (see _snapshotPending doc comment).
        this._snapshotPending = true
        if (this._writeWatchdog) {
          clearTimeout(this._writeWatchdog)
          this._writeWatchdog = null
        }
        this._writePinnedToBottom = true
        this._doFitAndResize(true)
        // Kick off fit-then-snapshot handshake — settle-ladder / zero-size
        // retry will fire _maybeSendSnapshotRequest when the wrapper converges.
        this._maybeSendSnapshotRequest()
        this._scheduleSettleResize()
      } else if (msg.type === 'output') {
        if (this._transactionDepth > 0) {
          this._appendToTransaction(msg.data)
        } else {
          this._enqueueWrite(msg.data)
        }
        this.onRawOutput?.(msg.data)
      } else if (msg.type === 'shell_info') {
        this._shellType = msg.shell_type
        this.onShellInfo?.(msg.shell_type)
      } else if (msg.type === 'resize') {
        // Server breaks sync mode before broadcasting Resize (see
        // apply_and_broadcast_resize), so SyncEnd lands before Resize. Flush
        // any residual transaction first to keep buffered bytes ahead of the
        // resize geometry change.
        if (this._transactionDepth > 0) {
          this._flushTransaction()
          this._transactionDepth = 0
        }
        this._followPeerResize(msg.cols, msg.rows)
      } else if (msg.type === 'session_exit') {
        this._handleSessionExit()
      } else if (msg.type === 'sync_begin') {
        this._handleSyncBegin()
      } else if (msg.type === 'sync_end') {
        this._handleSyncEnd()
      } else if (msg.type === 'replay_begin') {
        this._handleReplayBegin(msg.cols, msg.rows)
      } else if (msg.type === 'replay_end') {
        this._handleReplayEnd()
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
    const MAX_QUEUE_BYTES = 4 * 1024 * 1024
    if (this._writeQueue.length >= MAX_WRITE_QUEUE) {
      this._writeQueue = [this._writeQueue.join('') + data]
    } else {
      this._writeQueue.push(data)
    }
    let totalBytes = 0
    for (const chunk of this._writeQueue) totalBytes += chunk.length
    while (totalBytes > MAX_QUEUE_BYTES && this._writeQueue.length > 1) {
      const dropped = this._writeQueue.shift()!
      totalBytes -= dropped.length
    }
    if (!this._writing) this._processWriteQueue()
  }

  // ── Output transaction handling ─────────────────────────────
  //
  // Two protocols share this buffer:
  //  - DEC mode 2026 (sync_begin/sync_end): server buffers live Output
  //    during synchronized redraw and flushes as ≤64 KiB chunks; without
  //    batching here, xterm repaints each chunk as a separate rAF tick,
  //    producing the intermediate frames 2026 is designed to suppress.
  //  - Fit-then-snapshot replay (replay_begin/replay_end): server pushes
  //    scrollback+snapshot at the client's requested size; without batching,
  //    settle-ladder / ResizeObserver can interrupt mid-write and the
  //    snapshot's absolute-row addressing clamps/wraps to wrong dimensions
  //    (refresh-misalign P2 root cause).
  //
  // A depth counter supports nesting: a sync_end arriving mid-replay defers
  // the flush until replay_end closes the outer transaction. Stray end
  // events with depth == 0 are no-ops.

  private _handleSyncBegin() {
    this._beginTransaction()
  }

  private _handleSyncEnd() {
    this._endTransaction()
    // The transaction guard in _doFitAndResize/_settleRefit suppressed
    // fitting while sync was active. Re-arm the ladder so any wrapper
    // size change during the sync is applied now that the buffered bytes
    // have landed.
    if (this._transactionDepth === 0) {
      this._scheduleSettleResize()
    }
  }

  private _handleReplayBegin(cols: number, rows: number) {
    // Record the size the server claims the snapshot was encoded at — used
    // at replay_end to detect whether our wrapper changed mid-replay and we
    // need to re-request.
    this._snapshotRequestedSize = { cols, rows }
    this._beginTransaction()
  }

  private _handleReplayEnd() {
    this._endTransaction()
    // Optional correctness check (MV: just log mismatch; a follow-up can
    // re-request automatically). If the wrapper size changed during the
    // replay, the snapshot was encoded at a stale size and may misalign.
    if (this._snapshotRequestedSize && this.xterm && this.fitAddon && this._wrapper) {
      const rect = this._wrapper.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        // Compare xterm's current cols/rows (already fit) to what the
        // snapshot was encoded at. If they differ, the wrapper changed
        // during replay.
        if (this.xterm.cols !== this._snapshotRequestedSize.cols
          || this.xterm.rows !== this._snapshotRequestedSize.rows) {
          console.warn(
            `[dinotty] replay_end size mismatch: snapshot ` +
            `${this._snapshotRequestedSize.cols}x${this._snapshotRequestedSize.rows}, ` +
            `xterm now ${this.xterm.cols}x${this.xterm.rows} — snapshot may misalign`
          )
        }
      }
    }
    this._snapshotRequestedSize = null
    // End of the snapshot window: _sendResize is no longer suppressed. The
    // next settle-ladder tick will reclaim the PTY size if our wrapper has
    // drifted from the snapshot's cols/rows.
    this._snapshotPending = false
    // Re-arm the ladder: the transaction guard suppressed fitting during
    // the replay, so any wrapper change during it is now applied.
    this._scheduleSettleResize()
  }

  private _beginTransaction() {
    this._transactionDepth++
  }

  private _endTransaction() {
    if (this._transactionDepth === 0) {
      // Stray end without matching begin. Ignore.
      return
    }
    this._transactionDepth--
    if (this._transactionDepth === 0) {
      this._flushTransaction()
    }
  }

  private _appendToTransaction(data: string) {
    this._transactionBuffer.push(data)
    this._transactionBytes += data.length
    if (this._transactionBytes >= TerminalInstance.MAX_TRANSACTION_BYTES) {
      // Pathological burst (app emitted >8 MiB inside one transaction without
      // an end event, or server watchdog force-flushed raw). Bound memory by
      // flushing early; depth stays >0 so subsequent Output still diverts
      // into a fresh buffer until the matching end arrives.
      this._flushTransaction()
    }
  }

  private _flushTransaction() {
    if (this._transactionBuffer.length === 0) return
    const merged = this._transactionBuffer.join('')
    this._transactionBuffer = []
    this._transactionBytes = 0
    this._enqueueWrite(merged)
  }

  private _resetTransaction() {
    this._transactionDepth = 0
    this._transactionBuffer = []
    this._transactionBytes = 0
    this._snapshotRequestedSize = null
    this._snapshotPending = false
  }

  /// Send a snapshot_request to the server after the wrapper has converged to
  /// a stable non-zero size. The server will reply with replay_begin → chunks
  /// → replay_end. We do NOT enqueue a resize to the PTY here — the server's
  /// atomic_resize_and_snapshot does the PTY resize in the same critical
  /// section as the snapshot, which is what makes the snapshot's dimensions
  /// match the client's actual geometry (the root fix for refresh-misalign).
  ///
  /// Idempotent: if _snapshotRequestedSize is already set (a request is in
  /// flight, waiting on replay_begin), bail. _doFitAndResize also calls this
  /// when the wrapper recovers from a 0×0 collapse so the zero-size retry
  /// path eventually fires the request.
  private _maybeSendSnapshotRequest() {
    if (this._destroyed || !this.xterm || !this.fitAddon || !this._wrapper) return
    if (!this._snapshotPending) return
    if (this._snapshotRequestedSize) return
    const rect = this._wrapper.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      // Still collapsed — _doFitAndResize's zero-size retry will call us
      // again when the wrapper recovers. Bail without sending.
      return
    }
    let cols = this.xterm.cols
    let rows = this.xterm.rows
    if (cols < 2 || rows < 2) {
      // xterm hasn't been fit yet — do one fit now to read cols/rows.
      try {
        this.fitAddon.fit()
        cols = this.xterm.cols
        rows = this.xterm.rows
      } catch {
        return
      }
    }
    if (cols < 2 || rows < 2) return
    this._snapshotRequestedSize = { cols, rows }
    const msg: ClientMsg = { type: 'snapshot_request', cols, rows }
    if (this.ws) {
      this.ws.send(JSON.stringify(msg))
    } else if (this._transport) {
      this._transport.send(msg)
    }
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
        // Read _writePinnedToBottom fresh here, not at batch entry. A
        // wheel-up mid-batch flips the flag to false; using a batch-entry
        // snapshot would override the user's scroll with scrollToBottom.
        if (this._writePinnedToBottom && this.xterm) {
          this.xterm.scrollToBottom()
        }
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
      // Wrap in try/catch: xterm.write() can throw synchronously (e.g. its
      // WriteBuffer "data discarded" above the 50MB watermark). Without this,
      // the callback never fires, _writing stays true, and the write pump is
      // stranded permanently - all subsequent output (including key echo)
      // queues forever and the terminal appears dead until a full page reload.
      let advanced = false
      const advance = () => {
        if (advanced) return
        advanced = true
        if (this._writeWatchdog) {
          clearTimeout(this._writeWatchdog)
          this._writeWatchdog = null
        }
        processNext()
      }
      // Watchdog: xterm.write() can silently drop the callback (no throw,
      // no invocation) when resize interleaves with a pending write under
      // high output. Without this, _writing stays true and the pump is dead.
      // 1s is well above any legitimate write latency but short enough that
      // users don't notice the stall before recovery.
      this._writeWatchdog = setTimeout(() => {
        this._writeWatchdog = null
        this._writeWatchdogFires++
        console.warn(`[dinotty] write pump watchdog fired (${this._writeWatchdogFires}); xterm.write callback lost, force-advancing`)
        advance()
      }, 1000)
      try {
        if (chunk.length > MAX_CHUNK) {
          this._writeQueue.unshift(chunk.slice(MAX_CHUNK))
          this.xterm.write(chunk.slice(0, MAX_CHUNK), advance)
        } else {
          this.xterm.write(chunk, advance)
        }
      } catch (e) {
        console.error('[dinotty] xterm.write threw:', e)
        advance()
      }
    }

    processNext()
  }

  private _isAtBottom(): boolean {
    if (!this.xterm) return true
    const buf = this.xterm.buffer.active
    return buf.viewportY >= buf.baseY
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
    if (this._followingPeer) {
      if (this._wrapperChanged()) this._pendingLocalRefit = true
      return
    }
    if (!this.fitAddon || !this._wrapper) return
    if (this._refitRaf) return
    this._refitRaf = requestAnimationFrame(() => {
      this._refitRaf = 0
      this._doFitAndResize()
    })
  }

  private _sendResize(cols: number, rows: number): boolean {
    // Suppress during the snapshot window: the server's
    // atomic_resize_and_snapshot does the PTY resize in lockstep with the
    // snapshot encode. A client resize here would race it and re-introduce
    // the refresh-misalign the handshake is meant to fix.
    if (this._snapshotPending) return false
    const resizeMsg: ClientMsg = { type: 'resize', cols, rows }
    if (this._transport) {
      if (!this._transportConnected) return false
      this._transport.send(resizeMsg)
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(resizeMsg))
    } else {
      return false
    }
    this._lastSentCols = cols
    this._lastSentRows = rows
    // Cooldown: suppress the post-peer-follow reclaim send for a few
    // seconds so two clients with different stable sizes don't ping-pong
    // the PTY size back and forth. Only the follower (who didn't recently
    // initiate) reclaims; the initiator stays quiet and keeps the peer's
    // size until the user actively resizes.
    this._resizeCooldownUntil = Date.now() + 3000
    return true
  }

  private _wrapperChanged(): boolean {
    if (!this._wrapper) return false
    const r = this._wrapper.getBoundingClientRect()
    return Math.round(r.width) !== this._authWrapperW || Math.round(r.height) !== this._authWrapperH
  }

  private _followPeerResize(cols: number, rows: number) {
    if (this._destroyed || !this.xterm || !this.fitAddon) return
    if (cols < 2 || rows < 2) return
    if (this._refitRaf) {
      cancelAnimationFrame(this._refitRaf)
      this._refitRaf = 0
    }
    for (const h of this._settleTimeouts) clearTimeout(h)
    this._settleTimeouts = []
    if (this._settleRaf) {
      cancelAnimationFrame(this._settleRaf)
      this._settleRaf = 0
    }
    this._settleGeneration++
    try {
      this.xterm.resize(cols, rows)
    } catch {
      return
    }
    const heightChanged = rows !== this._lastRows
    this._lastCols = cols
    this._lastRows = rows
    if (heightChanged && !this.isMouseModeEnabled()) {
      this.xterm.scrollToBottom()
      this._writePinnedToBottom = true
    }
    const gen = ++this._peerFollowGen
    this._followingPeer = true
    this._pendingLocalRefit = false
    const rect = this._wrapper?.getBoundingClientRect()
    this._authWrapperW = rect ? Math.round(rect.width) : 0
    this._authWrapperH = rect ? Math.round(rect.height) : 0
    if (this._peerFollowTimer) {
      clearTimeout(this._peerFollowTimer)
      this._peerFollowTimer = null
    }
    this._peerFollowTimer = window.setTimeout(() => {
      this._peerFollowTimer = null
      if (this._destroyed || gen !== this._peerFollowGen) return
      this._followingPeer = false
      this._pendingLocalRefit = false
      // Refit to local wrapper and reclaim the PTY size - unless we
      // recently initiated a resize ourselves (cooldown). Without the
      // cooldown, two clients with different stable sizes ping-pong the
      // PTY every 500ms: A sends -> B follows -> B reclaims -> A follows
      // -> A reclaims -> repeat. The initiator (who just sent) stays
      // quiet; the follower reclaims so its display matches the PTY.
      if (Date.now() < this._resizeCooldownUntil) return
      this._settleRefit()
    }, 500) as unknown as ReturnType<typeof setTimeout>
  }

  private _settleRefit(): { cols: number; rows: number } | null {
    if (this._followingPeer) {
      if (this._wrapperChanged()) this._pendingLocalRefit = true
      return null
    }
    if (this._destroyed || !this.fitAddon || !this.xterm || !this._wrapper) return null
    // Skip settling during a sync/replay transaction — buffered Output is
    // encoded at the current xterm geometry and a mid-transaction fit would
    // shift geometry under it. sync_end / replay_end re-arms the ladder.
    if (this._transactionDepth > 0) return null
    const rect = this._wrapper.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      // Flex chain collapsed (cold reload, hidden tab, mobile keyboard).
      // settle-ladder samples 0×0 at every tick and gives up after 700ms;
      // poll until the wrapper recovers so we don't strand the terminal at
      // blank until an external reflow (drag/refresh).
      this._scheduleZeroSizeRetry()
      return null
    }
    this._clearZeroSizeRetry()
    try {
      this.fitAddon.fit()
    } catch {
      return null
    }
    const cols = this.xterm.cols
    const rows = this.xterm.rows
    if (cols < 2 || rows < 2) return null
    const heightChanged = rows !== this._lastRows
    this._lastCols = cols
    this._lastRows = rows
    if (heightChanged && !this.isMouseModeEnabled()) {
      this.xterm.scrollToBottom()
      this._writePinnedToBottom = true
    }
    if (cols !== this._lastSentCols || rows !== this._lastSentRows) {
      this._sendResize(cols, rows)
    }
    return { cols, rows }
  }

  private _scheduleSettleResize() {
    for (const h of this._settleTimeouts) clearTimeout(h)
    this._settleTimeouts = []
    if (this._settleRaf) cancelAnimationFrame(this._settleRaf)
    this._settleRaf = 0
    const generation = ++this._settleGeneration
    const sample = () => {
      if (this._destroyed || generation !== this._settleGeneration) return
      this._settleRefit()
    }
    this._settleRaf = requestAnimationFrame(() => {
      this._settleRaf = 0
      sample()
    })
    for (const delay of [50, 120, 250, 450, 700]) {
      this._settleTimeouts.push(setTimeout(sample, delay))
    }
  }

  // Schedule a zero-size retry. Called when _doFitAndResize or _settleRefit
  // see rect.width === 0 || rect.height === 0. The retry goes through
  // _refit → _doFitAndResize, so it reuses the existing dedup rAF path
  // and cancels itself once the wrapper becomes non-zero.
  private _scheduleZeroSizeRetry() {
    if (this._zeroSizeRetryTimer) return
    if (this._zeroSizeRetries >= TerminalInstance.ZERO_SIZE_MAX_RETRIES) {
      console.warn(
        `[dinotty] terminal wrapper still 0×0 after ${this._zeroSizeRetries} retries (~${Math.round(this._zeroSizeRetries * TerminalInstance.ZERO_SIZE_RETRY_MS / 1000)}s); giving up, will recover on next ResizeObserver event`
      )
      this._zeroSizeRetries = 0
      return
    }
    this._zeroSizeRetries++
    this._zeroSizeRetryTimer = setTimeout(() => {
      this._zeroSizeRetryTimer = null
      if (this._destroyed) return
      this._refit()
    }, TerminalInstance.ZERO_SIZE_RETRY_MS) as unknown as ReturnType<typeof setTimeout>
  }

  private _clearZeroSizeRetry() {
    if (this._zeroSizeRetryTimer) {
      clearTimeout(this._zeroSizeRetryTimer)
      this._zeroSizeRetryTimer = null
    }
    this._zeroSizeRetries = 0
  }

  private _doFitAndResize(force = false) {
    if (this._followingPeer) {
      if (this._wrapperChanged()) this._pendingLocalRefit = true
      return
    }
    if (!this.fitAddon || !this.xterm || !this._wrapper) return
    // Skip fitting during a sync/replay transaction: the buffered Output
    // was encoded at the current xterm geometry, and a mid-transaction fit
    // would change geometry out from under it. sync_end / replay_end will
    // re-arm the settle-ladder so the wrapper's post-transaction size is
    // applied as soon as the transaction closes.
    if (this._transactionDepth > 0) return
    const rect = this._wrapper.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      this._scheduleZeroSizeRetry()
      return
    }
    this._clearZeroSizeRetry()
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
      this._writePinnedToBottom = true
    }
    if (force) {
      this._sendResize(cols, rows)
    } else {
      // No frontend debounce: rAF coalesces frame-rate (in _refit), the
      // _lastSentCols/Rows dedup guards no-op frames, and the server's 25ms
      // debounce is the single wire-rate throttle. Stacking a frontend
      // debounce on top added latency without further compression.
      this._sendResize(cols, rows)
    }
    // If we owe the server a snapshot_request (Reconnected arrived while the
    // wrapper was 0×0), fire it now that the wrapper has recovered. Idempotent
    // — bails if already sent or if we're between replay_begin and replay_end.
    if (this._snapshotPending) {
      this._maybeSendSnapshotRequest()
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

      // xterm.js 5.5.0 hardcodes alt-screen wheel-to-arrow conversion with no
      // option (upstream issue #5194); keep this after _wheelBypass so touchScroll's
      // synthetic full-screen scrolling can still use that native conversion.
      if (
        this.xterm.buffer.active.type === 'alternate' &&
        this._isWheelReportedByApp() === false
      ) {
        e.preventDefault()
        e.stopPropagation()
        return false
      }

      // Track user scroll intent to maintain the cross-batch viewport pin.
      // macOS trackpad inertia produces sub-pixel deltaY<0 events that set
      // xterm's isUserScrolling=true; without this filter, a single inertia
      // event between rAF-yielded write batches would un-pin and drop the
      // viewport above ybase mid-stream.
      if (e.deltaY < 0) {
        if (this._wheelUpResetTimer) clearTimeout(this._wheelUpResetTimer)
        this._wheelUpAccumulated += Math.abs(e.deltaY)
        if (this._wheelUpAccumulated > 8) {
          this._writePinnedToBottom = false
        }
        this._wheelUpResetTimer = setTimeout(() => {
          this._wheelUpAccumulated = 0
          this._wheelUpResetTimer = null
        }, 500)
      } else if (e.deltaY > 0) {
        this._wheelUpAccumulated = 0
        if (this._isAtBottom()) {
          this._writePinnedToBottom = true
        }
      }

      const now = Date.now()
      const elapsed = now - this._lastWheelTime
      if (elapsed > 500) this._trackingWheelState = null
      const dt = elapsed || 1
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
      const isMouseTracking = this.isMouseModeEnabled()
      if (!isMouseTracking) this._trackingWheelState = null
      const input: WheelPlanInput = {
        deltaY: e.deltaY,
        deltaX: e.deltaX,
        deltaMode: e.deltaMode,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        velocity,
        isMouseTracking,
      }
      const plan = computeWheelPlan(
        input,
        sensitivity,
        acceleration,
        this._trackingWheelState
      )
      if (plan.action === 'native') {
        this._trackingWheelState = null
        return true
      }
      this._trackingWheelState = plan.nextTrackingState ?? null

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
      if (Number.isFinite(h) && h > 0) return h
    } catch {
      // fall through to the one-time warning below
    }
    if (!this._wheelRowHeightWarned) {
      this._wheelRowHeightWarned = true
      console.warn(
        '[useTerminal] xterm private cell-height API (_core._renderService.dimensions.css.cell.height) unavailable or invalid; wheel-scroll acceleration (velocity term) is disabled, sensitivity still applies. xterm.js internals may have changed.'
      )
    }
    return 0
  }

  private _isWheelReportedByApp(): boolean | undefined {
    try {
      const core = (this.xterm as any)?._core
      const svc =
        core?.coreMouseService ??
        core?.mouseService ??
        core?.services?.coreMouseService
      const activeProtocol = svc?.activeProtocol ?? svc?._activeProtocol
      if (typeof activeProtocol !== 'string') return undefined
      const events = svc?._protocols?.[activeProtocol]?.events
      return typeof events === 'number' ? (events & 16) !== 0 : undefined
    } catch {
      return undefined
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

import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import type { ClientMsg, ServerMsg, SizeClaim } from '../types/protocol'
import { isTauri, createTransport, type Transport, type TransportOptions } from './useTransport'
import { isWebglDisabled, markOp, recordEvent, recordThrottled } from './useDebugRecorder'
import { onThemeChange, settings, type MobileInputMode } from './useSettings'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  getEffectiveText,
  onEffectiveTextChange,
  resetOverride,
  setOverride,
} from './useDeviceTextSettings'
import { wsUrl } from './apiBase'
import { useKeybindings } from './useKeybindings'
import { hostTarget, isWindowsClient } from '../utils/clientPlatform'
import { setupTouchScroll } from '../utils/touchScroll'
import {
  DEDUP_WINDOW_MS,
  IME_SYM_PAIR_MS,
  applyMobileTerminalModifiers,
  emptyMobileTerminalModifiers,
  handleTerminalShortcutKeydown,
  hasTouchHardware,
  isDuplicateOnData,
  isShiftSymbolChar,
  isTouchDevice,
  mobileTerminalModifierActive,
  normalizeTerminalTextareaSelection,
  stripImeConfirmSpace,
  terminalTextareaEdit,
  type TerminalTextareaSnapshot,
  type MobileTerminalModifiers,
} from '../utils/terminalInput'
import { createTerminalWheel, type TerminalWheel } from './useTerminalWheel'
import { attachImeHeuristic } from '../utils/imeAnchor'
import { recordImeInput } from '../utils/imeDiagnostics'
import { setupTerminalDrop } from './useTerminalDrop'
import { findTerminalFileLinks, type TerminalFileTarget } from '../utils/terminalFileLink'
import { readLogicalTerminalLine, type LogicalTerminalLine } from '../utils/terminalLogicalLine'
import { createTerminalOverlay } from './useTerminalOverlay'
import { t } from './useI18n'
import { hasOpenGuard } from '../utils/keyboardGuardMode'

// Re-export pure helpers so existing callers (App.vue, useTabLifecycle,
// useSplitPane, tests) don't need to update their import paths.
export {
  DEDUP_WINDOW_MS,
  applyAfterTerminalComposition,
  applyMobileTerminalModifiers,
  handleTerminalShortcutKeydown,
  isDuplicateOnData,
  isShiftSymbolChar,
  isSinglePrintableAscii,
  isSinglePrintableGrapheme,
  isTouchDevice,
  normalizeTerminalTextareaSelection,
  stripImeConfirmSpace,
  terminalTextareaEdit,
  terminalKeybindingMatches,
} from '../utils/terminalInput'

// Guard for Tauri WKWebView multi-focus: only the active pane should send input.
let _activePaneId: string | null = null
export function setActivePaneId(paneId: string | null) {
  _activePaneId = paneId
}

function resolveTerminalFontFamily(configuredFamily: string, cssFallback: string): string {
  if (configuredFamily) return configuredFamily
  if (isTauri() && hostTarget()?.startsWith('linux-')) return 'monospace'
  return cssFallback
}

// Sticky typing mode (mobile web): while the user is typing in the app's own
// mobile-keyboard textarea, every xterm helper textarea is disabled so that no
// focus can land there — neither programmatic (xterm's own mousedown handler
// calls an explicit focus(), and split-pane activation focuses again on a later
// tick) nor native. That helper carries inputMode='none', so focus landing on it
// is exactly what closes the iOS system keyboard; keeping focus from EVER leaving
// our textarea is what makes this flicker-free instead of restoring it after the
// fact. The query covers hidden split panes too.
// Deliberately sweep on every call so late-created or re-enabled helpers are reconciled.
let _kbTypingLock = false
let _systemImeAuthorized = false

export function setSystemImeAuthorized(open: boolean) {
  _systemImeAuthorized = open
}

export function setKbTypingLock(active: boolean) {
  _kbTypingLock = active
  document.querySelectorAll('.xterm-helper-textarea').forEach((el) => {
    ;(el as HTMLTextAreaElement).disabled = active
  })
}

// True while sticky typing mode holds the iOS keyboard open (touch + collapse
// guard + our textarea focused). Consumers use it to suppress terminal focus
// moves that would blur the mobile keyboard input and close the iOS keyboard.
export function isKbTypingLocked(): boolean {
  return _kbTypingLock
}

export function configureMobileInputTextarea(
  textarea: HTMLTextAreaElement,
  mode: MobileInputMode | null | undefined = settings.mobile_input_mode
) {
  const allowSoftwareKeyboard =
    mode === 'system' &&
    (!isTouchDevice() || !hasOpenGuard(settings.keyboard_guard_mode) || _systemImeAuthorized)
  if (allowSoftwareKeyboard) {
    textarea.inputMode = 'text'
    textarea.setAttribute('virtualkeyboardpolicy', 'auto')
    textarea.enterKeyHint = 'enter'
  } else {
    textarea.inputMode = 'none'
    textarea.setAttribute('virtualkeyboardpolicy', 'manual')
    textarea.removeAttribute('enterkeyhint')
  }
  textarea.disabled = _kbTypingLock
}

export function configureAllMobileInputTextareas(mode: MobileInputMode | null | undefined) {
  if (typeof document === 'undefined') return
  document.querySelectorAll<HTMLTextAreaElement>('.xterm-helper-textarea').forEach((textarea) => {
    configureMobileInputTextarea(textarea, mode)
  })
}

/**
 * Convert a match's string offsets to an xterm buffer range. Wrapped rows and
 * wide glyphs mean offsets are not cell columns, so both ends come from the
 * logical line's per-character cell map. The end is the cell after the last
 * character, matching the previous single-line behavior.
 */
function matchRange(line: LogicalTerminalLine, start: number, end: number) {
  const first = line.cells[start]
  const lastCell = line.cells[end - 1]
  if (!first || !lastCell) return null
  return {
    start: { x: first.x, y: first.y },
    end: { x: lastCell.x + lastCell.width, y: lastCell.y },
  }
}

export interface UrlLinkProviderCallbacks {
  /** Logical (soft-wrap aware) line, or undefined when the row is absent. */
  readLine: (bufferLineNumber: number) => LogicalTerminalLine | undefined
  /** Primary activation opens the URL directly. */
  onOpen: (url: string) => void
  /** Non-primary activation keeps the previous context-menu path. */
  onMenu: (url: string, x: number, y: number) => void
  /** Pointer hover tracking; null on leave. */
  onHover: (url: string | null) => void
}

/**
 * URL link provider shared by the terminal panes. Factored out of
 * `attach` so the click routing (primary opens, other buttons menu) and
 * the hover bookkeeping are unit-testable without a live xterm instance.
 */
export function createUrlLinkProvider(callbacks: UrlLinkProviderCallbacks) {
  return {
    provideLinks: (bufferLineNumber: number, callback: (links: any[] | undefined) => void) => {
      const line = callbacks.readLine(bufferLineNumber)
      if (!line) {
        callback(undefined)
        return
      }
      const text = line.text
      const regex =
        /(?:https?:\/\/[^\s"'<>]+|(?:www\.)[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})+(?:\/[^\s"'<>]*)?)/g
      const links: any[] = []
      let match
      while ((match = regex.exec(text)) !== null) {
        const raw = match[0]
        const uri = raw.startsWith('http') ? raw : `http://${raw}`
        const range = matchRange(line, match.index, match.index + raw.length)
        if (!range) continue
        links.push({
          range,
          text: uri,
          activate: (event: MouseEvent) => {
            // Primary click opens the link directly. Any other button
            // keeps the previous menu path so its action stays reachable.
            if (event.button === 0) {
              callbacks.onOpen(uri)
            } else {
              callbacks.onMenu(uri, event.clientX, event.clientY)
            }
          },
          hover: () => {
            callbacks.onHover(uri)
          },
          leave: () => {
            callbacks.onHover(null)
          },
        })
      }
      callback(links.length > 0 ? links : undefined)
    },
  }
}

export interface FilePathLinkProviderCallbacks {
  /** Logical (soft-wrap aware) line, or undefined when the row is absent. */
  readLine: (bufferLineNumber: number) => LogicalTerminalLine | undefined
  /** Any activation (left click) on a detected path. */
  onOpen: (target: TerminalFileTarget, x: number, y: number) => void
  /** Pointer hover tracking; null on leave. */
  onHover: (path: string | null) => void
}

/**
 * File-path link provider shared by the terminal panes. Factored out of
 * `attach` alongside `createUrlLinkProvider` so the detection regex and the
 * hover bookkeeping are unit-testable without a live xterm instance.
 */
export function createFilePathLinkProvider(callbacks: FilePathLinkProviderCallbacks) {
  return {
    provideLinks: (bufferLineNumber: number, callback: (links: any[] | undefined) => void) => {
      const line = callbacks.readLine(bufferLineNumber)
      if (!line) {
        callback(undefined)
        return
      }
      const links: any[] = []
      for (const match of findTerminalFileLinks(line.text)) {
        const range = matchRange(line, match.start, match.end)
        if (!range) continue
        links.push({
          range,
          text: match.raw,
          activate: (event: MouseEvent) => {
            callbacks.onOpen(
              { path: match.path, line: match.line, column: match.column },
              event.clientX,
              event.clientY
            )
          },
          hover: () => {
            callbacks.onHover(match.path)
          },
          leave: () => {
            callbacks.onHover(null)
          },
        })
      }
      callback(links.length > 0 ? links : undefined)
    },
  }
}

interface TerminalFit {
  cols: number
  rows: number
  /** The grid actually moved from the previous cols/rows. */
  changed: boolean
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
  private _sessionExited = false
  private _shellType: string | null = null
  sshHost: string | null = null // "user@host:port" for SSH tabs
  private _suppressTitleChange = false
  private _touchCleanup: (() => void) | null = null
  private _compositionCleanup: (() => void) | null = null
  // Pins the IME textarea/composition-view to Ink's inverse caret cell while
  // composing (Windows ConPTY cursor drift). Detached in destroy().
  private _imeAnchorDetach: { detach(): void } | null = null
  private _resizeObserver: ResizeObserver | null = null
  private _themeUnsub: (() => void) | null = null
  private _textUnsub: (() => void) | null = null
  private _refitRaf: number = 0
  private _lastCols = 0
  private _lastRows = 0
  private _lastInputData = ''
  private _lastInputTime = 0
  private _symCredits: Array<{ data: string; src: 0 | 1; at: number }> = []
  private _inputTextarea: HTMLTextAreaElement | null = null
  private _ime229Baseline: TerminalTextareaSnapshot | null = null
  private _ime229InputData: string | null = null
  private _ime229Timer: ReturnType<typeof setTimeout> | null = null
  // The same textarea snapshot/diff owner handles keyCode 229 and mobile
  // dictation tail replacements, but their event lifecycles must not overlap.
  private _ime229Owner: 'key' | 'tail-replacement' | null = null
  private _imeTailReplacement: { data: string; value: string; sawRaw: boolean } | null = null
  // IME composition state. Tracked via compositionstart/compositionend on the
  // xterm textarea so focusActive() can avoid .focus()/.blur()/.fit() during
  // composition - those calls interrupt the IME session and cause xterm's
  // diff-fallback to leak preedit text as raw input.
  private _composing = false
  private _mobileModifiers: MobileTerminalModifiers = emptyMobileTerminalModifiers()
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
  // Bounded retry for a SnapshotRequest that never produces a replay (lost
  // request, server-side failure). Without it, the server stays
  // snapshot_pending and drops every Output chunk, leaving a blank pane until a
  // hard reload.
  private _snapshotAttempts = 0
  private _snapshotRetryTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly SNAPSHOT_RETRY_MS = 3000
  private static readonly MAX_SNAPSHOT_ATTEMPTS = 3
  // Watchdog for a replay/sync transaction that never closes (e.g. ReplayEnd
  // dropped by a full client channel). While _transactionDepth > 0 every
  // Output is buffered and never written, so a lost end event wedges the pane.
  private _transactionWatchdog: ReturnType<typeof setTimeout> | null = null
  private static readonly TRANSACTION_WATCHDOG_MS = 5000
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
  touchMoved = false
  inTouchSelection = false
  selStartRow = 0
  selStartCol = 0
  private _visibilityHandler: (() => void) | null = null
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
  private _forceWebSocket = false
  // Size we currently believe the PTY has. Updated on every successful send
  // and on every peer `Resize`/`Reconnected`. It is intentionally the PTY's
  // known size, not "what this client last sent": a follower that adopts a
  // peer size must still be able to re-assert its local size later.
  private _knownPtyCols = 0
  private _knownPtyRows = 0
  // True while this device owns the PTY size. Set optimistically after a claim
  // (standalone or attached to input) and cleared by any peer `Resize`.
  private _isOwner = false
  // A trusted user gesture/focus occurred after ownership was lost; the next
  // input carries a claim, or the timer sends a standalone one.
  private _claimNeeded = false
  // A claim arrived while a replay/sync transaction was open; send it once the
  // transaction closes instead of racing the snapshot.
  private _claimQueued = false
  private _claimTimer: ReturnType<typeof setTimeout> | null = null
  private _claimCleanup: (() => void) | null = null
  private _lastClaim: { cols: number; rows: number; at: number } | null = null
  private static readonly CLAIM_DEDUP_MS = 2000
  // Resize reentrancy guard. xterm's WebGL renderer must not be resized
  // re-entrantly; queue the latest request and apply it after the current one
  // returns. Also used to keep hidden (display:none) panes untouched.
  private _applyingGrid = false
  private _queuedGrid: { cols: number; rows: number; reason: string } | null = null
  private _fitQueued = false
  private _hiddenReplay = false
  private static readonly MAX_GRID_COLS = 1000
  private static readonly MAX_GRID_ROWS = 300
  private _followingPeer = false
  private _peerFollowGen = 0
  private _peerFollowTimer: ReturnType<typeof setTimeout> | null = null
  private _wheel: TerminalWheel | null = null
  private _dropCleanup: (() => void) | null = null
  private _overlayCtl: ReturnType<typeof createTerminalOverlay> | null = null
  onFileUpload?: (files: File[]) => void

  onTitleChange: ((title: string) => void) | null = null
  onShellInfo: ((shell: string) => void) | null = null
  onConnect: (() => void) | null = null
  onDisconnect: (() => void) | null = null
  onFileClick: ((target: TerminalFileTarget, x?: number, y?: number) => void) | null = null
  onFileLinkHover: ((path: string | null) => void) | null = null
  onPreviewLink: ((url: string, x?: number, y?: number) => void) | null = null
  onPreviewLinkOpen: ((url: string) => void) | null = null
  onPreviewLinkHover: ((url: string | null) => void) | null = null
  onRawOutput: ((data: string) => void) | null = null
  onInput: ((data: string) => void) | null = null
  onSessionExit: (() => void) | null = null
  onReconnect: (() => void) | null = null

  constructor(paneId: string, opts?: TransportOptions) {
    this.paneId = paneId
    this._forceWebSocket = opts?.forceWebSocket ?? false
  }

  attach(wrapper: HTMLElement) {
    this._wrapper = wrapper

    const s = getComputedStyle(document.documentElement)
    const v = (name: string) => s.getPropertyValue(name).trim()

    const text = getEffectiveText()
    const fontFamily = resolveTerminalFontFamily(text.font_family, v('--font-mono'))

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
        // OSC-8 hyperlinks only (provider-detected URLs use the link
        // provider below). Activation is a primary click by construction,
        // so it opens directly; right-clicks arrive via contextmenu.
        activate: (_event, text) => {
          const uri = text.startsWith('http') ? text : `http://${text}`
          if (this.onPreviewLinkOpen) {
            this.onPreviewLinkOpen(uri)
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
    this._installClaimTriggers(wrapper)

    // Anchor the IME preedit/candidate window to Ink's fake caret (a lone
    // inverse cell) instead of the hardware cursor, which Claude Code on
    // Windows ConPTY leaves at the right edge of the status row (#276).
    this._imeAnchorDetach = attachImeHeuristic(this.xterm)

    // Ctrl+Shift+C/V: Linux-style copy/paste (macOS uses Cmd+C/V natively)
    const xt = this.xterm
    const { isAppShortcut } = useKeybindings()
    xt.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // maxTouchPoints, not isTouchDevice(): desktop Safari/WKWebView exposes
      // `ontouchstart` without touch hardware, and arming the 229 snapshot
      // machinery there eats desktop IME commits (#256 regression). The
      // machinery stays scoped to system-mode touch input (and Tauri touch,
      // e.g. Windows tablets); iPhone builtin mode never had it armed and
      // arming it there breaks the builtin keyboard's own input path.
      const acceptsTextarea229 =
        hasTouchHardware() && (settings.mobile_input_mode === 'system' || isTauri())
      const isTextarea229 =
        acceptsTextarea229 &&
        !e.isComposing &&
        !this._composing &&
        (e.keyCode === 229 || e.key === 'Process')
      const ownsTextarea229 =
        isTextarea229 ||
        (acceptsTextarea229 &&
          this._ime229Owner === 'key' &&
          this._ime229Baseline != null &&
          e.type === 'keyup')
      if (ownsTextarea229) {
        if (e.type === 'keydown' && !this._composing) this._startIme229()
        else if (e.type === 'keyup') this._flushIme229(false)
        return false
      }
      if (e.type === 'keydown' && this._ime229Baseline != null) this._flushIme229(true)
      if (e.type === 'keydown') {
        if (e.isComposing || (e as any).keyCode === 229 || e.key === 'Process') return true

        // Web only: let the OS-native Ctrl+V fire so the capture-phase paste listener
        // (setupTerminalDrop) receives clipboardData files/images for upload; plain text
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

    if (!isWebglDisabled()) {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          recordEvent('gl-lost')
          webgl.dispose()
          // Disposing restores the canvas renderer but doesn't trigger a
          // redraw. Without refresh, the terminal appears frozen until the
          // next resize (e.g. dragging the window) kicks the render service.
          const rows = this.xterm?.rows ?? 1
          this.xterm?.refresh(0, Math.max(0, rows - 1))
        })
        this.xterm.loadAddon(webgl)
        recordEvent('gl-ok')
      } catch {
        /* DOM renderer fallback */
        recordEvent('gl-fail')
      }
    }

    this.searchAddon = new SearchAddon()
    this.xterm.loadAddon(this.searchAddon)

    const textarea = wrapper.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    this._inputTextarea = textarea
    if (textarea && isTouchDevice()) configureMobileInputTextarea(textarea)
    // Track IME composition state on all platforms so focusActive() can
    // defer .focus()/.blur()/.fit() during composition. Interrupting an
    // in-flight composition causes xterm's diff-fallback to leak preedit
    // text as raw input (P3).
    if (textarea) {
      const onStart = () => {
        this._clearIme229()
        this._composing = true
        textarea.dataset.dinottyComposing = 'true'
      }
      const onEnd = () => {
        this._composing = false
        textarea.dataset.dinottyComposing = 'false'
      }
      textarea.addEventListener('compositionstart', onStart)
      textarea.addEventListener('compositionend', onEnd)
      const prevCleanup = this._compositionCleanup
      this._compositionCleanup = () => {
        textarea.removeEventListener('compositionstart', onStart)
        textarea.removeEventListener('compositionend', onEnd)
        delete textarea.dataset.dinottyComposing
        this._composing = false
        prevCleanup?.()
      }
    }
    // FIX: intercept macOS input method text replacement (e.g. Raycast snippets).
    // xterm.js accumulates typed chars in the textarea. When a snippet expands,
    // the OS replaces the trigger text via insertText:replacementRange:. We track
    // the textarea value via `input` events, then on `beforeinput` send backspaces
    // for the old value before xterm.js forwards the new text to the PTY.
    if (textarea) {
      let _trackedTextareaValue = ''
      textarea.addEventListener('input', ((e: Event) => {
        const ie = e as InputEvent
        const tailReplacement = this._imeTailReplacement
        if (tailReplacement) {
          const matches =
            !ie.isComposing &&
            ie.inputType === 'insertText' &&
            ie.data === tailReplacement.data &&
            textarea.value === tailReplacement.value
          this._imeTailReplacement = null
          if (tailReplacement.sawRaw && matches) {
            this._ime229InputData = ie.data
            this._armIme229Fallback()
            return
          }
          if (tailReplacement.sawRaw) {
            // The DOM is the authoritative result. Reconcile from the original
            // chain baseline so a later prediction mismatch cannot discard the
            // earlier raw candidates that were already suppressed.
            this._ime229InputData = ie.data
            this._flushIme229(true)
            return
          }
          this._clearIme229()
        }
        if (this._ime229Baseline != null && !ie.isComposing) {
          this._ime229InputData = ie.data
          this._armIme229Fallback()
          return
        }
        if (ie.isComposing) return
        _trackedTextareaValue = textarea.value
      }) as EventListener)
      textarea.addEventListener('beforeinput', ((e: Event) => {
        const ie = e as InputEvent
        // iOS dictation revises its current hypothesis by selecting a textarea
        // tail and emitting the whole replacement as insertText. xterm treats
        // that data as a fresh append, so arm our existing snapshot/diff path
        // before xterm's input listener sees it. All unmatched events continue
        // through the existing replacement-text handling below.
        if (
          hasTouchHardware() &&
          !isTauri() &&
          settings.mobile_input_mode === 'system' &&
          !this._composing &&
          !ie.isComposing &&
          !this.xterm?.options.screenReaderMode &&
          ie.inputType === 'insertText' &&
          typeof ie.data === 'string' &&
          ie.data
        ) {
          const start = textarea.selectionStart
          const end = textarea.selectionEnd
          if (
            start != null &&
            end != null &&
            start !== end &&
            end === textarea.value.length &&
            this._ime229Owner !== 'key'
          ) {
            if (this._ime229Baseline == null) this._startIme229('tail-replacement')
            if (this._ime229Owner === 'tail-replacement') {
              this._imeTailReplacement = {
                data: ie.data,
                value: `${textarea.value.slice(0, start)}${ie.data}`,
                sawRaw: false,
              }
              return
            }
          }
        }
        if (this._composing) return
        // Only intercept insertReplacementText (macOS text replacement);
        // insertText is normal typing and must not send backspaces.
        if (ie.inputType !== 'insertReplacementText') return
        const ranges = typeof ie.getTargetRanges === 'function' ? ie.getTargetRanges() : []
        const rangeLen =
          ranges.length > 0
            ? (ranges[0] as StaticRange).endOffset - (ranges[0] as StaticRange).startOffset
            : 0
        const deleteLen = Math.max(rangeLen, _trackedTextareaValue.length)
        if (deleteLen > 0) {
          this.sendData('\x7f'.repeat(deleteLen))
          _trackedTextareaValue = ''
        }
      }) as EventListener)
    }
    if (textarea && (isTauri() || isTouchDevice())) {
      const onImeInput = (e: InputEvent) => {
        if (this._ime229Baseline != null) return
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
    this.xterm.registerLinkProvider(
      createFilePathLinkProvider({
        readLine: (bufferLineNumber) =>
          readLogicalTerminalLine(this.xterm!.buffer.active, bufferLineNumber, this.xterm!.cols),
        onOpen: (target, x, y) => {
          this.onFileClick?.(target, x, y)
        },
        onHover: (path) => {
          this.onFileLinkHover?.(path)
        },
      })
    )

    // Register URL link provider (all URL links open in the in-app preview)
    this.xterm.registerLinkProvider(
      createUrlLinkProvider({
        readLine: (bufferLineNumber) =>
          readLogicalTerminalLine(this.xterm!.buffer.active, bufferLineNumber, this.xterm!.cols),
        onOpen: (uri) => {
          if (this.onPreviewLinkOpen) {
            this.onPreviewLinkOpen(uri)
          } else {
            window.open(uri, '_blank')
          }
        },
        onMenu: (uri, x, y) => {
          if (this.onPreviewLink) {
            this.onPreviewLink(uri, x, y)
          } else {
            window.open(uri, '_blank')
          }
        },
        onHover: (uri) => {
          this.onPreviewLinkHover?.(uri)
        },
      })
    )

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
    this._dropCleanup = setupTerminalDrop(wrapper, {
      sendData: (d, force) => this.sendData(d, force),
      onFileUpload: (files) => this.onFileUpload?.(files),
    })
    this._wheel = createTerminalWheel({
      getXterm: () => this.xterm,
      isMouseModeEnabled: () => this.isMouseModeEnabled(),
      getWritePinnedToBottom: () => this._writePinnedToBottom,
      setWritePinnedToBottom: (v) => {
        this._writePinnedToBottom = v
      },
    })
    this._overlayCtl = createTerminalOverlay({
      getWrapper: () => this._wrapper,
      isSsh: () => this._shellType === 'ssh',
      getSshHost: () => this.sshHost,
      getOnReconnect: () => this.onReconnect,
    })
    this._touchCleanup = setupTouchScroll(wrapper, {
      getXterm: () => this.xterm,
      isInTouchSelection: () => this.inTouchSelection,
      setTouchMoved: (v) => {
        this.touchMoved = v
      },
      sendWheelEvent: (deltaY, clientX, clientY) =>
        this._wheel?.sendWheelEvent(deltaY, clientX, clientY),
    })
    this._wheel.setup()

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
      this.xterm.options.fontFamily = resolveTerminalFontFamily(
        text.font_family,
        getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
      )
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
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      this._paneVisible()
    ) {
      this._markClaimNeeded()
    }
  }

  blur() {
    this.clearVirtualModifiers()
    this.xterm?.blur()
  }

  setVirtualModifiers(modifiers: MobileTerminalModifiers) {
    this._mobileModifiers = { ...modifiers }
  }

  clearVirtualModifiers(notify = true) {
    const hadModifiers = Object.values(this._mobileModifiers).some(mobileTerminalModifierActive)
    this._mobileModifiers = emptyMobileTerminalModifiers()
    if (notify && hadModifiers && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('dinotty-mobile-modifiers-consumed', {
          detail: { paneId: this.paneId, modifiers: { ...this._mobileModifiers } },
        })
      )
    }
  }

  fit() {
    this._refit()
  }

  adjustFontSize(delta: number) {
    if (!this.xterm) return
    const newSize = Math.max(
      FONT_SIZE_MIN,
      Math.min(FONT_SIZE_MAX, getEffectiveText().font_size + delta)
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
    const claim = force ? undefined : this._consumeClaimForInput()
    const msg: ClientMsg = claim ? { type: 'input', data, claim } : { type: 'input', data }
    if (this._transport) {
      return this._transport.send(msg)
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  /** Install the user-gesture triggers that claim PTY-size ownership. */
  private _installClaimTriggers(wrapper: HTMLElement) {
    const mark = (event: Event) => {
      if (!event.isTrusted) return
      this._markClaimNeeded()
    }
    const onFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this._markClaimNeeded()
      }
    }
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      // A user resizing the window while this device is focused is a strong
      // "I'm using this device" signal. Debounce so a drag claims once, and
      // skip if the native grid already matches the PTY.
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        const dims = this._claimDims()
        if (!dims) return
        if (dims.cols === this._knownPtyCols && dims.rows === this._knownPtyRows) return
        this._markClaimNeeded()
      }, 300)
    }
    wrapper.addEventListener('pointerdown', mark, true)
    wrapper.addEventListener('touchstart', mark, true)
    wrapper.addEventListener('keydown', mark, true)
    window.addEventListener('focus', onFocus)
    // Window resize is a clear intent on desktop, but on touch devices Safari
    // fires it for address-bar/visual-viewport churn; those must not steal the
    // PTY. Touch devices use pointer/key/focus claims instead.
    if (!isTouchDevice()) window.addEventListener('resize', onResize)
    this._claimCleanup = () => {
      wrapper.removeEventListener('pointerdown', mark, true)
      wrapper.removeEventListener('touchstart', mark, true)
      wrapper.removeEventListener('keydown', mark, true)
      window.removeEventListener('focus', onFocus)
      if (!isTouchDevice()) window.removeEventListener('resize', onResize)
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }

  /**
   * A trusted gesture happened. Give the input path ~200ms to carry the claim
   * on its `input` message (which guarantees resize-before-write ordering on
   * both transports); if no input follows, send a standalone claim so a tap or
   * focus still converges the PTY to this device.
   */
  private _markClaimNeeded() {
    if (this._destroyed || this._sessionExited) return
    if (!this._paneVisible()) return
    // An owner whose native size already matches the PTY does not need to
    // claim on every click; only a lost/outdated ownership does.
    if (this._isOwner) {
      const dims = this._claimDims()
      if (dims && dims.cols === this._knownPtyCols && dims.rows === this._knownPtyRows) return
    }
    this._claimNeeded = true
    if (this._claimTimer) clearTimeout(this._claimTimer)
    this._claimTimer = setTimeout(() => {
      this._claimTimer = null
      this._maybeSendClaim()
    }, 200)
  }

  /** False for panes in an inactive tab (`display: none`) or a collapsed flex. */
  private _paneVisible(): boolean {
    if (!this._wrapper) return false
    const rect = this._wrapper.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  /** True when this device should claim on attach (visible AND focused). */
  private _shouldClaimOnAttach(): boolean {
    if (typeof document === 'undefined') return false
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return false
    // A visible wrapper means this pane belongs to the active DinoTTY tab.
    // The active-pane fallback covers the transient 0×0 window before layout
    // settles; an inactive tab's display:none panes match neither.
    return this._paneVisible() || _activePaneId === this.paneId
  }

  /**
   * Ownership is re-resolved on every reconnect; do not let a stale `_isOwner`
   * send a resize before the server's `Reconnected` tells us the current size.
   */
  private _resetOwnershipForConnect() {
    this._isOwner = false
    this._claimNeeded = false
    this._claimQueued = false
    this._knownPtyCols = 0
    this._knownPtyRows = 0
    this._lastClaim = null
    if (this._claimTimer) {
      clearTimeout(this._claimTimer)
      this._claimTimer = null
    }
  }

  /** Native dimensions of this device, independent of the current xterm grid. */
  private _claimDims(): SizeClaim | null {
    if (!this.xterm || !this._paneVisible()) return null
    const proposed = this.fitAddon?.proposeDimensions?.()
    const cols = proposed?.cols ?? this.xterm.cols
    const rows = proposed?.rows ?? this.xterm.rows
    if (cols < 2 || rows < 2) return null
    return { cols, rows }
  }

  private _takeOwnership(dims: SizeClaim) {
    this._isOwner = true
    this._claimNeeded = false
    this._claimQueued = false
    this._knownPtyCols = dims.cols
    this._knownPtyRows = dims.rows
    this._lastClaim = { cols: dims.cols, rows: dims.rows, at: Date.now() }
    if (this._claimTimer) {
      clearTimeout(this._claimTimer)
      this._claimTimer = null
    }
    // Fit to the claimed native size now that we own the PTY.
    this._scheduleSettleResize()
  }

  /** True when this exact size was already claimed inside the dedup window. */
  private _isDuplicateClaim(dims: SizeClaim): boolean {
    const last = this._lastClaim
    if (!last) return false
    if (last.cols !== dims.cols || last.rows !== dims.rows) return false
    return Date.now() - last.at < TerminalInstance.CLAIM_DEDUP_MS
  }

  private _maybeSendClaim() {
    if (this._destroyed || !this.xterm || this._sessionExited) return
    if (!this._claimNeeded) {
      this._claimQueued = false
      return
    }
    if (this._snapshotPending || this._transactionDepth > 0) {
      this._claimQueued = true
      return
    }
    const dims = this._claimDims()
    if (!dims) return
    // If the PTY already has this device's native size, a claim would only
    // generate a no-op Resize broadcast and risk a feedback loop.
    if (dims.cols === this._knownPtyCols && dims.rows === this._knownPtyRows) {
      this._claimNeeded = false
      this._claimQueued = false
      return
    }
    if (this._isDuplicateClaim(dims)) {
      this._claimNeeded = false
      this._claimQueued = false
      return
    }
    const msg: ClientMsg = { type: 'claim', cols: dims.cols, rows: dims.rows }
    recordThrottled('term.claim.send', { cols: dims.cols, rows: dims.rows }, 250)
    let sent = false
    if (this.ws) {
      try {
        this.ws.send(JSON.stringify(msg))
        sent = true
      } catch {
        sent = false
      }
    } else if (this._transport) {
      try {
        this._transport.send(msg)
        sent = true
      } catch {
        sent = false
      }
    }
    if (sent) this._takeOwnership(dims)
    else this._claimQueued = true
  }

  /**
   * Return a claim for the input message about to be sent. Attaching it to the
   * same message is what guarantees the server resizes before processing the
   * keystroke on the Tauri IPC path as well as over WebSocket.
   */
  private _consumeClaimForInput(): SizeClaim | undefined {
    if (!this._claimNeeded && !this._claimQueued) return undefined
    if (this._snapshotPending || this._transactionDepth > 0) {
      this._claimQueued = true
      return undefined
    }
    const dims = this._claimDims()
    if (!dims) return undefined
    if (dims.cols === this._knownPtyCols && dims.rows === this._knownPtyRows) {
      this._claimNeeded = false
      this._claimQueued = false
      return undefined
    }
    if (this._isDuplicateClaim(dims)) {
      this._claimNeeded = false
      this._claimQueued = false
      return undefined
    }
    recordThrottled('term.claim.input', { cols: dims.cols, rows: dims.rows }, 250)
    this._takeOwnership(dims)
    return dims
  }

  private _startIme229(owner: 'key' | 'tail-replacement' = 'key') {
    if (!this._inputTextarea || this._ime229Baseline != null) return
    this._ime229Owner = owner
    this._ime229Baseline = {
      value: this._inputTextarea.value,
      selectionStart: this._inputTextarea.selectionStart,
      selectionEnd: this._inputTextarea.selectionEnd,
    }
    this._armIme229Fallback()
  }

  private _armIme229Fallback() {
    if (this._ime229Timer) clearTimeout(this._ime229Timer)
    this._ime229Timer = setTimeout(() => {
      this._ime229Timer = null
      this._flushIme229(true)
    }, 80)
  }

  private _flushIme229(clearEmpty: boolean) {
    const before = this._ime229Baseline
    const textarea = this._inputTextarea
    if (!before || !textarea || this._composing) {
      this._clearIme229()
      return
    }
    const observed = {
      value: textarea.value,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
    }
    const after = normalizeTerminalTextareaSelection(before, observed, this._ime229InputData)
    let data = terminalTextareaEdit(
      before,
      after,
      this.xterm?.modes.applicationCursorKeysMode ?? false
    )
    // WebKit can deliver the IME confirm keydown after compositionend, so it
    // reads as a fresh non-composition 229 and arms this baseline while xterm
    // has already forwarded the commit via onData (dropped while the baseline
    // owns the diff) and cleared the textarea. The diff then reconstructs
    // nothing; _ime229InputData still holds the authoritative committed text
    // and is the only thing preventing the whole IME word from being lost.
    if (!data && this._ime229InputData) data = this._ime229InputData
    if (!data && !clearEmpty) return
    if (
      after.selectionStart !== observed.selectionStart ||
      after.selectionEnd !== observed.selectionEnd
    ) {
      textarea.setSelectionRange(after.selectionStart, after.selectionEnd)
    }
    this._clearIme229()
    if (data) this._handleXtermData(data, true)
  }

  private _clearIme229() {
    if (this._ime229Timer) clearTimeout(this._ime229Timer)
    this._ime229Timer = null
    this._ime229Baseline = null
    this._ime229InputData = null
    this._ime229Owner = null
    this._imeTailReplacement = null
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

  private _handleXtermData(rawData: string, fromIme229 = false) {
    recordImeInput(fromIme229 ? 'ime229' : 'onData', rawData)
    // Mouse reports produced synchronously by our synthetic wheel dispatches
    // (wheel.sendWheelEvent) are legitimate identical repeats; the WKWebView
    // key-replay dedup below must not eat them.
    if (this._wheel?.isBypassActive()) {
      this._emitInput(rawData)
      return
    }
    const tailReplacement = this._imeTailReplacement
    if (
      !fromIme229 &&
      this._ime229Owner === 'tail-replacement' &&
      tailReplacement &&
      rawData === tailReplacement.data
    ) {
      tailReplacement.sawRaw = true
      return
    }
    // The non-composition 229 cycle owns the final textarea diff. xterm can
    // also surface the same input through onData; accepting both duplicates it.
    if (this._ime229Baseline != null) return
    const tauri = isTauri()
    const rescueImeSymbols = tauri || isTouchDevice()
    let data = rescueImeSymbols ? stripImeConfirmSpace(rawData) : rawData
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
    if (rescueImeSymbols && isShiftSymbolChar(data)) {
      if (!this._resolveSym(data, 1, now)) return
    }
    if (fromIme229 && (data.includes('\x1b') || data.includes('\x7f'))) {
      this._emitInput(data)
      return
    }
    const modified = applyMobileTerminalModifiers(data, this._mobileModifiers)
    data = modified.data
    this._mobileModifiers = modified.modifiers
    if (modified.consumed && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('dinotty-mobile-modifiers-consumed', {
          detail: { paneId: this.paneId, modifiers: { ...this._mobileModifiers } },
        })
      )
    }
    this._emitInput(data)
  }

  private _emitInput(data: string): boolean {
    if (this._sessionExited) return false
    if (_activePaneId !== null && _activePaneId !== this.paneId) return false
    recordImeInput('emit', data)
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
    if (this.xterm) {
      this.xterm.paste(text)
    } else {
      this._emitInput(text)
    }
  }

  sendInput(data: string) {
    this._emitInput(data)
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    for (const h of this._settleTimeouts) clearTimeout(h)
    this._settleTimeouts = []
    this._clearZeroSizeRetry()
    this._clearSnapshotRetry()
    this._clearTransactionWatchdog()
    if (this._settleRaf) cancelAnimationFrame(this._settleRaf)
    if (this._peerFollowTimer) {
      clearTimeout(this._peerFollowTimer)
      this._peerFollowTimer = null
    }
    this._settleGeneration++
    this._peerFollowGen++
    this._followingPeer = false
    this._claimCleanup?.()
    this._claimCleanup = null
    if (this._claimTimer) {
      clearTimeout(this._claimTimer)
      this._claimTimer = null
    }
    if (this._refitRaf) cancelAnimationFrame(this._refitRaf)
    this._resizeObserver?.disconnect()
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler)
    }
    this._wheel?.cleanup()
    this._wheel = null
    this._touchCleanup?.()
    this._compositionCleanup?.()
    this._imeAnchorDetach?.detach()
    this._imeAnchorDetach = null
    this._clearIme229()
    this._inputTextarea = null
    this._dropCleanup?.()
    this._dropCleanup = null
    this._overlayCtl?.cleanup()
    this._overlayCtl = null
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
    this._transport = createTransport(this.paneId, undefined, {
      forceWebSocket: this._forceWebSocket,
    })

    this._transport.onConnect(() => {
      this._transportConnected = true
      this.onConnect?.()
      this._resetOwnershipForConnect()
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
      } else if (msg.type === 'session_error') {
        this._handleSessionError(msg.code)
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
        // Re-resolve ownership on every reconnect: only a visible AND focused
        // attach claims. A hidden background reconnect follows the owner.
        this._isOwner = this._shouldClaimOnAttach()
        this._claimNeeded = !this._isOwner
        this._claimQueued = false
        this._knownPtyCols = msg.cols
        this._knownPtyRows = msg.rows
        if (this._writeWatchdog) {
          clearTimeout(this._writeWatchdog)
          this._writeWatchdog = null
        }
        this._writePinnedToBottom = true
        if (this._isOwner) this._doFitAndResize(true)
        else this._applyOwnerGrid()
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
    // `wsUrl` resolves the hub origin and the relay prefix for the active
    // server. Tauri never reaches this path (see `createTransport`), and the
    // browser is same-origin, so no await is needed to prime it.
    const url = wsUrl(`/ws?paneId=${encodeURIComponent(this.paneId)}`)
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this._reconnectAttempts = 0
      this._overlayCtl?.hide()
      this.onConnect?.()
      this._resetOwnershipForConnect()
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
        this._overlayCtl?.hide()
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
        // Re-resolve ownership on every reconnect: only a visible AND focused
        // attach claims. A hidden background reconnect follows the owner.
        this._isOwner = this._shouldClaimOnAttach()
        this._claimNeeded = !this._isOwner
        this._claimQueued = false
        this._knownPtyCols = msg.cols
        this._knownPtyRows = msg.rows
        if (this._writeWatchdog) {
          clearTimeout(this._writeWatchdog)
          this._writeWatchdog = null
        }
        this._writePinnedToBottom = true
        if (this._isOwner) this._doFitAndResize(true)
        else this._applyOwnerGrid()
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
      } else if (msg.type === 'session_error') {
        this._handleSessionError(msg.code)
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
    this._clearSnapshotRetry()
    this._snapshotRequestedSize = { cols, rows }
    // Do not overwrite `_knownPtyCols/Rows` here: for a non-owner they track the
    // current owner's grid, which may have changed after this replay was
    // encoded. Applying the encoded size to xterm keeps the snapshot coherent;
    // replay_end will re-request at the owner size if they diverged.
    this._hiddenReplay = !this._paneVisible()
    markOp(`term.replay ${cols}x${rows}${this._hiddenReplay ? ' hidden' : ''}`)
    if (!this._hiddenReplay) {
      // Never resize a display:none xterm (WebGL renderer freeze suspect).
      this._applyGrid(cols, rows, 'replay')
      this._lastCols = cols
      this._lastRows = rows
    }
    this._beginTransaction()
  }

  private _handleReplayEnd() {
    const hiddenReplay = this._hiddenReplay
    this._hiddenReplay = false
    const encoded = this._snapshotRequestedSize
    if (hiddenReplay) {
      // A display:none pane must not resize or repaint its WebGL xterm. Drop
      // the buffered snapshot (a fresh request is made when it becomes
      // visible) and consume the transaction without writing it.
      this._transactionBuffer = []
      this._transactionBytes = 0
    }
    this._endTransaction()
    let mismatch = false
    // Compare the wrapper's proposed dimensions (what the next fit would use)
    // to what the snapshot was encoded at. A mismatch means the wrapper changed
    // mid-replay, so the snapshot's absolute addressing may be clipped or
    // wrapped.
    if (
      this._isOwner &&
      this._snapshotRequestedSize &&
      this.xterm &&
      this.fitAddon &&
      this._wrapper
    ) {
      const rect = this._wrapper.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        const proposed = this.fitAddon.proposeDimensions?.()
        const actualCols = proposed?.cols ?? this.xterm.cols
        const actualRows = proposed?.rows ?? this.xterm.rows
        if (
          actualCols !== this._snapshotRequestedSize.cols ||
          actualRows !== this._snapshotRequestedSize.rows
        ) {
          mismatch = true
          console.warn(
            `[dinotty] replay_end size mismatch: snapshot ` +
              `${this._snapshotRequestedSize.cols}x${this._snapshotRequestedSize.rows}, ` +
              `wrapper now ${actualCols}x${actualRows} — re-requesting`
          )
        }
      }
    } else if (
      !this._isOwner &&
      this._snapshotRequestedSize &&
      this._knownPtyCols >= 2 &&
      (this._snapshotRequestedSize.cols !== this._knownPtyCols ||
        this._snapshotRequestedSize.rows !== this._knownPtyRows)
    ) {
      // A peer claimed after our non-owner replay was encoded. Re-request at
      // the current owner grid instead of keeping a misaligned snapshot.
      mismatch = true
      console.warn(
        `[dinotty] replay_end owner-grid mismatch: snapshot ` +
          `${this._snapshotRequestedSize.cols}x${this._snapshotRequestedSize.rows}, ` +
          `owner now ${this._knownPtyCols}x${this._knownPtyRows} — re-requesting`
      )
    }
    if (hiddenReplay) {
      // The hidden snapshot was discarded rather than painted. Keep a request
      // owed so the visible pane gets a coherent replay at its own grid.
      this._snapshotRequestedSize = null
      this._snapshotPending = true
      this._snapshotAttempts = 0
      markOp(`term.replay.dropped hidden ${encoded?.cols}x${encoded?.rows}`)
      this._scheduleSettleResize()
      return
    }
    this._snapshotRequestedSize = null
    this._snapshotPending = false
    if (mismatch && this._snapshotAttempts < TerminalInstance.MAX_SNAPSHOT_ATTEMPTS) {
      this._snapshotAttempts++
      this._snapshotPending = true
      console.warn(
        `[dinotty] snapshot re-request ${this._snapshotAttempts}/${TerminalInstance.MAX_SNAPSHOT_ATTEMPTS}`
      )
    } else {
      this._snapshotAttempts = 0
    }
    // A claim that arrived during the replay can run now.
    if (this._claimQueued) this._maybeSendClaim()
    // Re-arm the ladder: the transaction guard suppressed fitting during
    // the replay, so any wrapper change during it is now applied (and a
    // pending re-request is sent at the new geometry).
    this._scheduleSettleResize()
  }

  private _beginTransaction() {
    this._transactionDepth++
    if (this._transactionDepth === 1) this._armTransactionWatchdog()
  }

  private _endTransaction() {
    if (this._transactionDepth === 0) {
      // Stray end without matching begin. Ignore.
      return
    }
    this._transactionDepth--
    if (this._transactionDepth === 0) {
      this._clearTransactionWatchdog()
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
    this._clearTransactionWatchdog()
    this._clearSnapshotRetry()
    this._transactionDepth = 0
    this._transactionBuffer = []
    this._transactionBytes = 0
    this._snapshotRequestedSize = null
    this._snapshotPending = false
    this._snapshotAttempts = 0
  }

  /// Force-advance a transaction that never received its end event. A dropped
  /// ReplayEnd/SyncEnd (full client channel, buggy app) leaves depth > 0 and
  /// every subsequent Output buffered forever — the pane looks frozen until a
  /// reload. Flush what we have and resume live output.
  private _armTransactionWatchdog() {
    if (this._transactionWatchdog) return
    this._transactionWatchdog = setTimeout(() => {
      this._transactionWatchdog = null
      if (this._destroyed || this._transactionDepth === 0) return
      console.warn(
        `[dinotty] transaction watchdog fired at depth ${this._transactionDepth}; flushing partial buffer`
      )
      this._transactionDepth = 0
      this._flushTransaction()
      this._snapshotRequestedSize = null
      this._snapshotPending = false
      this._scheduleSettleResize()
    }, TerminalInstance.TRANSACTION_WATCHDOG_MS)
  }

  private _clearTransactionWatchdog() {
    if (this._transactionWatchdog) {
      clearTimeout(this._transactionWatchdog)
      this._transactionWatchdog = null
    }
  }

  private _clearSnapshotRetry() {
    if (this._snapshotRetryTimer) {
      clearTimeout(this._snapshotRetryTimer)
      this._snapshotRetryTimer = null
    }
  }

  /// Retry a SnapshotRequest that produced no replay. The server drops every
  /// Output chunk for a pending client, so a lost request is a permanently
  /// blank pane without this. Bounded attempts; after that, give up on the
  /// snapshot window and let normal resize/output resume.
  private _armSnapshotRetry() {
    this._clearSnapshotRetry()
    this._snapshotRetryTimer = setTimeout(() => {
      this._snapshotRetryTimer = null
      if (this._destroyed || !this._snapshotPending) return
      if (this._snapshotAttempts >= TerminalInstance.MAX_SNAPSHOT_ATTEMPTS) {
        console.warn(
          `[dinotty] snapshot_request timed out after ${TerminalInstance.MAX_SNAPSHOT_ATTEMPTS} attempts; resuming live output`
        )
        this._snapshotRequestedSize = null
        this._snapshotPending = false
        this._scheduleSettleResize()
        return
      }
      this._snapshotAttempts++
      // Clear the in-flight guard so _maybeSendSnapshotRequest can fire again.
      this._snapshotRequestedSize = null
      this._maybeSendSnapshotRequest()
      if (!this._snapshotRequestedSize) {
        // Wrapper is still collapsed or xterm is not ready; keep the zero-size
        // retry alive so the next recovery attempts the request again.
        this._scheduleZeroSizeRetry()
      }
    }, TerminalInstance.SNAPSHOT_RETRY_MS)
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
      markOp('term.fit')
      try {
        this.fitAddon.fit()
        cols = this.xterm.cols
        rows = this.xterm.rows
      } catch {
        return
      } finally {
        markOp('term.fit.done')
      }
    }
    if (cols < 2 || rows < 2) return
    this._snapshotRequestedSize = { cols, rows }
    const msg: ClientMsg = { type: 'snapshot_request', cols, rows, claim: this._isOwner }
    if (this._isOwner) {
      this._knownPtyCols = cols
      this._knownPtyRows = rows
    }
    let sent = false
    if (this.ws) {
      try {
        this.ws.send(JSON.stringify(msg))
        sent = true
      } catch {
        sent = false
      }
    } else if (this._transport) {
      try {
        this._transport.send(msg)
        sent = true
      } catch {
        sent = false
      }
    }
    if (sent) {
      this._armSnapshotRetry()
    } else {
      this._snapshotRequestedSize = null
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
        // Self-heal: an un-pinned viewport that has returned to ybase (user
        // scrolled back down, or the un-pin never actually moved the view)
        // must resume following the tail. Without this, one un-pin event
        // detaches the viewport for the rest of the stream (issue #268).
        if (!this._writePinnedToBottom && this.xterm) {
          const buf = this.xterm.buffer.active
          if (buf.viewportY >= buf.baseY) {
            this._writePinnedToBottom = true
          }
        }
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
        markOp('term.write.done')
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
        console.warn(
          `[dinotty] write pump watchdog fired (${this._writeWatchdogFires}); xterm.write callback lost, force-advancing`
        )
        advance()
      }, 1000)
      try {
        markOp('term.write')
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

  private _scheduleReconnect() {
    if (this._destroyed) return
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000)
    this._reconnectAttempts++
    this._overlayCtl?.showReconnect()
    this._reconnectTimer = setTimeout(() => this._connectWS(), delay)
  }

  private _handleSessionExit() {
    if (this._sessionExited) return
    this._sessionExited = true
    this._overlayCtl?.showExit()
    this.onSessionExit?.()
  }

  private _handleSessionError(code: string) {
    this._sessionExited = true
    const key = `terminal.sessionError.${code}`
    const translated = t(key)
    this._overlayCtl?.showError(translated === key ? code : translated)
    this._transport?.disconnect()
    this.ws?.close(1000)
    this.onDisconnect?.()
  }

  _refit() {
    if (!this.fitAddon || !this._wrapper) return
    if (this._refitRaf) return
    this._refitRaf = requestAnimationFrame(() => {
      this._refitRaf = 0
      this._doFitAndResize()
    })
  }

  private _sendResize(cols: number, rows: number): boolean {
    // Only the size owner may resize the PTY. A non-owner's job is to follow
    // the owner's grid; its claim path sends `type: 'claim'` instead.
    if (!this._isOwner) return false
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
    this._knownPtyCols = cols
    this._knownPtyRows = rows
    recordThrottled('term.resize.send', { cols, rows }, 250)
    return true
  }

  private _followPeerResize(cols: number, rows: number) {
    if (this._destroyed || !this.xterm || !this.fitAddon) return
    if (cols < 2 || rows < 2) return
    // The peer claimed ownership. Follow its grid; the next trusted input on
    // this device reclaims. Cancel any pending claim from a previous gesture so
    // it cannot fire after the peer's claim and start a reclaim race.
    this._isOwner = false
    this._claimNeeded = true
    this._claimQueued = false
    this._lastClaim = null
    if (this._claimTimer) {
      clearTimeout(this._claimTimer)
      this._claimTimer = null
    }
    this._knownPtyCols = cols
    this._knownPtyRows = rows
    recordThrottled(
      'term.resize.peer',
      { cols, rows, visible: this._paneVisible(), owner: this._isOwner },
      250
    )
    // Do not resize a display:none xterm. The grid is applied when the pane
    // becomes visible (settle ladder / focus / first input).
    if (!this._paneVisible()) {
      this._followingPeer = false
      this._peerFollowGen++
      if (this._peerFollowTimer) {
        clearTimeout(this._peerFollowTimer)
        this._peerFollowTimer = null
      }
      return
    }
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
    this._applyGrid(cols, rows, 'peer')
    const heightChanged = rows !== this._lastRows
    this._lastCols = cols
    this._lastRows = rows
    if (heightChanged && !this.isMouseModeEnabled()) {
      markOp('term.scroll')
      this.xterm.scrollToBottom()
      markOp('term.scroll.done')
      this._writePinnedToBottom = true
    }
    const gen = ++this._peerFollowGen
    this._followingPeer = true
    if (this._peerFollowTimer) {
      clearTimeout(this._peerFollowTimer)
      this._peerFollowTimer = null
    }
    this._peerFollowTimer = window.setTimeout(() => {
      this._peerFollowTimer = null
      if (this._destroyed || gen !== this._peerFollowGen) return
      this._followingPeer = false
      // Refit to this device's local wrapper. Ownership is unchanged: a
      // follower cannot reclaim by settling alone.
      this._settleRefit()
    }, 500) as unknown as ReturnType<typeof setTimeout>
  }

  private _settleRefit(): TerminalFit | null {
    if (this._followingPeer) return null
    if (this._destroyed || !this.fitAddon || !this.xterm || !this._wrapper) return null
    // Skip settling during a sync/replay transaction — buffered Output is
    // encoded at the current xterm geometry and a mid-transaction fit would
    // shift geometry under it. sync_end / replay_end re-arms the ladder.
    if (this._transactionDepth > 0) return null
    // A non-owner with a known owner grid must never fall back to fitting the
    // local wrapper (that flickers between local and owner size).
    const hasOwnerGrid = this._knownPtyCols >= 2 && this._knownPtyRows >= 2
    const dims = this._isOwner
      ? this._fitLocal()
      : hasOwnerGrid
        ? this._applyOwnerGrid()
        : this._fitLocal()
    if (!dims) return null
    if (this._snapshotPending) this._maybeSendSnapshotRequest()
    if (this._claimQueued) this._maybeSendClaim()
    if (this._isOwner && (dims.cols !== this._knownPtyCols || dims.rows !== this._knownPtyRows)) {
      this._sendResize(dims.cols, dims.rows)
    }
    return dims
  }

  /** Fit to this device's wrapper. Returns whether the grid actually moved. */
  private _fitLocal(): TerminalFit | null {
    if (!this.fitAddon || !this.xterm || !this._wrapper) return null
    const rect = this._wrapper.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      // Flex chain collapsed (cold reload, hidden tab, mobile keyboard).
      // settle-ladder samples 0×0 at every tick and gives up after 700ms;
      // poll until the wrapper recovers so we don't strand the terminal at
      // blank until an external reflow (drag/refresh).
      this._scheduleZeroSizeRetry()
      return null
    }
    // Refuse a pathological layout before fit() resizes xterm: an unbounded
    // wrapper feedback loop would otherwise allocate an enormous WebGL canvas.
    const proposed = this.fitAddon.proposeDimensions?.()
    if (
      proposed &&
      (proposed.cols > TerminalInstance.MAX_GRID_COLS ||
        proposed.rows > TerminalInstance.MAX_GRID_ROWS)
    ) {
      console.warn(
        `[dinotty] refusing oversized fit ${proposed.cols}x${proposed.rows}; wrapper may be unbounded`
      )
      return null
    }
    if (this._applyingGrid) {
      this._fitQueued = true
      return null
    }
    this._clearZeroSizeRetry()
    this._applyingGrid = true
    markOp(`term.fit ${this.xterm.cols}x${this.xterm.rows}`)
    try {
      this.fitAddon.fit()
    } catch {
      return null
    } finally {
      this._applyingGrid = false
      markOp(`term.fit.done ${this.xterm?.cols}x${this.xterm?.rows}`)
    }
    const cols = this.xterm.cols
    const rows = this.xterm.rows
    if (cols < 2 || rows < 2) return null
    const changed = cols !== this._lastCols || rows !== this._lastRows
    const heightChanged = rows !== this._lastRows
    this._lastCols = cols
    this._lastRows = rows
    if (heightChanged && !this.isMouseModeEnabled()) {
      markOp('term.scroll')
      this.xterm.scrollToBottom()
      markOp('term.scroll.done')
      this._writePinnedToBottom = true
    }
    if (this._fitQueued) {
      this._fitQueued = false
      this._refit()
    }
    return { cols, rows, changed }
  }

  /**
   * Single entry point for direct `xterm.resize` calls. Serializes re-entrant
   * requests and leaves hidden panes alone: resizing a display:none xterm (the
   * WebGL renderer in particular) is the suspected freeze trigger.
   */
  private _applyGrid(cols: number, rows: number, reason: string): boolean {
    if (!this.xterm) return false
    if (cols < 2 || rows < 2) return false
    if (cols > TerminalInstance.MAX_GRID_COLS || rows > TerminalInstance.MAX_GRID_ROWS) {
      console.warn(
        `[dinotty] refusing oversized terminal grid ${cols}x${rows} (${reason}); wrapper may be unbounded`
      )
      return false
    }
    if (!this._paneVisible()) return false
    if (this._applyingGrid) {
      this._queuedGrid = { cols, rows, reason }
      return false
    }
    this._applyingGrid = true
    let changed = false
    markOp(`term.resize ${cols}x${rows} ${reason}`)
    try {
      if (this.xterm.cols !== cols || this.xterm.rows !== rows) {
        this.xterm.resize(cols, rows)
        changed = true
      }
    } catch {
      changed = false
    } finally {
      this._applyingGrid = false
      markOp(`term.resize.done ${cols}x${rows} ${reason}`)
    }
    const queued = this._queuedGrid
    this._queuedGrid = null
    if (queued) this._applyGrid(queued.cols, queued.rows, queued.reason)
    return changed
  }

  /** Apply the owner's grid to a non-owner pane (letterbox / follow). */
  private _applyOwnerGrid(): TerminalFit | null {
    if (!this.xterm) return null
    if (this._knownPtyCols < 2 || this._knownPtyRows < 2) return null
    // Never resize a display:none pane. The hidden WebGL canvas is the
    // suspected freeze trigger; apply the grid when the pane becomes visible.
    if (!this._paneVisible()) return null
    const cols = this._knownPtyCols
    const rows = this._knownPtyRows
    const changed = cols !== this._lastCols || rows !== this._lastRows
    if (this.xterm.cols === cols && this.xterm.rows === rows) {
      this._lastCols = cols
      this._lastRows = rows
      return { cols, rows, changed }
    }
    const heightChanged = rows !== this._lastRows
    if (!this._applyGrid(cols, rows, 'owner')) return null
    this._lastCols = cols
    this._lastRows = rows
    if (heightChanged && !this.isMouseModeEnabled()) {
      this.xterm.scrollToBottom()
      this._writePinnedToBottom = true
    }
    return { cols, rows, changed }
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
        `[dinotty] terminal wrapper still 0×0 after ${this._zeroSizeRetries} retries (~${Math.round((this._zeroSizeRetries * TerminalInstance.ZERO_SIZE_RETRY_MS) / 1000)}s); giving up, will recover on next ResizeObserver event`
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
    if (this._followingPeer) return
    if (!this.fitAddon || !this.xterm || !this._wrapper) return
    // Skip fitting during a sync/replay transaction: the buffered Output
    // was encoded at the current xterm geometry, and a mid-transaction fit
    // would change geometry out from under it. sync_end / replay_end will
    // re-arm the settle-ladder so the wrapper's post-transaction size is
    // applied as soon as the transaction closes.
    if (this._transactionDepth > 0) return
    const hasOwnerGrid = this._knownPtyCols >= 2 && this._knownPtyRows >= 2
    const dims = this._isOwner
      ? this._fitLocal()
      : hasOwnerGrid
        ? this._applyOwnerGrid()
        : this._fitLocal()
    if (!dims) return
    // If we owe the server a snapshot_request (Reconnected arrived while the
    // wrapper was 0×0), fire it now that the wrapper has recovered. Idempotent
    // — bails if a request is already in flight. This must run even when the
    // geometry did not change: a recovered 0×0 wrapper often lands back on the
    // previous size, and the old early return here stranded the pane blank.
    if (this._snapshotPending) this._maybeSendSnapshotRequest()
    if (this._claimQueued) this._maybeSendClaim()
    // A non-owner only follows; it never resizes the PTY.
    if (!this._isOwner) return
    if (!force && !dims.changed) return
    // No frontend debounce: rAF coalesces frame-rate (in _refit), the
    // geometry guard above skips no-op frames, and the server's 25ms debounce
    // is the single wire-rate throttle. Stacking a frontend debounce on top
    // added latency without further compression.
    this._sendResize(dims.cols, dims.rows)
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

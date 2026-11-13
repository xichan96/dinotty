/**
 * Always-on hang diagnostics for the web shell.
 *
 * A freeze is only diagnosable from what was recorded *before* it, so the
 * recorder starts by itself on every load: a 400-event ring buffer, a tiny
 * "operation in progress" breadcrumb and a throttled localStorage mirror. The
 * mirror is what lets the log survive the browser killing a frozen tab. It is
 * deliberately cheap: no DOM, no console output and no socket listeners unless
 * the default socket wrapper is installed once.
 *
 * `?debug=0` (or Stop in the panel) turns it off until the hotkey /
 * `?debug=1` re-enables it. Press `Ctrl+Shift+Alt+D` to show or hide the
 * panel; touch devices (iPad) use Settings → Diagnostics. The panel can be
 * hidden without stopping the recording — that is the point: the interesting
 * part happens before the hang, not after it.
 *
 * If the previous page disappeared without a `pagehide` (the renderer was
 * killed while frozen), the panel opens automatically on the next load with
 * the recovered log instead of staying invisible.
 *
 * Imported for its side effects from `main.ts`, before any socket or terminal
 * is created.
 */

const EVENTS_KEY = 'dinotty_debug_events_v1'
const RECORDING_KEY = 'dinotty_debug_recording'
const PANEL_KEY = 'dinotty_debug_panel'
const OP_KEY = 'dinotty_debug_lastop_v1'
const SUMMARY_KEY = 'dinotty_debug_summary_v1'
const LEGACY_HUD_KEY = 'dinotty_debug_hud'
const NO_WEBGL_KEY = 'dinotty_no_webgl'
const MAX_EVENTS = 400
const HEARTBEAT_MS = 5000
// A 2s gap between 250ms ticks means the main thread stopped servicing timers;
// anything shorter is a slow frame, not a freeze.
const STALL_MS = 2000
const TICK_MS = 250
const PERSIST_MS = 400
const RESIZE_RECORD_MS = 250
const SESSION = 's' + Date.now().toString(36)

type EventData = Record<string, unknown>

interface DebugEvent {
  t: number
  s: string
  e: string
  d?: EventData
}

const events: DebugEvent[] = []
const sockets = new Set<WebSocket>()
const socketPaths = new WeakMap<WebSocket, string>()
const socketMsgCounts = new WeakMap<WebSocket, number>()
let totalMessages = 0
let lastMessageAt = 0
let lastHeartbeatLag = 0
let lastEventName = ''
let lastEventAt = 0
/** Set when the previous page's stored log has no clean shutdown marker. */
let recoveredFromCrash = false
let recoveredLastEvent = ''

// Operation breadcrumb. Callers mark what they are about to do; the ticker
// mirrors the current value to localStorage at most every TICK_MS, so a hard
// freeze still leaves "this is what was running" on disk.
let lastOp: { n: string; t: number } | null = null
// Sentinel so the first ticker pass writes the (empty) breadcrumb instead of
// treating a stale value from the previous session as already written.
let writtenOp = '\u0000'

let recording = false
let panelVisible = false
let eventsLoaded = false
let socketRecorderInstalled = false
let lifecycleRecorderInstalled = false
let heartbeatTimer = 0
let tickTimer = 0
let renderTimer = 0
let persistTimer = 0
let lastResizeRecordAt = 0
let lastTickAt = 0
let pageHiding = false
let panelHost: HTMLDivElement | null = null
let panelRender: (() => void) | null = null
let longTaskObserver: PerformanceObserver | null = null

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* private mode / quota */
  }
}

// WebGL is a separate persisted switch: it has to work whether or not the
// recorder is on, because useTerminal reads it during construction.
export function isWebglDisabled(): boolean {
  return safeGet(NO_WEBGL_KEY) === '1'
}

export function setWebglDisabled(disabled: boolean): void {
  safeSet(NO_WEBGL_KEY, disabled ? '1' : null)
}

function flagValue(source: string, name: string): string | null {
  const match = new RegExp('(?:^|[#&?])' + name + '(?:=([^&]*))?(?=$|[&])', 'i').exec(source)
  if (!match) return null
  if (match[1] === undefined) return '1'
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function debugModeFromLocation(): 'on' | 'off' | null {
  let query = ''
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has('debug')) query = params.get('debug') || '1'
  } catch {
    /* ignore malformed URL */
  }
  const value = query || flagValue(window.location.hash, 'debug')
  if (!value) return null
  if (value === '0' || value === 'off' || value === 'false') return 'off'
  return 'on'
}

function redactPath(path: string): string {
  return path.replace(/([?&](?:token|access_token|code)=)[^&]*/gi, '$1redacted')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function heapMb(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null
}

function loadEvents(): void {
  if (eventsLoaded) return
  eventsLoaded = true
  try {
    const raw = safeGet(EVENTS_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as DebugEvent).t === 'number' &&
        typeof (entry as DebugEvent).e === 'string'
      ) {
        events.push({
          t: (entry as DebugEvent).t,
          s: String((entry as DebugEvent).s ?? 'prev'),
          e: (entry as DebugEvent).e,
          d: (entry as DebugEvent).d,
        })
      }
    }
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  } catch {
    /* ignore malformed log */
  }
}

function persist(): void {
  if (persistTimer) {
    window.clearTimeout(persistTimer)
    persistTimer = 0
  }
  if (!recording) return
  try {
    safeSet(EVENTS_KEY, JSON.stringify(events.slice(-MAX_EVENTS)))
    safeSet(
      SUMMARY_KEY,
      JSON.stringify({
        at: Date.now(),
        session: SESSION,
        last: lastEventName,
        lastAt: lastEventAt,
        n: events.length,
        op: lastOp?.n ?? null,
        opAgeMs: lastOp ? Date.now() - lastOp.t : null,
        vis: document.visibilityState,
        crash: recoveredFromCrash,
      })
    )
  } catch {
    /* quota */
  }
}

function schedulePersist(): void {
  if (persistTimer) return
  persistTimer = window.setTimeout(() => {
    persistTimer = 0
    persist()
  }, PERSIST_MS)
}

function record(event: string, data?: EventData, flush = false): void {
  if (!recording) return
  events.push({
    t: Date.now(),
    s: SESSION,
    e: event,
    d: {
      ...(data ?? {}),
      vis: document.visibilityState,
      foc: document.hasFocus(),
      op: lastOp?.n ?? undefined,
    },
  })
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  lastEventName = event
  lastEventAt = Date.now()
  if (flush) persist()
  else schedulePersist()
  if (panelVisible) panelRender?.()
}

/** Mark the operation currently running. Mirrored to storage immediately. */
let persistedHotFamily: 'term.write' | 'term.scroll' | null = null

export function markOp(name: string | null): void {
  if (!recording) return
  if (name === null) {
    lastOp = null
    persistedHotFamily = null
    flushOpBreadcrumb()
    return
  }
  if (lastOp?.n === name) {
    lastOp.t = Date.now()
    return
  }
  lastOp = { n: name, t: Date.now() }
  const hotFamily = name.startsWith('term.write')
    ? 'term.write'
    : name.startsWith('term.scroll')
      ? 'term.scroll'
      : null
  if (hotFamily) {
    // The write/scroll path runs many times per second. Persist once when
    // entering the family; the 250ms ticker keeps the latest member on disk.
    // A hard freeze still finds a useful breadcrumb without a storage write
    // per 32 KiB chunk.
    if (persistedHotFamily !== hotFamily) {
      persistedHotFamily = hotFamily
      flushOpBreadcrumb()
    }
    return
  }
  persistedHotFamily = null
  // Written synchronously, before the operation starts: if the operation never
  // returns, this is the breadcrumb the next load (or a post-crash inspection)
  // reads. The write is a few dozen bytes, so per-transition cost is noise.
  flushOpBreadcrumb()
}

/** Append a one-off diagnostic event and flush it immediately. */
export function recordEvent(name: string, data?: EventData): void {
  record(name, data, true)
}

const throttledAt = new Map<string, number>()

/**
 * Deferred, per-name rate-limited event. For hot paths (resize/claim) where
 * `recordEvent`'s immediate full-buffer localStorage write would be too
 * expensive, but the event sequence still matters for a later freeze.
 */
export function recordThrottled(name: string, data?: EventData, minMs = 500): void {
  if (!recording) return
  const now = Date.now()
  if (now - (throttledAt.get(name) ?? 0) < minMs) return
  throttledAt.set(name, now)
  record(name, data)
}

function installSocketRecorder(): void {
  if (socketRecorderInstalled) return
  socketRecorderInstalled = true
  const RealWebSocket = window.WebSocket
  if (!RealWebSocket) return

  const Wrapped = function (
    this: unknown,
    url: string | URL,
    protocols?: string | string[]
  ): WebSocket {
    const socket =
      protocols === undefined ? new RealWebSocket(url) : new RealWebSocket(url, protocols)
    let path = redactPath(String(url))
    try {
      const parsed = new URL(String(url), window.location.href)
      path = redactPath(parsed.pathname + parsed.search)
    } catch {
      /* keep redacted raw */
    }
    if (recording) {
      sockets.add(socket)
      socketPaths.set(socket, path)
      socketMsgCounts.set(socket, 0)
    }

    socket.addEventListener('open', () => record('ws-open', { p: path }))
    socket.addEventListener('message', () => {
      if (!recording) return
      totalMessages += 1
      lastMessageAt = Date.now()
      socketMsgCounts.set(socket, (socketMsgCounts.get(socket) ?? 0) + 1)
    })
    socket.addEventListener('error', () => record('ws-error', { p: path }))
    socket.addEventListener('close', (event) => {
      sockets.delete(socket)
      record('ws-close', {
        p: path,
        code: event.code,
        clean: event.wasClean,
        msgs: socketMsgCounts.get(socket) ?? 0,
      })
    })
    return socket
  }

  Object.defineProperties(Wrapped, {
    prototype: { value: RealWebSocket.prototype },
    CONNECTING: { value: RealWebSocket.CONNECTING },
    OPEN: { value: RealWebSocket.OPEN },
    CLOSING: { value: RealWebSocket.CLOSING },
    CLOSED: { value: RealWebSocket.CLOSED },
  })
  window.WebSocket = Wrapped as unknown as typeof WebSocket
}

function installLifecycleRecorder(): void {
  if (lifecycleRecorderInstalled) return
  lifecycleRecorderInstalled = true

  document.addEventListener('visibilitychange', () => {
    // Browsers may report `hidden` around the unload sequence; skip it once
    // pagehide has started so `pagehide` stays the last stored event (the
    // clean-shutdown marker the next load looks for).
    if (pageHiding && document.visibilityState === 'hidden') return
    record('vis', { v: document.visibilityState }, true)
  })
  window.addEventListener('focus', () => record('focus'))
  window.addEventListener('blur', () => record('blur'))
  // Flushed synchronously: this is the marker that distinguishes a clean close
  // (or reload) from the renderer being killed after a freeze.
  window.addEventListener('pagehide', () => {
    pageHiding = true
    record('pagehide', undefined, true)
  })
  window.addEventListener('pageshow', (event) => {
    pageHiding = false
    record('pageshow', { persisted: (event as PageTransitionEvent).persisted })
  })
  // Resizing is the reported trigger, so keep its dimensions in the log. Rate
  // limited: a drag fires ~60 events/s and must not swamp the ring buffer.
  window.addEventListener('resize', () => {
    const now = Date.now()
    if (now - lastResizeRecordAt < RESIZE_RECORD_MS) return
    lastResizeRecordAt = now
    record(
      'resize',
      {
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      true
    )
  })
}

/** Mirror the in-flight operation, at most once per tick. */
function flushOpBreadcrumb(): void {
  if (!recording) return
  const next = lastOp ? lastOp.n + '@' + lastOp.t : ''
  if (next === writtenOp) return
  writtenOp = next
  safeSet(OP_KEY, JSON.stringify(lastOp))
}

function startMonitors(): void {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer)
  if (tickTimer) window.clearInterval(tickTimer)

  if (longTaskObserver) {
    longTaskObserver.disconnect()
    longTaskObserver = null
  }
  if ('PerformanceObserver' in window) {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 200) {
            record('longtask', {
              ms: Math.round(entry.duration),
              start: Math.round(entry.startTime),
            })
          }
        }
      })
      longTaskObserver.observe({ entryTypes: ['longtask'] })
    } catch {
      longTaskObserver = null
    }
  }

  // Stall detector. Timers are coalesced while the main thread is blocked, so
  // after a freeze this callback observes one tick whose gap equals the freeze
  // length. That is how a hang that recovered becomes a log entry.
  lastTickAt = performance.now()
  persistedHotFamily = null
  tickTimer = window.setInterval(() => {
    const now = performance.now()
    const gap = now - lastTickAt
    lastTickAt = now
    if (gap >= STALL_MS) {
      // OP_KEY still holds the operation the previous transition marked: this
      // is the best available answer for "what was running when it froze".
      let frozenOp: string | null = null
      try {
        frozenOp = (JSON.parse(safeGet(OP_KEY) || 'null') as { n?: string } | null)?.n ?? null
      } catch {
        /* ignore malformed breadcrumb */
      }
      record('stall', { ms: Math.round(gap), frozenOp }, true)
    }
    flushOpBreadcrumb()
  }, TICK_MS)

  let lastTick = performance.now()
  heartbeatTimer = window.setInterval(() => {
    const now = performance.now()
    lastHeartbeatLag = Math.max(0, Math.round(now - lastTick - HEARTBEAT_MS))
    lastTick = now
    record(
      'hb',
      {
        lag: lastHeartbeatLag,
        heap: heapMb(),
        ws: sockets.size,
        msgs: totalMessages,
        op: lastOp?.n ?? null,
      },
      true
    )
  }, HEARTBEAT_MS)
}

function stopMonitors(): void {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = 0
  }
  if (tickTimer) {
    window.clearInterval(tickTimer)
    tickTimer = 0
  }
  if (persistTimer) {
    window.clearTimeout(persistTimer)
    persistTimer = 0
  }
  longTaskObserver?.disconnect()
  longTaskObserver = null
  lastOp = null
  persistedHotFamily = null
  writtenOp = '\u0000'
  safeSet(OP_KEY, null)
}

function webglCanvasCount(): number {
  return document.querySelectorAll('.xterm canvas').length
}

export function loseAllWebglContexts(): number {
  const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[]
  let lost = 0
  for (const canvas of canvases) {
    for (const kind of ['webgl2', 'webgl'] as const) {
      const context = canvas.getContext(kind) as WebGLRenderingContext | null
      if (!context) continue
      context.getExtension('WEBGL_lose_context')?.loseContext()
      lost += 1
      break
    }
  }
  record('kill-webgl', { canvases: canvases.length, lost })
  return lost
}

export function exhaustWebglContexts(count = 32): void {
  const keep: HTMLCanvasElement[] = []
  for (let i = 0; i < count; i += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    keep.push(canvas)
  }
  ;(window as unknown as { __dnGlHogs?: HTMLCanvasElement[] }).__dnGlHogs = keep
  record('exhaust-webgl', { created: keep.length })
  window.setTimeout(() => {
    keep.length = 0
    ;(window as unknown as { __dnGlHogs?: HTMLCanvasElement[] }).__dnGlHogs = undefined
    record('exhaust-webgl-release')
  }, 10000)
}

export function dropAllSockets(): void {
  let dropped = 0
  for (const socket of Array.from(sockets)) {
    try {
      socket.close(4000, 'debug-drop')
      dropped += 1
    } catch {
      /* already closing */
    }
  }
  record('drop-ws', { dropped })
}

function formatTime(t: number): string {
  const d = new Date(t)
  return (
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0') +
    ':' +
    String(d.getSeconds()).padStart(2, '0') +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  )
}

function describe(event: DebugEvent): string {
  const data = event.d ?? {}
  const extra = Object.entries(data)
    .filter(([key]) => key !== 'vis' && key !== 'foc')
    .map(([key, value]) => key + '=' + String(value))
    .join(' ')
  return extra ? extra : ''
}

function copyEvents(): Promise<boolean> {
  const text = JSON.stringify(events, null, 1)
  return navigator.clipboard
    ? navigator.clipboard
        .writeText(text)
        .then(() => true)
        .catch(() => false)
    : Promise.resolve(false)
}

function buildPanel(): void {
  if (panelHost) return

  const host = document.createElement('div')
  host.id = 'dinotty-debug-hud'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed; left: 8px; bottom: 8px; z-index: 2147483647;
        width: min(460px, calc(100vw - 16px)); max-height: 55vh;
        display: flex; flex-direction: column;
        background: rgba(12, 16, 14, 0.94); color: #d7e2da;
        border: 1px solid #3a4a40; border-radius: 8px;
        font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        box-shadow: 0 8px 28px rgba(0,0,0,.45);
      }
      .bar {
        display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
        padding: 6px 8px; border-bottom: 1px solid #2c3a32;
      }
      .title { font-weight: 700; color: #9fe3b8; margin-right: auto; }
      button {
        font: inherit; color: #d7e2da; background: #223029;
        border: 1px solid #3a4a40; border-radius: 4px; padding: 2px 6px;
      }
      button:active { background: #33463c; }
      button:focus-visible { outline: 1px solid #9fe3b8; }
      .metrics { padding: 5px 8px; color: #a9bcae; border-bottom: 1px solid #2c3a32; }
      .log { overflow: auto; padding: 4px 8px 8px; white-space: pre; }
      .row { display: flex; gap: 6px; }
      .t { color: #6f8577; flex: none; }
      .prev { color: #6f8577; }
      .ev { color: #e6efe9; }
      .warn { color: #ffb86b; }
      .ws { color: #7fd1ff; }
      .vis { color: #c9a7ff; }
    </style>
    <div class="panel">
      <div class="bar">
        <span class="title" title="Ctrl+Shift+Alt+D shows or hides this panel">dinotty debug</span>
        <button data-act="killgl">Kill GL</button>
        <button data-act="dropws">Drop WS</button>
        <button data-act="togglewgl"></button>
        <button data-act="copy">Copy</button>
        <button data-act="clear">Clear</button>
        <button data-act="hide">Hide</button>
        <button data-act="stop">Stop</button>
      </div>
      <div class="metrics"></div>
      <div class="log"></div>
    </div>
  `
  const metrics = shadow.querySelector('.metrics') as HTMLDivElement
  const log = shadow.querySelector('.log') as HTMLDivElement
  const toggleButton = shadow.querySelector('[data-act="togglewgl"]') as HTMLButtonElement
  const copyButton = shadow.querySelector('[data-act="copy"]') as HTMLButtonElement

  const render = (): void => {
    if (!recording || !panelVisible) return
    const lastMessageAge =
      lastMessageAt > 0 ? ((Date.now() - lastMessageAt) / 1000).toFixed(1) + 's ago' : 'never'
    metrics.textContent =
      'vis=' +
      document.visibilityState +
      ' focus=' +
      document.hasFocus() +
      ' lag=' +
      String(lastHeartbeatLag) +
      'ms heap=' +
      (heapMb() ?? '-') +
      'MB ws=' +
      sockets.size +
      ' msgs=' +
      totalMessages +
      ' last=' +
      lastMessageAge +
      ' gl=' +
      webglCanvasCount() +
      ' xterm=' +
      document.querySelectorAll('.xterm').length +
      ' op=' +
      (lastOp?.n ?? '-') +
      (recoveredFromCrash ? ' PREV=abnormal(' + recoveredLastEvent + ')' : '')
    toggleButton.textContent = isWebglDisabled() ? 'WebGL: off' : 'WebGL: on'

    const rows: string[] = []
    const recent = events.slice(-40).reverse()
    for (const event of recent) {
      const sessionMark = event.s === SESSION ? ' ' : '·'
      const css =
        event.e === 'longtask' || event.e === 'ws-close' || event.e === 'ws-error'
          ? 'warn'
          : event.e.startsWith('ws-')
            ? 'ws'
            : event.e === 'vis' || event.e === 'focus' || event.e === 'blur'
              ? 'vis'
              : 'ev'
      rows.push(
        '<div class="row' +
          (event.s === SESSION ? '' : ' prev') +
          '"><span class="t">' +
          sessionMark +
          formatTime(event.t) +
          '</span><span class="' +
          css +
          '">' +
          escapeHtml(event.e) +
          ' ' +
          escapeHtml(describe(event)) +
          '</span></div>'
      )
    }
    log.innerHTML = rows.join('')
  }

  shadow.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('button') as HTMLButtonElement | null
    if (!target) return
    const act = target.dataset.act
    if (act === 'killgl') {
      loseAllWebglContexts()
    } else if (act === 'dropws') {
      dropAllSockets()
    } else if (act === 'togglewgl') {
      setWebglDisabled(!isWebglDisabled())
      window.location.reload()
    } else if (act === 'clear') {
      events.length = 0
      persist()
      record('cleared')
    } else if (act === 'copy') {
      void copyEvents().then((ok) => {
        copyButton.textContent = ok ? 'Copied' : 'Copy failed'
        window.setTimeout(() => {
          copyButton.textContent = 'Copy'
        }, 1500)
      })
    } else if (act === 'hide') {
      setPanelVisible(false)
    } else if (act === 'stop') {
      stopRecording()
    }
    render()
  })

  document.body.appendChild(host)
  panelHost = host
  panelRender = render
  renderTimer = window.setInterval(render, 500)
  render()
}

function setPanelVisible(visible: boolean): void {
  if (visible === panelVisible) return
  panelVisible = visible
  safeSet(PANEL_KEY, visible ? '1' : '0')
  if (visible) {
    buildPanel()
  } else {
    if (renderTimer) {
      window.clearInterval(renderTimer)
      renderTimer = 0
    }
    panelHost?.remove()
    panelHost = null
    panelRender = null
  }
}

export function startRecording(): void {
  if (recording) return
  recording = true
  safeSet(RECORDING_KEY, '1')
  loadEvents()
  installSocketRecorder()
  installLifecycleRecorder()
  startMonitors()
  record(
    'boot',
    {
      ua: navigator.userAgent,
      screen: window.screen.width + 'x' + window.screen.height,
      cores: navigator.hardwareConcurrency,
      webgl: !isWebglDisabled(),
    },
    true
  )
}

export function stopRecording(): void {
  if (!recording) {
    setPanelVisible(false)
    return
  }
  record('stopped', undefined, true)
  recording = false
  safeSet(RECORDING_KEY, '0')
  stopMonitors()
  setPanelVisible(false)
}

const CLEAN_ENDINGS = new Set(['pagehide', 'stopped', 'recovered', 'cleared'])

/** A backgrounded/hidden tab is not a freeze; accept it as a (soft) clean end. */
function isCleanEnding(last: DebugEvent): boolean {
  if (CLEAN_ENDINGS.has(last.e)) return true
  return last.e === 'vis' && (last.d as { v?: unknown } | undefined)?.v === 'hidden'
}

function detectAbnormalPreviousSession(): {
  last: DebugEvent
  ageMs: number
  op: string | null
} | null {
  loadEvents()
  const last = events[events.length - 1]
  if (!last || isCleanEnding(last)) return null
  const ageMs = Date.now() - last.t
  // Stale logs from another day are not a fresh crash; leave the panel hidden.
  if (ageMs < 0 || ageMs > 24 * 60 * 60 * 1000) return null
  let op: string | null = null
  try {
    const raw = safeGet(OP_KEY)
    if (raw) op = (JSON.parse(raw) as { n?: string } | null)?.n ?? null
  } catch {
    /* ignore malformed breadcrumb */
  }
  // Fallback: every event carries the in-flight op in `d.op`. If the OP_KEY
  // write was lost (or cleared), the last event still names the operation.
  if (!op) {
    const fallback = (last.d as { op?: unknown } | undefined)?.op
    if (typeof fallback === 'string') op = fallback
  }
  return { last, ageMs, op }
}

function syncFromLocation(): void {
  const mode = debugModeFromLocation()
  if (mode === 'on') {
    safeSet(LEGACY_HUD_KEY, null)
    startRecording()
    setPanelVisible(true)
    return
  }
  if (mode === 'off') {
    safeSet(LEGACY_HUD_KEY, null)
    safeSet(RECORDING_KEY, '0')
    safeSet(PANEL_KEY, null)
    stopRecording()
  }
}

function onDebugHotkey(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || !event.altKey) return
  if (event.code !== 'KeyD') return
  // Capture phase: keep the chord away from xterm's textarea so it does not
  // also reach the PTY.
  event.preventDefault()
  event.stopPropagation()
  if (!recording) startRecording()
  setPanelVisible(!panelVisible)
}

function installHotkey(): void {
  document.addEventListener('keydown', onDebugHotkey, true)
  window.addEventListener('hashchange', syncFromLocation)
}

function boot(): void {
  // One-time migration from the old `?debug=1` flag, which used to keep the
  // panel on screen forever. Keep the recorder running, but start hidden so
  // the UI is quiet until the hotkey asks for it.
  if (safeGet(LEGACY_HUD_KEY) === '1') {
    safeSet(LEGACY_HUD_KEY, null)
    safeSet(RECORDING_KEY, '1')
    safeSet(PANEL_KEY, '0')
  }

  const mode = debugModeFromLocation()
  if (mode === 'on') {
    safeSet(RECORDING_KEY, '1')
    safeSet(PANEL_KEY, '1')
  } else if (mode === 'off') {
    safeSet(RECORDING_KEY, '0')
    safeSet(PANEL_KEY, null)
  }

  installHotkey()

  // Recording is on by default: the interesting data is from *before* the
  // freeze, so waiting for an opt-in means the one hang worth debugging is the
  // one with no log. `?debug=0` / Stop opts out explicitly.
  const previous = detectAbnormalPreviousSession()
  if (safeGet(RECORDING_KEY) === '0') return

  startRecording()
  if (previous) {
    recoveredFromCrash = true
    recoveredLastEvent = previous.op ? `${previous.last.e}@${previous.op}` : previous.last.e
    record('recovered', { last: previous.last.e, ageMs: previous.ageMs, op: previous.op }, true)
    // The previous page never got to say goodbye (no `pagehide`): this is the
    // freeze that killed the renderer. Surface its log instead of hiding it.
    setPanelVisible(true)
    return
  }
  if (safeGet(PANEL_KEY) === '1') setPanelVisible(true)
}

/**
 * Touch-friendly entry point (Settings → Diagnostics). Starts the recorder if
 * needed and shows the panel; the panel's own Hide button hides it again.
 */
export function showDebugPanel(): void {
  if (!recording) startRecording()
  setPanelVisible(true)
}

/** Toolbar entry point: shows the panel, or hides it if it is already open. */
export function toggleDebugPanel(): void {
  if (panelVisible) {
    setPanelVisible(false)
    return
  }
  showDebugPanel()
}

// Small escape hatch for a support session: `dinottyDebug.copy()` in DevTools
// puts the persisted log on the clipboard even if the HUD is hidden.
const debugApi = {
  show: showDebugPanel,
  hide: () => setPanelVisible(false),
  enable: () => startRecording(),
  disable: () => stopRecording(),
  copy: copyEvents,
  clear: () => {
    events.length = 0
    persist()
  },
  dump: () => events.slice(),
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { dinottyDebug?: typeof debugApi }).dinottyDebug = debugApi
  if (document.body) boot()
  else window.addEventListener('DOMContentLoaded', boot, { once: true })
}

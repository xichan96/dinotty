import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

export interface ConsoleEntry {
  id: number
  level: 'log' | 'warn' | 'info' | 'debug' | 'error' | 'clear'
  args: string[]
  ts: number
}

export interface NetworkEntry {
  id: number
  method: string
  url: string
  status: number
  duration: number
  error?: boolean
  ts: number
}

const MAX_ENTRIES = 500
// A busy preview page can push network/console messages at kilohertz (polling
// loops, retries, HMR). Applying each message synchronously rebuilt the
// reactive lists, sliced the 500-entry cap per push, and forced a layout per
// entry in DevToolsPanel - which starves the main thread and is worst on a
// phone with the keyboard open. Coalesce a burst into one update per window.
const BATCH_INTERVAL_MS = 100

function originOf(url: string): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function useDevTools() {
  const consoleEntries = ref<ConsoleEntry[]>([])
  const networkEntries = ref<NetworkEntry[]>([])
  let nextId = 1

  const allowedOrigins = new Set<string>([window.location.origin])

  function allowOrigin(url: string) {
    const o = originOf(url)
    if (o) allowedOrigins.add(o)
  }

  function isAllowedOrigin(origin: string): boolean {
    return allowedOrigins.has(origin)
  }

  const errorCount = computed(() => consoleEntries.value.filter((e) => e.level === 'error').length)

  // Buffered entries, flushed on a fixed cadence. `clear` is applied eagerly so
  // a clear sent mid-burst is never resurrected by entries queued before it.
  let pendingConsole: ConsoleEntry[] = []
  let pendingNetwork: NetworkEntry[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function trim<T>(entries: T[]): void {
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  }

  // Keep the queue itself bounded too: a page can emit messages faster than one
  // flush window, and the cap only keeps the most recent entries anyway.
  function enqueueConsole(entry: ConsoleEntry) {
    pendingConsole.push(entry)
    trim(pendingConsole)
    scheduleFlush()
  }

  function enqueueNetwork(entry: NetworkEntry) {
    pendingNetwork.push(entry)
    trim(pendingNetwork)
    scheduleFlush()
  }

  function flushPending() {
    flushTimer = null
    if (pendingConsole.length > 0) {
      consoleEntries.value.push(...pendingConsole)
      trim(consoleEntries.value)
      pendingConsole = []
    }
    if (pendingNetwork.length > 0) {
      networkEntries.value.push(...pendingNetwork)
      trim(networkEntries.value)
      pendingNetwork = []
    }
  }

  function scheduleFlush() {
    if (flushTimer !== null) return
    flushTimer = setTimeout(flushPending, BATCH_INTERVAL_MS)
  }

  function onMessage(e: MessageEvent) {
    if (!isAllowedOrigin(e.origin)) return
    const data = e.data
    if (!data) return

    if (data.type === 'preview-console') {
      if (data.level === 'clear') {
        pendingConsole = []
        consoleEntries.value = []
      } else {
        enqueueConsole({
          id: nextId++,
          level: data.level,
          args: data.args || [],
          ts: data.ts || Date.now(),
        })
      }
    } else if (data.type === 'preview-network') {
      enqueueNetwork({
        id: nextId++,
        method: data.method || 'GET',
        url: data.url || '',
        status: data.status || 0,
        duration: data.duration || 0,
        error: data.error,
        ts: data.ts || Date.now(),
      })
    } else if (data.type === 'preview-error') {
      const parts: string[] = []
      if (data.message) parts.push(data.message)
      if (data.stack) parts.push(data.stack)
      if (data.source) {
        const loc = data.line ? `${data.source}:${data.line}` : data.source
        parts.unshift(`[${loc}]`)
      }
      enqueueConsole({
        id: nextId++,
        level: 'error',
        args: parts.length ? parts : ['Unknown error'],
        ts: Date.now(),
      })
    }
  }

  onMounted(() => window.addEventListener('message', onMessage))
  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage)
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  })

  function clearConsole() {
    pendingConsole = []
    consoleEntries.value = []
  }

  function clearNetwork() {
    pendingNetwork = []
    networkEntries.value = []
  }

  return {
    consoleEntries,
    networkEntries,
    errorCount,
    clearConsole,
    clearNetwork,
    allowOrigin,
    isAllowedOrigin,
  }
}

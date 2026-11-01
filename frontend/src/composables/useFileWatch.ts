import { shallowRef, type Ref } from 'vue'
import { getApiBase, wsUrl } from './apiBase'

export interface FileWatchOptions {
  paneId: () => string
  cwdLabel: Ref<string>
  expanded: Ref<Set<string>>
  childCache: Ref<Record<string, any[]>>
  fetchList: (rel: string) => Promise<any[]>
  /** A file was created or changed; `rel` is workspace-relative. */
  onFileChanged: (rel: string) => void
  /** A file or directory was removed; `rel` is workspace-relative. */
  onFileDeleted: (rel: string) => void
  /** Watch is unavailable for this pane (e.g. SSH backends). */
  canWatch?: () => boolean
  /** A local socket reconnected (not the first open). */
  onReconnected?: () => void
}

export interface FileWatch {
  connectTreeWatchSocket: () => Promise<void>
  disconnectTreeWatchSocket: () => void
}

export function useFileWatch(opts: FileWatchOptions): FileWatch {
  // shallowRef keeps the raw WebSocket (a deep ref would proxy it and break
  // identity checks in the onclose handler).
  const socket = shallowRef<WebSocket | null>(null)
  let pendingDirs = new Set<string>()
  let batchTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000
  let intentionalClose = false
  // The backend reported an error on this stream; reconnecting would just hit
  // the same error (unknown pane, unavailable cwd, path missing, ...).
  let serverError = false
  // Distinguishes the first successful open from a reconnect.
  let hasOpened = false

  function absToRel(absPath: string): string | null {
    const cwd = (opts.cwdLabel.value || '').replace(/\\/g, '/')
    const cwdNorm = cwd.endsWith('/') ? cwd : cwd + '/'
    const norm = absPath.replace(/\\/g, '/')
    if (norm.startsWith(cwdNorm)) {
      let rel = norm.slice(cwdNorm.length)
      if (rel.endsWith('/')) rel = rel.slice(0, -1)
      return rel
    }
    return null
  }

  function parentRelPath(rel: string): string {
    const i = rel.lastIndexOf('/')
    return i === -1 ? '' : rel.slice(0, i)
  }

  function clearCacheForPath(rel: string) {
    const next = { ...opts.childCache.value }
    delete next[rel]
    for (const key of Object.keys(next)) {
      if (key.startsWith(rel + '/')) delete next[key]
    }
    opts.childCache.value = next
    opts.expanded.value = new Set(
      [...opts.expanded.value].filter((p) => p !== rel && !p.startsWith(rel + '/'))
    )
  }

  function isDirExpanded(dir: string): boolean {
    return dir === '' || opts.expanded.value.has(dir)
  }

  function handleWatchEvent(event: { type: string; path?: string; kind?: string }) {
    const changedPath = (event.path || '').replace(/\\/g, '/')
    if (!changedPath) return

    const rel = absToRel(changedPath)
    if (rel === null) return
    const parentDir = parentRelPath(rel)
    const kind = event.kind || 'changed'

    if (kind === 'deleted') {
      opts.onFileDeleted(rel)
      clearCacheForPath(rel)
    } else {
      opts.onFileChanged(rel)
    }

    if (kind === 'created' || kind === 'deleted') {
      if (!isDirExpanded(parentDir)) {
        const next = { ...opts.childCache.value }
        delete next[parentDir]
        opts.childCache.value = next
      }
    }

    pendingDirs.add(parentDir)

    if (!batchTimer) {
      batchTimer = setTimeout(() => {
        const dirs = [...pendingDirs]
        pendingDirs.clear()
        batchTimer = null
        for (const dir of dirs) {
          if (isDirExpanded(dir)) {
            void refreshTreeDir(dir)
          }
        }
      }, 300)
    }
  }

  async function refreshTreeDir(dir: string) {
    try {
      const entries = await opts.fetchList(dir)
      opts.childCache.value = { ...opts.childCache.value, [dir]: entries }
    } catch {}
  }

  function disconnectTreeWatchSocket() {
    intentionalClose = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (socket.value) {
      socket.value.close()
      socket.value = null
    }
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
      pendingDirs.clear()
    }
  }

  function scheduleReconnect() {
    if (intentionalClose || serverError) return
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void doConnect()
    }, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  }

  async function doConnect() {
    // `wsUrl()` is synchronous and reads the cached Tauri origin, so it must be
    // primed first — this function is already async, so that costs nothing.
    await getApiBase()
    const url = wsUrl(`/ws/watch?pane_id=${opts.paneId()}&path=${encodeURIComponent('.')}`)

    try {
      const ws = new WebSocket(url)
      socket.value = ws

      ws.onopen = () => {
        reconnectDelay = 1000
        serverError = false
        if (hasOpened) opts.onReconnected?.()
        hasOpened = true
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'file_event') {
            handleWatchEvent(data)
          } else if (data.type === 'error') {
            serverError = true
            console.warn('[file-watch] server error, reconnects disabled:', data.message)
          }
        } catch {}
      }

      ws.onclose = () => {
        const isCurrent = socket.value === ws
        if (isCurrent) socket.value = null
        // A newer connection replaced this one — its close already owns the
        // reconnect decision.
        if (!isCurrent) return
        scheduleReconnect()
      }
      ws.onerror = () => {}
    } catch {}
  }

  async function connectTreeWatchSocket() {
    // SSH/remote backends have no local watcher to subscribe to.
    if (opts.canWatch && !opts.canWatch()) return
    intentionalClose = false
    serverError = false
    hasOpened = false
    reconnectDelay = 1000
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (socket.value) {
      socket.value.close()
      socket.value = null
    }
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
      pendingDirs.clear()
    }
    await doConnect()
  }

  return { connectTreeWatchSocket, disconnectTreeWatchSocket }
}

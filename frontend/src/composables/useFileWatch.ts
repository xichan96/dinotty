import { ref, type Ref } from 'vue'
import { getApiBase, apiUrl, authFetch, wsUrlWithToken } from './apiBase'

export interface FileWatchOptions {
  paneId: () => string
  cwdLabel: Ref<string>
  expanded: Ref<Set<string>>
  childCache: Ref<Record<string, any[]>>
  selectedRel: Readonly<Ref<string | null>>
  selectedIsDir: Readonly<Ref<boolean>>
  meta: Ref<any>
  editorDirty: () => boolean
  onFileDeleted: () => void
  onFileChanged: (newMeta: any) => void
  onBinaryChanged: () => void
  fetchList: (rel: string) => Promise<any[]>
}

export interface FileWatch {
  connectTreeWatchSocket: () => Promise<void>
  disconnectTreeWatchSocket: () => void
}

export function useFileWatch(opts: FileWatchOptions): FileWatch {
  const socket = ref<WebSocket | null>(null)
  let pendingDirs = new Set<string>()
  let batchTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000
  let intentionalClose = false

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

    if (opts.selectedRel.value && !opts.selectedIsDir.value && rel === opts.selectedRel.value) {
      if (kind === 'deleted') {
        opts.onFileDeleted()
      } else if (!opts.editorDirty()) {
        void refreshCurrentFile()
      }
    }

    if (kind === 'deleted') {
      clearCacheForPath(rel)
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

  async function refreshCurrentFile() {
    if (!opts.selectedRel.value || opts.selectedIsDir.value) return
    try {
      await getApiBase()
      const q = new URLSearchParams({ pane_id: opts.paneId(), path: opts.selectedRel.value })
      const res = await authFetch(apiUrl(`/api/workspace/meta?${q}`))
      if (!res.ok) return
      const newMeta = await res.json()
      if (newMeta?.kind === 'text' || newMeta?.kind === 'markdown') {
        opts.onFileChanged(newMeta)
      } else {
        opts.onBinaryChanged()
      }
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
    if (intentionalClose) return
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void doConnect()
    }, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  }

  async function doConnect() {
    const base = await getApiBase()
    const apiBase = base || window.location.origin
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBase = apiBase.replace(/^https?:\/\//, `${wsProtocol}//`)
    const wsUrl = `${wsBase}/ws/watch?pane_id=${opts.paneId()}&path=${encodeURIComponent('.')}`

    try {
      const ws = new WebSocket(wsUrlWithToken(wsUrl))
      socket.value = ws

      ws.onopen = () => {
        reconnectDelay = 1000
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'file_event') {
            handleWatchEvent(data)
          }
        } catch {}
      }

      ws.onclose = () => {
        socket.value = null
        scheduleReconnect()
      }
      ws.onerror = () => {
        socket.value = null
      }
    } catch {}
  }

  async function connectTreeWatchSocket() {
    intentionalClose = false
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

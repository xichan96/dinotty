import { getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import {
  asWorkspaceError,
  workspaceErrorFromResponse,
  type WorkspaceError,
} from './useFileWorkspaceBoot'
import type { WorkspaceChangesResponse } from '../types/workspaceChanges'

/** Panel-level outcome of the last load. `ready` may still carry `error`. */
export type WorkspaceChangesState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'notRepo'
  | 'unsupported'
  | 'error'

export interface UseWorkspaceChangesOptions {
  paneId: () => string
  /** Changes are only fetched while the changes view is showing. */
  isActive: () => boolean
}

const POLL_MS = 10_000
const DEBOUNCE_MS = 450

/**
 * `/api/workspace/git-changes` client for one files pane.
 *
 * Requests never overlap: callers share the in-flight promise and a refresh
 * scheduled from several sources (watcher, focus, poll, manual) coalesces on a
 * 450ms debounce. A failed load keeps the last good list so a transient git
 * error does not blank the panel.
 */
export function useWorkspaceChanges(opts: UseWorkspaceChangesOptions) {
  const state = ref<WorkspaceChangesState>('idle')
  const data = ref<WorkspaceChangesResponse | null>(null)
  const error = ref<WorkspaceError | null>(null)
  const loading = ref(false)

  let inFlight: Promise<void> | null = null
  let controller: AbortController | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let generation = 0

  function cancelPending(): void {
    generation += 1
    controller?.abort()
    controller = null
    inFlight = null
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  /** Drop all state; the next `load` fetches for the current pane. */
  function reset(): void {
    cancelPending()
    loading.value = false
    state.value = 'idle'
    data.value = null
    error.value = null
  }

  async function load(): Promise<void> {
    const paneId = opts.paneId()
    if (!paneId) return
    if (inFlight) return inFlight

    const gen = generation
    controller = new AbortController()
    const signal = controller.signal
    loading.value = true
    if (!data.value) state.value = 'loading'

    const request = (async () => {
      try {
        await getApiBase()
        const q = new URLSearchParams({ pane_id: paneId })
        const res = await authFetch(apiUrl(`/api/workspace/git-changes?${q}`), { signal })
        if (gen !== generation) return
        if (res.status === 404) {
          data.value = null
          error.value = null
          state.value = 'unsupported'
          return
        }
        if (!res.ok) throw await workspaceErrorFromResponse(res)
        const body = (await res.json()) as WorkspaceChangesResponse
        if (gen !== generation) return
        error.value = null
        if (!body.is_git_repo) {
          data.value = null
          state.value = 'notRepo'
          return
        }
        data.value = body
        state.value = 'ready'
      } catch (e) {
        if (gen !== generation) return
        if ((e as { name?: string } | null)?.name === 'AbortError') return
        error.value = asWorkspaceError(e)
        // Keep the last good list: show the stale rows with an error bar
        // instead of replacing them with a full-page failure.
        state.value = data.value ? 'ready' : 'error'
      } finally {
        if (gen === generation) {
          loading.value = false
          inFlight = null
          controller = null
        }
      }
    })()

    inFlight = request
    return request
  }

  /** Debounced refresh used by watchers and focus changes. */
  function scheduleRefresh(delay = DEBOUNCE_MS): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (opts.isActive()) void load()
    }, delay)
  }

  /** Load on first activation, but keep an already-loaded list untouched. */
  function ensureLoaded(): void {
    if (state.value === 'idle') void load()
    else if (state.value === 'error' && !data.value) void load()
  }

  function shouldPoll(): boolean {
    return (
      opts.isActive() && typeof document !== 'undefined' && document.visibilityState === 'visible'
    )
  }

  function onVisibilityOrFocus(): void {
    if (shouldPoll()) scheduleRefresh(0)
  }

  function startPolling(): void {
    stopPolling()
    pollTimer = setInterval(() => {
      if (shouldPoll()) void load()
    }, POLL_MS)
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  if (getCurrentInstance()) {
    onMounted(() => {
      startPolling()
      window.addEventListener('focus', onVisibilityOrFocus)
      document.addEventListener('visibilitychange', onVisibilityOrFocus)
    })
    onBeforeUnmount(() => {
      stopPolling()
      window.removeEventListener('focus', onVisibilityOrFocus)
      document.removeEventListener('visibilitychange', onVisibilityOrFocus)
      cancelPending()
    })
  }

  return {
    state,
    data,
    error,
    loading,
    load,
    reset,
    ensureLoaded,
    scheduleRefresh,
    startPolling,
    stopPolling,
  }
}

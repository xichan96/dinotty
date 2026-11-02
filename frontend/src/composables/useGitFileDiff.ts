import { getCurrentInstance, onBeforeUnmount, ref, type Ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import type { DiffTarget, WorkspaceGitFileDiffResponse } from '../types/workspaceChanges'
import { buildDiffQuery } from '../utils/gitDiffHunks'

export interface UseGitFileDiffOptions {
  paneId: () => string
  target: () => DiffTarget | null
}

export interface UseGitFileDiff {
  data: Ref<WorkspaceGitFileDiffResponse | null>
  loading: Ref<boolean>
  /** Empty on success; 'request' for a non-2xx response, 'network' otherwise. */
  error: Ref<string>
  load: () => Promise<void>
  cancel: () => void
}

/**
 * Fetch one file's full diff, aborting any request that a newer load has made
 * stale. Old data is deliberately kept while a refresh is in flight so the
 * editor does not flash empty; the component only re-applies content that
 * actually changed.
 */
export function useGitFileDiff(options: UseGitFileDiffOptions): UseGitFileDiff {
  const data = ref<WorkspaceGitFileDiffResponse | null>(null)
  const loading = ref(false)
  const error = ref('')

  let controller: AbortController | null = null
  let requestId = 0

  function cancel(): void {
    requestId += 1
    controller?.abort()
    controller = null
    loading.value = false
  }

  async function load(): Promise<void> {
    const target = options.target()
    if (!target) {
      cancel()
      data.value = null
      error.value = ''
      return
    }

    const id = ++requestId
    controller?.abort()
    const ctrl = new AbortController()
    controller = ctrl
    loading.value = true
    error.value = ''

    try {
      await getApiBase()
      if (id !== requestId) return
      const query = buildDiffQuery(options.paneId(), target)
      const res = await authFetch(apiUrl(`/api/workspace/git-file-diff?${query}`), {
        signal: ctrl.signal,
      })
      if (id !== requestId) return
      if (!res.ok) {
        error.value = 'request'
        return
      }
      const next = (await res.json()) as WorkspaceGitFileDiffResponse
      if (id !== requestId) return
      data.value = next
    } catch {
      if (id !== requestId || ctrl.signal.aborted) return
      error.value = 'network'
    } finally {
      if (id === requestId) {
        loading.value = false
        controller = null
      }
    }
  }

  // Components get cleanup for free; standalone callers (tests) call `cancel`.
  if (getCurrentInstance()) onBeforeUnmount(cancel)

  return { data, loading, error, load, cancel }
}

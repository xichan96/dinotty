import { computed, ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'

export interface WorkspaceSearchMatch {
  file_path: string
  line: number
  column: number
  line_text: string
}

export interface WorkspaceSearchFile {
  path: string
  name: string
  dir: string
  /** Total hits in this file (a line may contain more than one). */
  count: number
  /** One representative match per line, in file order. */
  matches: WorkspaceSearchMatch[]
}

export type WorkspaceSearchError =
  | 'rgMissing'
  | 'invalidRegex'
  | 'sshUnsupported'
  | 'timeout'
  | 'network'
  | 'unknown'

const MAX_RESULTS = 500

export function useWorkspaceSearch(opts: {
  paneId: () => string
  isSsh: () => boolean
}) {
  const query = ref('')
  const caseSensitive = ref(false)
  const word = ref(false)
  const regex = ref(false)
  const loading = ref(false)
  const error = ref<WorkspaceSearchError | null>(null)
  const files = ref<WorkspaceSearchFile[]>([])
  const totalMatches = ref(0)
  const truncated = ref(false)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let requestToken = 0

  const hasResults = computed(() => files.value.length > 0)
  const isActive = computed(() => query.value.trim().length > 0)

  function fail(kind: WorkspaceSearchError): void {
    error.value = kind
    files.value = []
    totalMatches.value = 0
    truncated.value = false
  }

  function groupMatches(matches: WorkspaceSearchMatch[]): WorkspaceSearchFile[] {
    const byPath = new Map<string, WorkspaceSearchFile>()
    const seenLines = new Map<string, Set<number>>()
    for (const match of matches) {
      let file = byPath.get(match.file_path)
      if (!file) {
        const parts = match.file_path.split('/')
        file = {
          path: match.file_path,
          name: parts.pop() || match.file_path,
          dir: parts.join('/'),
          count: 0,
          matches: [],
        }
        byPath.set(match.file_path, file)
        seenLines.set(match.file_path, new Set())
      }
      file.count++
      // Multiple hits on one line collapse to a single result row; the count
      // still reflects every occurrence.
      const seen = seenLines.get(match.file_path)!
      if (!seen.has(match.line)) {
        seen.add(match.line)
        file.matches.push(match)
      }
    }
    return [...byPath.values()]
  }

  async function search(): Promise<void> {
    const token = ++requestToken
    const text = query.value.trim()
    if (!text) {
      loading.value = false
      error.value = null
      files.value = []
      totalMatches.value = 0
      truncated.value = false
      return
    }
    if (opts.isSsh()) {
      loading.value = false
      fail('sshUnsupported')
      return
    }

    loading.value = true
    error.value = null
    try {
      await getApiBase()
      const res = await authFetch(apiUrl('/api/workspace/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pane_id: opts.paneId(),
          path: '.',
          query: text,
          regex: regex.value,
          word: word.value,
          case_sensitive: caseSensitive.value,
          max_results: MAX_RESULTS,
        }),
      })
      if (token !== requestToken) return
      if (res.status === 502) {
        fail('rgMissing')
        return
      }
      if (res.status === 400) {
        fail(regex.value ? 'invalidRegex' : 'unknown')
        return
      }
      if (res.status === 504) {
        fail('timeout')
        return
      }
      if (!res.ok) {
        fail('unknown')
        return
      }
      const data = (await res.json()) as {
        matches?: WorkspaceSearchMatch[]
        truncated?: boolean
      }
      if (token !== requestToken) return
      error.value = null
      const matches = data.matches ?? []
      files.value = groupMatches(matches)
      totalMatches.value = matches.length
      truncated.value = !!data.truncated
    } catch {
      if (token !== requestToken) return
      fail('network')
    } finally {
      if (token === requestToken) loading.value = false
    }
  }

  function scheduleSearch(delay = 180): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void search()
    }, delay)
  }

  function cancelPending(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  function clear(): void {
    cancelPending()
    requestToken++
    query.value = ''
    files.value = []
    totalMatches.value = 0
    truncated.value = false
    error.value = null
    loading.value = false
  }

  return {
    query,
    caseSensitive,
    word,
    regex,
    loading,
    error,
    files,
    totalMatches,
    truncated,
    hasResults,
    isActive,
    search,
    scheduleSearch,
    cancelPending,
    clear,
  }
}

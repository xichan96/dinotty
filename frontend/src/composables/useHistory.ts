import { ref } from 'vue'
import { apiUrl, authFetch } from './apiBase'
import { onSuggestions } from './useSyncWebSocket'

declare function tauriInvoke(cmd: string): Promise<unknown>

export interface SuggestionItem {
  command: string
  frequency: number
}

const suggestions = ref<SuggestionItem[]>([])
let fetchTimer: ReturnType<typeof setTimeout> | null = null

onSuggestions((items) => {
  suggestions.value = items
})

export function useHistory() {
  async function fetchSuggestions(prefix?: string, limit = 20): Promise<SuggestionItem[]> {
    const params = new URLSearchParams()
    if (prefix) params.set('prefix', prefix)
    params.set('limit', String(limit))

    try {
      const res = await authFetch(apiUrl(`/api/history?${params}`))
      if (res.ok) {
        suggestions.value = await res.json()
      }
    } catch {
      // ignore
    }
    return suggestions.value
  }

  function fetchDebounced(prefix?: string) {
    if (fetchTimer) clearTimeout(fetchTimer)
    fetchTimer = setTimeout(() => fetchSuggestions(prefix), 150)
  }

  async function deleteSuggestion(command: string) {
    try {
      await authFetch(apiUrl('/api/history'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      suggestions.value = suggestions.value.filter((s) => s.command !== command)
    } catch {
      // ignore
    }
  }

  return { suggestions, fetchSuggestions, fetchDebounced, deleteSuggestion }
}

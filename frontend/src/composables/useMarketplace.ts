import { ref } from 'vue'
import { authFetch, apiUrl, getApiBase } from './apiBase'
import { describeHttpError, describeRequestError } from '../utils/httpError'

export interface MarketPlugin {
  id: string
  name: string
  description: string
  description_zh?: string
  version: string
  icon?: string
  repo: string
  branch: string
  subdir?: string
  author?: string
  homepage?: string
  installed_version?: string
  has_update: boolean
}

export function useMarketplace() {
  const plugins = ref<MarketPlugin[]>([])
  const loading = ref(false)
  const error = ref('')
  const installing = ref<Set<string>>(new Set())

  function markInstalling(id: string) {
    installing.value = new Set([...installing.value, id])
  }
  function unmarkInstalling(id: string) {
    const next = new Set(installing.value)
    next.delete(id)
    installing.value = next
  }

  async function fetchMarket() {
    loading.value = true
    error.value = ''
    try {
      await getApiBase()
      const url = apiUrl('/api/plugins/market')
      let res: Response | null = null
      let lastErr = ''
      const delays = [0, 1000, 2000, 4000]
      for (let i = 0; i < delays.length; i++) {
        if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]))
        try {
          res = await authFetch(url)
          if (res.ok) break
          lastErr = `HTTP ${res.status}`
          if (res.status < 500) break // don't retry client errors
        } catch (e: any) {
          lastErr = e.message || 'network error'
        }
        res = null
      }
      if (!res || !res.ok) throw new Error(lastErr || 'fetch failed')
      plugins.value = await res.json()
    } catch (e: any) {
      error.value = e.message || 'fetch failed'
    } finally {
      loading.value = false
    }
  }

  async function fetchReadme(id: string): Promise<string | null> {
    try {
      await getApiBase()
      const res = await authFetch(apiUrl(`/api/plugins/market/${encodeURIComponent(id)}/readme`))
      if (!res.ok) return null
      return await res.text()
    } catch {
      return null
    }
  }

  async function installFromMarket(
    plugin: MarketPlugin,
    approveNative = false
  ): Promise<{ ok: boolean; error?: string; permissions?: string[] }> {
    markInstalling(plugin.id)
    try {
      await getApiBase()
      const res = await authFetch(apiUrl('/api/plugins/install-git'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: plugin.repo,
          branch: plugin.branch,
          subdir: plugin.subdir,
          approve_native: approveNative,
        }),
      })
      if (res.ok) return { ok: true }
      if (res.status === 428) {
        const body = await res.json().catch(() => null)
        if (Array.isArray(body?.permissions)) {
          return { ok: false, permissions: body.permissions }
        }
      }
      return { ok: false, error: await describeHttpError(res, 'Install failed') }
    } catch (error) {
      return { ok: false, error: describeRequestError(error, 'Install failed') }
    } finally {
      unmarkInstalling(plugin.id)
    }
  }

  return { plugins, loading, error, installing, fetchMarket, fetchReadme, installFromMarket }
}

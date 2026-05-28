import { isTauri, tauriInvoke } from './useTransport'

const STORAGE_KEY = 'dinotty_auth_token'

let cached = ''
let inflight: Promise<string> | null = null

export function getAuthToken(): string {
  // localStorage takes priority (persists across "Add to Home Screen" opens)
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return stored

  // Fallback to meta tag (set when accessing via ?token=xxx)
  return document.querySelector('meta[name="auth-token"]')?.getAttribute('content') || ''
}

export function setAuthToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
  // Also update the meta tag so other code paths pick it up immediately
  let meta = document.querySelector('meta[name="auth-token"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'auth-token')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', token)
}

export function clearAuthToken(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function hasAuthToken(): boolean {
  return !!(localStorage.getItem(STORAGE_KEY) ||
    document.querySelector('meta[name="auth-token"]')?.getAttribute('content'))
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    await getApiBase()
    const res = await fetch(apiUrl('/api/settings'), {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

export async function getApiBase(): Promise<string> {
  if (!isTauri()) {
    cached = ''
    return ''
  }
  if (cached) return cached
  if (!inflight) {
    inflight = tauriInvoke('embedded_http_origin')
      .then((o) => {
        const s = String(o).replace(/\/$/, '')
        cached = s
        return s
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return cached ? `${cached}${p}` : p
}

export function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...init, headers })
}

export function wsUrlWithToken(url: string): string {
  const token = getAuthToken()
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}

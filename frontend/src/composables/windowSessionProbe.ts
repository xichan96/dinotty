import {
  apiUrl,
  authFetch,
  checkTokenConfigured,
  fetchAutoToken,
  getApiBase,
  markCookieAuthenticated,
  validateToken,
} from './apiBase'

/**
 * True when an auxiliary desktop window (detached terminal, preview window)
 * may talk to the active server.
 *
 * Probe with the same authenticated endpoint the main window uses, then fall
 * back to the desktop loopback auto-token (the cookie-less Tauri path). These
 * windows are only opened by the desktop app, so there is no setup or login UI
 * here — failure is terminal.
 */
export async function probeWindowSession(): Promise<boolean> {
  await getApiBase()
  try {
    const res = await authFetch(apiUrl('/api/settings'))
    if (res.ok) {
      markCookieAuthenticated()
      return true
    }
  } catch {
    // Unreachable server; try the desktop loopback auto-token before giving up.
  }

  const { configured, serverMode } = await checkTokenConfigured()
  if (!configured || serverMode) return false
  const autoToken = await fetchAutoToken()
  if (!autoToken) return false
  const result = await validateToken(autoToken)
  if (!result.ok) return false
  markCookieAuthenticated()
  return true
}

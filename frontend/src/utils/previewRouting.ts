export function isWebPreviewInput(val: string): boolean {
  const s = val.trim()
  if (!s) return false
  if (/^https?:\/\//i.test(s)) return true
  if (/^\/\//.test(s)) return true
  if (/^:?\d+(\/.*)?$/.test(s)) return true
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return true
  if (/^127\.0\.0\.1(:\d+)?(\/.*)?$/i.test(s)) return true
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return true
  if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}([/:?#].*)?$/.test(s)) return true
  return false
}

export function normalizeWebUrl(val: string): string {
  const v = val.trim()
  if (/^\/\//.test(v)) return `https:${v}`
  if (/^https?:\/\//i.test(v)) return v
  const portSh = v.match(/^:?(\d+)(\/.*)?$/)
  if (portSh) {
    const path = portSh[2] || '/'
    return `http://localhost:${portSh[1]}${path.startsWith('/') ? path : `/${path}`}`
  }
  if (/^localhost/i.test(v) || /^127\.0\.0\.1/.test(v)) {
    return /:\/\//.test(v) ? v : `http://${v}`
  }
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(v)) {
    return `http://${v}`
  }
  if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}([/:?#].*)?$/.test(v)) {
    return `https://${v}`
  }
  return `http://${v}`
}

function isPrivateHost(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true
  }
  if (!/\.[a-zA-Z]{2,}$/.test(host)) return true
  if (/\.(local|internal|lan|home|intranet|corp|test)$/i.test(host)) return true
  return false
}

/** base64url, no padding — must match `encode_preview_target` in the server. */
function encodeTarget(origin: string): string {
  return btoa(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeTarget(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  const rest = padded.length % 4
  return atob(rest ? padded + '='.repeat(4 - rest) : padded)
}

/**
 * Reverse of [`urlToPreviewSrc`]: a proxy route (or an `/api/proxy?url=`
 * route) back to the URL the user typed.
 *
 * The address box shows the route rather than the upstream URL, so editing it
 * has to accept what it displays. A route that does not decode is not treated
 * as a URL — the caller falls back to its normal URL parsing.
 */
export function targetFromPreviewPath(input: string): string | null {
  const s = input.trim()
  const external = s.match(/\/api\/proxy\?url=([^&]+)/)
  if (external) {
    try {
      return decodeURIComponent(external[1])
    } catch {
      return null
    }
  }
  const route = s.match(/(?:^|\/)preview\/([A-Za-z0-9_-]+)(\/.*)?$/)
  if (!route) return null
  try {
    const origin = decodeTarget(route[1])
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return `${origin}${route[2] || '/'}`
  } catch {
    return null
  }
}

/**
 * Path under `/preview` for a loopback/intranet URL, or `null` when the URL
 * must go through the external `/api/proxy` route.
 *
 * The origin is encoded into one opaque segment and the app's own path stays
 * visible after it: history-mode SPAs read `location.pathname`, and hiding the
 * path inside the segment would make every app route 404. The server decodes
 * the segment and forwards to that origin, preserving the remaining path.
 */
export function previewPathFor(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    if (!(host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || isPrivateHost(host))) {
      return null
    }
    const scheme = parsed.protocol === 'https:' ? 'https' : 'http'
    const port = parsed.port || (scheme === 'https' ? '443' : '80')
    const segment = encodeTarget(`${scheme}://${host}:${port}`)
    return `/preview/${segment}${parsed.pathname || '/'}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

/**
 * Same-origin path the preview iframe should load.
 *
 * Returns a relative path: the caller runs it through `apiUrl()` so the active
 * server's relay prefix (`/__srv/<id>`) is applied in the same place as every
 * other request.
 */
export function urlToPreviewSrc(url: string): string {
  if (!url) return 'about:blank'
  return previewPathFor(url) ?? `/api/proxy?url=${encodeURIComponent(url)}`
}

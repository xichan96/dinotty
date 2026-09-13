import { isTauri } from '../composables/useTransport'

const RELEASE_PATH_PREFIX = '/xichan96/dinotty/releases/tag/'
const DOWNLOAD_PATH_PREFIX = '/xichan96/dinotty/releases/download/'

/**
 * The guards every Dinotty GitHub URL must pass: official host, no port or
 * credentials, and no query/fragment that could smuggle a different target past
 * the path check.
 */
function isOfficialDinottyUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

/** Splits the remainder after `prefix` into non-empty, slash-free segments. */
function restSegments(url: URL, prefix: string, count: number): string[] | null {
  if (!url.pathname.startsWith(prefix)) return null
  const segments = url.pathname.slice(prefix.length).split('/')
  if (segments.length !== count) return null
  if (segments.some((segment) => segment.length === 0)) return null
  return segments
}

export function isOfficialDinottyReleaseUrl(rawUrl: string): boolean {
  const url = isOfficialDinottyUrl(rawUrl)
  if (!url) return false
  const segments = restSegments(url, RELEASE_PATH_PREFIX, 1)
  return segments !== null
}

/**
 * Accepts a link to a release *asset*. Used for the update download and for the
 * alternate bundles offered alongside it.
 */
export function isOfficialDinottyAssetUrl(rawUrl: string): boolean {
  const url = isOfficialDinottyUrl(rawUrl)
  if (!url) return false
  // Exactly `<tag>/<file>` — no nested path segments.
  return restSegments(url, DOWNLOAD_PATH_PREFIX, 2) !== null
}

/** Opens an HTTP(S) URL with the desktop OS's default browser. */
export async function openUrlInSystemBrowser(rawUrl: string): Promise<boolean> {
  if (!isTauri()) return false

  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url.href)
    return true
  } catch {
    return false
  }
}

async function openVerifiedUrl(rawUrl: string): Promise<boolean> {
  try {
    if (isTauri()) {
      return openUrlInSystemBrowser(rawUrl)
    }
    // With opener isolation, browsers may return null even when the tab opened successfully.
    window.open(rawUrl, '_blank', 'noopener,noreferrer')
    return true
  } catch {
    return false
  }
}

export async function openExternalUrl(rawUrl: string): Promise<boolean> {
  if (!isOfficialDinottyReleaseUrl(rawUrl)) return false
  return openVerifiedUrl(rawUrl)
}

/**
 * Opens a release asset URL. In the browser this is the download fallback: the
 * desktop app saves the file itself, but a web/PWA client has no way to do that
 * and hands the asset to the browser instead.
 */
export async function openReleaseAssetUrl(rawUrl: string): Promise<boolean> {
  if (!isOfficialDinottyAssetUrl(rawUrl)) return false
  return openVerifiedUrl(rawUrl)
}

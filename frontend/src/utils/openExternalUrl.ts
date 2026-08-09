import { isTauri } from '../composables/useTransport'

const RELEASE_PATH_PREFIX = '/xichan96/dinotty/releases/tag/'

export function isOfficialDinottyReleaseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const tag = url.pathname.slice(RELEASE_PATH_PREFIX.length)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname.startsWith(RELEASE_PATH_PREFIX) &&
      tag.length > 0 &&
      !tag.includes('/')
    )
  } catch {
    return false
  }
}

export async function openExternalUrl(rawUrl: string): Promise<boolean> {
  if (!isOfficialDinottyReleaseUrl(rawUrl)) return false

  try {
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(rawUrl)
      return true
    }
    // With opener isolation, browsers may return null even when the tab opened successfully.
    window.open(rawUrl, '_blank', 'noopener,noreferrer')
    return true
  } catch {
    return false
  }
}

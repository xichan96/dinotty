import { readonly, ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import { isTauri, tauriInvoke } from './useTransport'
import { isOfficialDinottyAssetUrl, isOfficialDinottyReleaseUrl } from '../utils/openExternalUrl'

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up_to_date'
  | 'update_available'
  | 'unavailable'

export type UpdateDownloadStatus =
  | 'idle'
  | 'saving'
  | 'downloading'
  | 'done'
  | 'cancelled'
  | 'error'

export interface AlternateAsset {
  name: string
  url: string
  size: number | null
}

interface DownloadProgressPayload {
  downloaded: number
  total: number | null
  percent: number | null
}

const PROGRESS_EVENT = 'update-download-progress'
const CANCELLED = 'cancelled'

const status = ref<UpdateCheckStatus>('idle')
const currentVersion = ref('')
const latestVersion = ref('')
const publishedAt = ref('')
const releaseUrl = ref('')

const assetName = ref('')
const assetUrl = ref('')
const assetSize = ref<number | null>(null)
const alternateAssets = ref<AlternateAsset[]>([])

const downloadStatus = ref<UpdateDownloadStatus>('idle')
const downloadProgress = ref<DownloadProgressPayload>({ downloaded: 0, total: null, percent: null })
const downloadedPath = ref('')
const downloadError = ref('')

let started = false
let promptConsumed = false
let generation = 0
let controller: AbortController | null = null
let inFlight: Promise<void> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Reads a `download`/`alternates` entry. Returns null unless the asset URL
 * passes the same allowlist the release URL does — these arrive over the
 * network and end up in `window.open` or a file download.
 */
function parseAsset(value: unknown): AlternateAsset | null {
  if (!isRecord(value) || !isVersion(value.name) || !isVersion(value.url)) return null
  if (!isOfficialDinottyAssetUrl(value.url)) return null
  const size = typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : null
  return { name: value.name, url: value.url, size }
}

function clearAsset() {
  assetName.value = ''
  assetUrl.value = ''
  assetSize.value = null
  alternateAssets.value = []
}

function applyResponse(value: unknown): boolean {
  if (!isRecord(value) || !isVersion(value.current_version) || !isVersion(value.latest_version)) {
    return false
  }

  clearAsset()
  if (value.status === 'up_to_date') {
    status.value = 'up_to_date'
  } else if (
    value.status === 'update_available' &&
    typeof value.published_at === 'string' &&
    typeof value.release_url === 'string' &&
    isOfficialDinottyReleaseUrl(value.release_url)
  ) {
    status.value = 'update_available'
    publishedAt.value = value.published_at
    releaseUrl.value = value.release_url

    const download = parseAsset(value.download)
    if (download) {
      assetName.value = download.name
      assetUrl.value = download.url
      assetSize.value = download.size
    }
    if (Array.isArray(value.alternates)) {
      alternateAssets.value = value.alternates
        .map(parseAsset)
        .filter((asset): asset is AlternateAsset => asset !== null)
    }
  } else {
    return false
  }

  currentVersion.value = value.current_version
  latestVersion.value = value.latest_version
  return true
}

function runCheck(force: boolean): Promise<void> {
  if (inFlight) return inFlight
  if (started && !force) return Promise.resolve()
  started = true
  status.value = 'checking'
  const requestGeneration = ++generation
  controller = new AbortController()

  const isCurrent = () => requestGeneration === generation
  inFlight = (async () => {
    try {
      await getApiBase()
      if (!isCurrent()) return
      // Only the manual path asks the server to bypass its success cache; the
      // automatic path keeps the exact request shape it always had.
      const path = force ? '/api/update-check?force=1' : '/api/update-check'
      const response = await authFetch(apiUrl(path), {
        signal: controller?.signal,
      })
      if (!isCurrent()) return
      if (!response.ok) {
        status.value = 'unavailable'
        return
      }
      const data: unknown = await response.json()
      if (!isCurrent()) return
      if (!applyResponse(data)) status.value = 'unavailable'
    } catch {
      if (isCurrent()) status.value = 'unavailable'
    } finally {
      if (isCurrent()) {
        controller = null
        inFlight = null
      }
    }
  })()

  return inFlight
}

function start(): Promise<void> {
  return runCheck(false)
}

/** A user-initiated check, which bypasses the server's success-cache TTL. */
function recheck(): Promise<void> {
  return runCheck(true)
}

function dispose(): void {
  generation += 1
  controller?.abort()
  controller = null
  inFlight = null
  if (status.value === 'checking') status.value = 'unavailable'
  // Download state is deliberately NOT reset here: `dispose` runs when the
  // settings panel unmounts, and the Rust-side download keeps running after
  // that. Clearing it would drop the progress UI for a download that is still
  // in flight and still going to land on disk.
}

function takeAvailablePrompt(): { currentVersion: string; latestVersion: string } | null {
  if (promptConsumed || status.value !== 'update_available') return null
  promptConsumed = true
  return {
    currentVersion: currentVersion.value,
    latestVersion: latestVersion.value,
  }
}

async function startDownload(): Promise<void> {
  if (downloadStatus.value === 'saving' || downloadStatus.value === 'downloading') return
  if (!isTauri() || !assetUrl.value || !assetName.value || !latestVersion.value) return

  downloadStatus.value = 'saving'
  downloadError.value = ''
  downloadedPath.value = ''
  downloadProgress.value = { downloaded: 0, total: null, percent: null }

  let unlisten: (() => void) | null = null
  try {
    const { listen } = await import('@tauri-apps/api/event')
    unlisten = await listen<DownloadProgressPayload>(PROGRESS_EVENT, (event) => {
      downloadProgress.value = event.payload
      if (downloadStatus.value === 'saving') downloadStatus.value = 'downloading'
    })

    const result = (await tauriInvoke('download_update_asset', {
      url: assetUrl.value,
      tag: `v${latestVersion.value}`,
      filename: assetName.value,
    })) as { path?: string } | null

    downloadedPath.value = result?.path ?? ''
    downloadStatus.value = 'done'
  } catch (error) {
    // The save dialog being dismissed is a normal outcome, not a failure.
    if (String(error).includes(CANCELLED)) {
      downloadStatus.value = 'cancelled'
    } else {
      downloadStatus.value = 'error'
      downloadError.value = String(error)
    }
  } finally {
    unlisten?.()
  }
}

async function cancelDownload(): Promise<void> {
  if (downloadStatus.value !== 'saving' && downloadStatus.value !== 'downloading') return
  try {
    await tauriInvoke('cancel_update_download')
  } catch {
    // The download may have finished between the check and the call.
  }
}

async function revealDownloadedFile(): Promise<boolean> {
  if (!downloadedPath.value) return false
  try {
    await tauriInvoke('reveal_downloaded_file', { path: downloadedPath.value })
    return true
  } catch {
    return false
  }
}

async function openDownloadedFile(): Promise<boolean> {
  if (!downloadedPath.value) return false
  try {
    await tauriInvoke('open_downloaded_file', { path: downloadedPath.value })
    return true
  } catch {
    return false
  }
}

export function useUpdateCheck() {
  return {
    status: readonly(status),
    currentVersion: readonly(currentVersion),
    latestVersion: readonly(latestVersion),
    publishedAt: readonly(publishedAt),
    releaseUrl: readonly(releaseUrl),
    assetName: readonly(assetName),
    assetUrl: readonly(assetUrl),
    assetSize: readonly(assetSize),
    alternateAssets: readonly(alternateAssets),
    downloadStatus: readonly(downloadStatus),
    downloadProgress: readonly(downloadProgress),
    downloadedPath: readonly(downloadedPath),
    downloadError: readonly(downloadError),
    start,
    recheck,
    takeAvailablePrompt,
    dispose,
    startDownload,
    cancelDownload,
    revealDownloadedFile,
    openDownloadedFile,
  }
}

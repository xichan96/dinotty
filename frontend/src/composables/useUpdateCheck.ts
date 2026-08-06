import { readonly, ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import { isOfficialDinottyReleaseUrl } from '../utils/openExternalUrl'

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up_to_date'
  | 'grace_period'
  | 'update_available'
  | 'unavailable'

const status = ref<UpdateCheckStatus>('idle')
const currentVersion = ref('')
const latestVersion = ref('')
const publishedAt = ref('')
const releaseUrl = ref('')

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

function applyResponse(value: unknown): boolean {
  if (!isRecord(value) || !isVersion(value.current_version) || !isVersion(value.latest_version)) {
    return false
  }

  if (value.status === 'up_to_date') {
    status.value = 'up_to_date'
  } else if (value.status === 'grace_period' && typeof value.published_at === 'string') {
    status.value = 'grace_period'
    publishedAt.value = value.published_at
  } else if (
    value.status === 'update_available' &&
    typeof value.published_at === 'string' &&
    typeof value.release_url === 'string' &&
    isOfficialDinottyReleaseUrl(value.release_url)
  ) {
    status.value = 'update_available'
    publishedAt.value = value.published_at
    releaseUrl.value = value.release_url
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
      const response = await authFetch(apiUrl('/api/update-check'), {
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

function recheck(): Promise<void> {
  return runCheck(true)
}

function dispose(): void {
  generation += 1
  controller?.abort()
  controller = null
  inFlight = null
  if (status.value === 'checking') status.value = 'unavailable'
}

function takeAvailablePrompt(): { currentVersion: string; latestVersion: string } | null {
  if (promptConsumed || status.value !== 'update_available') return null
  promptConsumed = true
  return {
    currentVersion: currentVersion.value,
    latestVersion: latestVersion.value,
  }
}

export function useUpdateCheck() {
  return {
    status: readonly(status),
    currentVersion: readonly(currentVersion),
    latestVersion: readonly(latestVersion),
    publishedAt: readonly(publishedAt),
    releaseUrl: readonly(releaseUrl),
    start,
    recheck,
    takeAvailablePrompt,
    dispose,
  }
}

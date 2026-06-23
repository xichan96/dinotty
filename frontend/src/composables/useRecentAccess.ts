import { useSettings } from './useSettings'
import type { RecentEntry } from './useSettings'

const MAX_RECENT = 50
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let _cached: { settings: ReturnType<typeof useSettings>['settings']; saveSettings: ReturnType<typeof useSettings>['saveSettings'] } | null = null

function getCached() {
  if (!_cached) {
    _cached = useSettings()
  }
  return _cached
}

function debouncedSave() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    getCached().saveSettings()
    debounceTimer = null
  }, 3000)
}

function recordRecent(list: RecentEntry[], pathOrUrl: string, name: string) {
  const now = Math.floor(Date.now() / 1000)
  const idx = list.findIndex(e => e.path_or_url === pathOrUrl)
  if (idx !== -1) list.splice(idx, 1)
  list.unshift({ path_or_url: pathOrUrl, name, visited_at: now })
  while (list.length > MAX_RECENT) list.pop()
  debouncedSave()
}

export function useRecentFiles() {
  const { settings, saveSettings } = getCached()

  function recordFile(absolutePath: string, fileName: string) {
    recordRecent(settings.recent_files, absolutePath, fileName)
  }

  function clearFiles() {
    settings.recent_files.splice(0)
    saveSettings()
  }

  function removeFile(path: string) {
    const idx = settings.recent_files.findIndex(e => e.path_or_url === path)
    if (idx !== -1) {
      settings.recent_files.splice(idx, 1)
      saveSettings()
    }
  }

  function formatRelativeTime(visitedAt: number, t: (key: string) => string): string {
    const now = Math.floor(Date.now() / 1000)
    const diff = now - visitedAt
    if (diff < 60) return t('recent.justNow')
    if (diff < 3600) return t('recent.minutesAgo').replace('{n}', String(Math.floor(diff / 60)))
    if (diff < 86400) return t('recent.hoursAgo').replace('{n}', String(Math.floor(diff / 3600)))
    if (diff < 172800) return t('recent.yesterday')
    const d = new Date(visitedAt * 1000)
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  return { recordFile, clearFiles, removeFile, formatRelativeTime }
}

export function useRecentUrls() {
  const { settings, saveSettings } = getCached()

  function recordUrl(url: string) {
    recordRecent(settings.recent_urls, url, url)
  }

  function clearUrls() {
    settings.recent_urls.splice(0)
    saveSettings()
  }

  function removeUrl(url: string) {
    const idx = settings.recent_urls.findIndex(e => e.path_or_url === url)
    if (idx !== -1) {
      settings.recent_urls.splice(idx, 1)
      saveSettings()
    }
  }

  return { recordUrl, clearUrls, removeUrl }
}

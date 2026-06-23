import { computed } from 'vue'
import { useSettings } from './useSettings'
import { randomId } from '../utils/id'

export function useWebBookmarks() {
  const { settings, saveSettings } = useSettings()
  const bookmarks = computed(() => settings.web_bookmarks)

  function isBookmarked(url: string): boolean {
    return settings.web_bookmarks.some(b => b.url === url)
  }

  function addBookmark(name: string, url: string, group?: string) {
    if (isBookmarked(url)) return
    settings.web_bookmarks.push({
      id: randomId(),
      name,
      url,
      group: group || null,
    })
    saveSettings()
  }

  function removeBookmark(id: string) {
    const idx = settings.web_bookmarks.findIndex(b => b.id === id)
    if (idx !== -1) {
      settings.web_bookmarks.splice(idx, 1)
      saveSettings()
    }
  }

  function toggleBookmark(name: string, url: string) {
    const existing = settings.web_bookmarks.find(b => b.url === url)
    if (existing) {
      removeBookmark(existing.id)
    } else {
      addBookmark(name, url)
    }
  }

  function renameBookmark(id: string, newName: string) {
    const bm = settings.web_bookmarks.find(b => b.id === id)
    if (bm) {
      bm.name = newName
      saveSettings()
    }
  }

  return { bookmarks, isBookmarked, addBookmark, removeBookmark, toggleBookmark, renameBookmark }
}

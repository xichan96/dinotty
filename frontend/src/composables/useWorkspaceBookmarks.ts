import { computed } from 'vue'
import { useSettings } from './useSettings'
import { randomId } from '../utils/id'

export function useWorkspaceBookmarks() {
  const { settings, saveSettings } = useSettings()
  const bookmarks = computed(() => settings.workspace_bookmarks)

  function isBookmarked(path: string): boolean {
    return settings.workspace_bookmarks.some(b => b.path === path)
  }

  function addBookmark(name: string, path: string, isDir: boolean, group?: string) {
    if (isBookmarked(path)) return
    settings.workspace_bookmarks.push({
      id: randomId(),
      name,
      path,
      is_dir: isDir,
      group: group || null,
    })
    saveSettings()
  }

  function removeBookmark(id: string) {
    const idx = settings.workspace_bookmarks.findIndex(b => b.id === id)
    if (idx !== -1) {
      settings.workspace_bookmarks.splice(idx, 1)
      saveSettings()
    }
  }

  function toggleBookmark(name: string, path: string, isDir: boolean) {
    const existing = settings.workspace_bookmarks.find(b => b.path === path)
    if (existing) {
      removeBookmark(existing.id)
    } else {
      addBookmark(name, path, isDir)
    }
  }

  function renameBookmark(id: string, newName: string) {
    const bm = settings.workspace_bookmarks.find(b => b.id === id)
    if (bm) {
      bm.name = newName
      saveSettings()
    }
  }

  function reorderBookmarks(fromIdx: number, toIdx: number) {
    const list = settings.workspace_bookmarks
    if (fromIdx < 0 || fromIdx >= list.length || toIdx < 0 || toIdx >= list.length) return
    const [item] = list.splice(fromIdx, 1)
    list.splice(toIdx, 0, item)
    saveSettings()
  }

  return { bookmarks, isBookmarked, addBookmark, removeBookmark, toggleBookmark, renameBookmark, reorderBookmarks }
}

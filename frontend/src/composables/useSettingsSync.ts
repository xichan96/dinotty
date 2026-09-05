import { watch, nextTick } from 'vue'
import { useSettings, notifyTextChange } from './useSettings'
import { effectiveTheme } from './useDeviceThemeSelection'
import { useUiStore } from '../stores/uiStore'

// Global settings side effects (theme apply, text notify, autosave, refetch on
// panel open). Owned by App.vue so they keep working when SettingsPanel is not
// mounted.
export function useSettingsSync() {
  const { settings, saveSettings, loadSettings, applyCurrentTheme } = useSettings()
  const ui = useUiStore()

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let suppressSave = false
  function scheduleSave() {
    if (suppressSave) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveSettings(), 500)
  }

  // Only trigger DOM-heavy theme application when theme fields actually change
  watch(effectiveTheme, applyCurrentTheme)

  // Only notify terminal text changes when text settings change
  watch(() => ({ ...settings.text }), notifyTextChange)

  // Save on any setting change
  watch(settings, scheduleSave, { deep: true })

  // Re-fetch settings from backend when the panel opens (multi-end sync).
  // Cancel any pending debounced save and suppress the autosave that the
  // remote Object.assign would trigger, so we neither PUT back the fetched
  // value nor let a stale pending timer overwrite it.
  watch(
    () => ui.settingsOpen,
    (v) => {
      if (!v) return
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      suppressSave = true
      void loadSettings().finally(() =>
        nextTick(() => {
          suppressSave = false
        })
      )
    }
  )
}

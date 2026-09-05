import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/** Open floating windows: pluginId -> stacking rank (higher renders in front
 *  inside the host layer). Geometry lives in the window component +
 *  localStorage; plugin validity is the host's concern. */
export const usePluginFloatWindowsStore = defineStore('pluginFloatWindows', () => {
  const windows = ref(new Map<string, number>())
  const zCounter = ref(0)

  const openIds = computed(() => Array.from(windows.value.keys()))

  function isOpen(pluginId: string): boolean {
    return windows.value.has(pluginId)
  }

  function focus(pluginId: string): void {
    if (!windows.value.has(pluginId)) return
    zCounter.value += 1
    windows.value.set(pluginId, zCounter.value)
  }

  /** Open (single instance per plugin) or bring an existing window to front. */
  function open(pluginId: string): void {
    if (!windows.value.has(pluginId)) windows.value.set(pluginId, 0)
    focus(pluginId)
  }

  function close(pluginId: string): void {
    windows.value.delete(pluginId)
  }

  function toggle(pluginId: string): void {
    if (windows.value.has(pluginId)) close(pluginId)
    else open(pluginId)
  }

  /** Stacking rank for the window's z-index (0 when not open). */
  function zOf(pluginId: string): number {
    return windows.value.get(pluginId) ?? 0
  }

  return { windows, zCounter, openIds, isOpen, open, close, toggle, focus, zOf }
})

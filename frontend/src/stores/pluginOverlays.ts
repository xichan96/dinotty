import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { settings } from '../composables/useSettings'
import type { OverlayContribution } from '../../../plugin-api/index'

export const MAX_OVERLAY_FAILURES = 5

export interface RegisteredOverlay extends OverlayContribution {
  pluginId: string
  /** true when visible() returned false OR defaultVisible=false, evaluated ONCE at registration. */
  defaultHidden: boolean
  failureCount: number
  lastError?: string
  autoHidden: boolean
}

export const usePluginOverlaysStore = defineStore('pluginOverlays', () => {
  const overlays = ref<RegisteredOverlay[]>([])
  /** Overlays the user dismissed via the right-click context menu (session-only). */
  const hiddenIds = ref<Set<string>>(new Set())
  /** Overlays the user re-enabled from the plugin tab despite defaultHidden (session-only). */
  const forcedVisible = ref<Set<string>>(new Set())
  /** The single overlay currently in reposition mode (plugin tab "Adjust position"). */
  const repositionId = ref<string | null>(null)

  function register(pluginId: string, items: OverlayContribution[]) {
    for (const item of items) {
      if (overlays.value.some((o) => o.id === item.id)) continue
      let defaultHidden = false
      if (item.visible !== undefined) {
        try {
          // visible() is evaluated exactly once at registration; on throw the
          // overlay stays visible so a broken guard never hides a working widget.
          defaultHidden = !item.visible()
        } catch {
          defaultHidden = false
        }
      } else if (item.defaultVisible === false) {
        defaultHidden = true
      }
      overlays.value.push({ ...item, pluginId, defaultHidden, failureCount: 0, autoHidden: false })
    }
  }

  function unregister(pluginId: string) {
    const ids = overlays.value.filter((o) => o.pluginId === pluginId).map((o) => o.id)
    overlays.value = overlays.value.filter((o) => o.pluginId !== pluginId)
    if (ids.length) {
      if (hiddenIds.value.size) {
        const nextH = new Set(hiddenIds.value)
        ids.forEach((id) => nextH.delete(id))
        hiddenIds.value = nextH
      }
      if (forcedVisible.value.size) {
        const nextF = new Set(forcedVisible.value)
        ids.forEach((id) => nextF.delete(id))
        forcedVisible.value = nextF
      }
      if (repositionId.value && ids.includes(repositionId.value)) repositionId.value = null
    }
  }

  /** Session-level dismissal via the overlay right-click context menu. */
  function hideOverlay(id: string) {
    hiddenIds.value = new Set([...hiddenIds.value, id])
  }

  /** Persistent per-overlay pref from the plugin tab. Reactive read so the host's
   *  visibleOverlays computed re-filters when the pref changes. */
  function prefHidden(id: string): boolean {
    return settings.plugin_prefs?.hidden_overlays?.includes(id) ?? false
  }

  /** Toggle a single overlay from the plugin tab (persistent). Re-enabling also
   *  revives an overlay dismissed this session via the context menu, and overrides
   *  a plugin-side defaultHidden (visible()/defaultVisible) for this session. */
  function setUserVisible(id: string, visible: boolean) {
    const cur = settings.plugin_prefs?.hidden_overlays ?? []
    const next = visible ? cur.filter((x) => x !== id) : [...cur, id]
    settings.plugin_prefs = { ...settings.plugin_prefs, hidden_overlays: next }
    if (visible) {
      const o = overlays.value.find((x) => x.id === id)
      if (o?.defaultHidden && !forcedVisible.value.has(id)) {
        forcedVisible.value = new Set([...forcedVisible.value, id])
      }
      if (hiddenIds.value.has(id)) {
        hiddenIds.value = new Set([...hiddenIds.value].filter((x) => x !== id))
      }
    } else if (forcedVisible.value.has(id)) {
      forcedVisible.value = new Set([...forcedVisible.value].filter((x) => x !== id))
    }
  }

  /** Enter/leave reposition mode for a single overlay (plugin tab "Adjust position"). */
  function setReposition(id: string | null) {
    repositionId.value = id
  }

  /** Called by OverlayDragItem's error boundary on each captured render error. */
  function reportError(id: string, err?: unknown) {
    const o = overlays.value.find((x) => x.id === id)
    if (!o) return
    o.failureCount += 1
    o.lastError = err instanceof Error ? err.message : String(err)
    if (o.failureCount >= MAX_OVERLAY_FAILURES) o.autoHidden = true
  }

  /** Deliberately does NOT call visible() (that ran once at register); runtime
   *  visibility is the component's own v-if. autoHidden / hiddenIds / forcedVisible /
   *  the plugin-tab pref are all reactive. */
  function isVisible(o: RegisteredOverlay): boolean {
    return (
      !o.autoHidden &&
      (!o.defaultHidden || forcedVisible.value.has(o.id)) &&
      !hiddenIds.value.has(o.id) &&
      !prefHidden(o.id)
    )
  }

  const pluginIds = computed(() => Array.from(new Set(overlays.value.map((o) => o.pluginId))))

  return {
    overlays,
    pluginIds,
    repositionId,
    register,
    unregister,
    reportError,
    hideOverlay,
    setUserVisible,
    setReposition,
    isVisible,
  }
})

/** What can live inside a floating window: a plugin, or a built-in preview
 *  pane (files/web). 'plugin' is reserved for future plugin-kind entries; the
 *  chrome is driven by the plugin/api props path today. */
export type FloatablePaneKind = 'plugin' | 'files' | 'web'

export type FloatWindowContent =
  | { kind: 'plugin'; pluginId: string }
  | { kind: 'files'; sourcePaneId: string; initialPath?: string }
  | { kind: 'web'; initialUrl?: string }

export function floatWindowId(c: FloatWindowContent): string {
  return c.kind === 'plugin' ? c.pluginId : `float:${c.kind}`
}

export function filesStatePaneId(sourcePaneId: string): string {
  return `float:files:${sourcePaneId}`
}

/** Where a built-in preview opens. 'window' is a native desktop window and is
 *  unavailable outside the Tauri shell, where it falls back to a float. */
export type PreviewOpenMode = 'split' | 'floating' | 'window'

export function resolvePreviewOpenMode(
  explicit: PreviewOpenMode | undefined,
  pref: PreviewOpenMode,
  desktop: boolean
): PreviewOpenMode {
  const mode = explicit ?? pref
  // The native-window mode is a desktop-only capability; web/touch clients
  // that received the preference from the server still get an in-app float.
  // Touch devices are no longer forced to split: the float is pointer-drag
  // based and PluginFloatWindow clamps its size to the viewport, so a phone
  // can use it too.
  if (mode === 'window' && !desktop) return 'floating'
  return mode
}

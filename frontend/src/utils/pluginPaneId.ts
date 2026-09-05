export function workspaceIdFromPaneId(paneId: string): string | undefined {
  const parts = paneId.split(':')
  if (parts.length !== 3 || parts[0] !== 'plugin' || !parts[2]) return undefined
  return parts[2]
}

/** Stable paneId for a plugin's floating window (single instance per plugin).
 *  3-part 'plugin:{id}:{scope}' format; workspaceIdFromPaneId yields the 'float'
 *  sentinel — the real workspace is passed as a separate prop. */
export function floatPaneId(pluginId: string): string {
  return `plugin:${pluginId}:float`
}

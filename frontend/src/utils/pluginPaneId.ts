export function workspaceIdFromPaneId(paneId: string): string | undefined {
  const parts = paneId.split(':')
  if (parts.length !== 3 || parts[0] !== 'plugin' || !parts[2]) return undefined
  return parts[2]
}

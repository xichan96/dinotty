/**
 * Select the tab to activate after a tab is removed.
 *
 * The tab at the closed tab's former workspace-relative position is preferred.
 * If that workspace is now empty, the nearest tab at the removed flat-array
 * position is returned instead. Both indices must be captured before removal;
 * `remainingTabs` must no longer contain the closed tab.
 */
export function pickSuccessorTab<T>(
  remainingTabs: T[],
  closedWorkspaceId: string | null,
  workspaceIdxBefore: number,
  removedIdx: number,
  workspaceIdOf: (tab: T) => string | null
): T | undefined {
  if (remainingTabs.length === 0) return undefined

  const workspaceTabs = remainingTabs.filter(
    (tab) => workspaceIdOf(tab) === closedWorkspaceId
  )
  if (workspaceTabs.length > 0) {
    return workspaceTabs[Math.min(workspaceIdxBefore, workspaceTabs.length - 1)]
  }

  return remainingTabs[Math.min(removedIdx, remainingTabs.length - 1)]
}

/**
 * Pane id of the next/previous tab in a visible tab strip, wrapping at the ends.
 *
 * `visibleTabList` is the tab-bar order (already filtered to the current
 * workspace, with detached tabs removed). `activePaneId` is the tab's paneId,
 * so it can be missing from the list when the active tab is in another
 * workspace — in that case a forward step starts at the first tab and a
 * backward step at the last one.
 */
export function adjacentTabPaneId(
  list: readonly { paneId: string }[],
  activePaneId: string | null | undefined,
  step: 1 | -1
): string | null {
  if (list.length < 2) return null
  const current = list.findIndex((tab) => tab.paneId === activePaneId)
  const from = current < 0 ? (step === 1 ? -1 : 0) : current
  const next = (((from + step) % list.length) + list.length) % list.length
  return list[next]?.paneId ?? null
}

/**
 * Layout tiers for the files-pane header.
 *
 * The header is icon-only, so the width budget is stable across locales. When
 * the pane is narrower than the full set of tree actions, the tail of the list
 * moves into the overflow menu instead of shrinking or wrapping.
 */

export type LeftHeaderTier = 'full' | 'compact' | 'tight' | 'tiny'

export type LeftHeaderAction = 'search' | 'new-file' | 'new-folder' | 'refresh' | 'collapse'

/**
 * Pick a tier from the header's rendered width.
 *
 * `0` means "not measured yet" (SSR, happy-dom, or the first frame before the
 * ResizeObserver fires); treat it as full so nothing is hidden by default.
 */
export function leftHeaderTier(width: number): LeftHeaderTier {
  if (!Number.isFinite(width) || width <= 0) return 'full'
  if (width >= 250) return 'full'
  if (width >= 210) return 'compact'
  if (width >= 170) return 'tight'
  return 'tiny'
}

/** Actions that no longer fit inline and must move into the overflow menu. */
export function hiddenTreeActions(tier: LeftHeaderTier): LeftHeaderAction[] {
  switch (tier) {
    case 'full':
      return []
    case 'compact':
      return ['new-file', 'new-folder', 'collapse']
    case 'tight':
      return ['search', 'new-file', 'new-folder', 'collapse']
    case 'tiny':
      return ['search', 'new-file', 'new-folder', 'refresh', 'collapse']
  }
}

/** True when the action is rendered inline for the given tier. */
export function actionIsInline(tier: LeftHeaderTier, action: LeftHeaderAction): boolean {
  return !hiddenTreeActions(tier).includes(action)
}

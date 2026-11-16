export const PREVIEW_TOOLBAR_IDS = [
  'broadcast',
  'new_tab',
  'plugins',
  'files',
  'web',
  'reload',
  'settings',
  'notifications',
] as const

export const TOGGLEABLE_PREVIEW_TOOLBAR_IDS = ['files', 'web'] as const

export type PreviewToolbarId = (typeof PREVIEW_TOOLBAR_IDS)[number]

export interface PreviewToolbarItem {
  id: PreviewToolbarId
  visible: boolean
}

export function isPreviewToolbarItemToggleable(id: PreviewToolbarId): boolean {
  return (TOGGLEABLE_PREVIEW_TOOLBAR_IDS as readonly string[]).includes(id)
}

/**
 * Settings are user-editable and older servers do not include this field.
 * Keep the toolbar usable in either case, while preserving a valid custom order.
 */
export function normalizePreviewToolbarItems(items: unknown): PreviewToolbarItem[] {
  const result: PreviewToolbarItem[] = []
  const seen = new Set<PreviewToolbarId>()

  if (Array.isArray(items)) {
    for (const item of items) {
      if (
        !item ||
        typeof item !== 'object' ||
        !('id' in item) ||
        !PREVIEW_TOOLBAR_IDS.includes(item.id as PreviewToolbarId) ||
        seen.has(item.id as PreviewToolbarId)
      ) {
        continue
      }
      const { id, visible } = item as { id: PreviewToolbarId; visible?: unknown }
      seen.add(id)
      result.push({ id, visible: isPreviewToolbarItemToggleable(id) ? visible !== false : true })
    }
  }

  for (const id of PREVIEW_TOOLBAR_IDS) {
    if (!seen.has(id)) result.push({ id, visible: true })
  }

  return result
}

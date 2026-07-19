import type { WorkspaceBadgeMode } from './useSettings'

export interface ResolvedWorkspaceBadgeMode {
  mode: WorkspaceBadgeMode
  showTabBadge: boolean
  showMonogram: boolean
}

export function resolveWorkspaceBadgeMode(
  mode: WorkspaceBadgeMode | null | undefined,
  isMobile: boolean
): ResolvedWorkspaceBadgeMode {
  const resolved = mode ?? (isMobile ? 'tab' : 'off')
  return {
    mode: resolved,
    showTabBadge: resolved === 'tab' || resolved === 'both',
    showMonogram: resolved === 'icon' || resolved === 'both',
  }
}

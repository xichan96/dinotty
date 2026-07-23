export type KeyboardGuardMode = 'off' | 'collapse_only' | 'open_only' | 'both'

export function hasCollapseGuard(mode: KeyboardGuardMode): boolean {
  return mode === 'collapse_only' || mode === 'both'
}

export function hasOpenGuard(mode: KeyboardGuardMode): boolean {
  return mode === 'open_only' || mode === 'both'
}

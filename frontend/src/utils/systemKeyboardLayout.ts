import type { ActionKey, SystemKeyboardConfig } from '../composables/useSettings'
import { agentIconForLabel } from './agentShortcutIcon'
import { getAppAction } from './appActionCatalog'

export const SYSTEM_ROW_UNITS = 10
export const UPPER_USER_UNITS = 9
export const MAX_SYSTEM_PAGES = 5
export const MAX_SYSTEM_PINNED = 5

export interface PackedSystemKey {
  key: ActionKey
  units: number
}

export interface SystemKeyboardLayoutStatus {
  upperPinned: number
  upperPinnedUnits: number
  upperCapacity: number
  lowerPinned: number
  lowerPinnedUnits: number
  lowerCapacity: number
  upperPages: number
  lowerPages: number
  storedLowerPages: number
  valid: boolean
  overLimit: boolean
  reason: 'upper_pages' | 'lower_pages' | 'pinned_capacity' | null
}

function labelWeight(label: string): number {
  let weight = 0
  for (const char of label.trim()) {
    if (/\s/u.test(char)) weight += 0.5
    else if (
      /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char)
    ) {
      weight += 2
    } else {
      weight += 1
    }
  }
  return weight
}

export function autoSystemKeyUnits(label: string, capacity = SYSTEM_ROW_UNITS): number {
  const weighted = labelWeight(label)
  return Math.min(capacity, Math.max(1, Math.ceil((14 + weighted * 8) / 44)))
}

export function systemKeyUnits(key: ActionKey, capacity: number): number {
  const width = key.grow
  if (typeof width === 'number' && Number.isFinite(width)) {
    return Math.min(capacity, Math.max(1, Math.round(width)))
  }
  if (key.display !== 'text' && agentIconForLabel(key.label)) return 1
  if (key.kind === 'action' && key.display !== 'text' && key.action && getAppAction(key.action)) {
    return 1
  }
  return autoSystemKeyUnits(key.label, capacity)
}

export function packSystemKeys(keys: ActionKey[], capacity: number): PackedSystemKey[][] {
  if (keys.length === 0) return [[]]
  if (capacity <= 0) return keys.map((key) => [{ key, units: 1 }])
  const pages: PackedSystemKey[][] = []
  let page: PackedSystemKey[] = []
  let used = 0
  for (const key of keys) {
    const units = systemKeyUnits(key, capacity)
    if (page.length && used + units > capacity) {
      pages.push(page)
      page = []
      used = 0
    }
    page.push({ key, units })
    used += units
  }
  pages.push(page)
  return pages
}

export function canonicalLowerKeys(config: SystemKeyboardConfig): ActionKey[] {
  return config.pages.flat()
}

export function systemKeyboardLayoutStatus(
  config: SystemKeyboardConfig
): SystemKeyboardLayoutStatus {
  const upperPinned = Math.min(
    MAX_SYSTEM_PINNED,
    Math.max(0, Math.trunc(config.upper_pinned ?? 0)),
    config.upper.length
  )
  const pinned = config.upper.slice(0, upperPinned)
  const pageable = config.upper.slice(upperPinned)
  const upperPinnedUnits = pinned.reduce(
    (sum, key) => sum + systemKeyUnits(key, UPPER_USER_UNITS),
    0
  )
  const upperCapacity = Math.max(0, UPPER_USER_UNITS - upperPinnedUnits)
  const pinnedInvalid =
    upperPinnedUnits > UPPER_USER_UNITS || (pageable.length > 0 && upperCapacity < 1)
  const upperPages = pageable.length ? packSystemKeys(pageable, upperCapacity).length : 1
  const lower = canonicalLowerKeys(config)
  const lowerPinned = Math.min(
    MAX_SYSTEM_PINNED,
    Math.max(0, Math.trunc(config.lower_pinned ?? 0)),
    lower.length
  )
  const lowerPinnedUnits = lower
    .slice(0, lowerPinned)
    .reduce((sum, key) => sum + systemKeyUnits(key, SYSTEM_ROW_UNITS), 0)
  const lowerPageable = lower.slice(lowerPinned)
  const lowerCapacity = Math.max(0, SYSTEM_ROW_UNITS - lowerPinnedUnits)
  const lowerPinnedInvalid =
    lowerPinnedUnits > SYSTEM_ROW_UNITS || (lowerPageable.length > 0 && lowerCapacity < 1)
  const storedLowerPages = lowerPageable.length
    ? packSystemKeys(lowerPageable, lowerCapacity).length
    : 1
  const lowerPages = config.lower_enabled === false ? 0 : storedLowerPages
  const upperOver = upperPages > MAX_SYSTEM_PAGES
  const lowerOver = storedLowerPages > MAX_SYSTEM_PAGES
  const reason =
    pinnedInvalid || lowerPinnedInvalid
      ? 'pinned_capacity'
      : upperOver
        ? 'upper_pages'
        : lowerOver
          ? 'lower_pages'
          : null

  return {
    upperPinned,
    upperPinnedUnits,
    upperCapacity,
    lowerPinned,
    lowerPinnedUnits,
    lowerCapacity,
    upperPages,
    lowerPages,
    storedLowerPages,
    valid: reason === null,
    overLimit: upperOver || lowerOver,
    reason,
  }
}

export function systemKeyboardCandidateAllowed(
  before: SystemKeyboardConfig,
  candidate: SystemKeyboardConfig
): boolean {
  const previous = systemKeyboardLayoutStatus(before)
  const next = systemKeyboardLayoutStatus(candidate)
  if (next.valid) return true
  if (previous.valid) return false
  return (
    next.upperPages <= previous.upperPages &&
    next.storedLowerPages <= previous.storedLowerPages &&
    next.upperCapacity >= previous.upperCapacity &&
    next.lowerCapacity >= previous.lowerCapacity
  )
}

export function canonicalizeSystemKeyboard(config: SystemKeyboardConfig): SystemKeyboardConfig {
  const lower = canonicalLowerKeys(config)
  return {
    upper: config.upper,
    pages: [lower],
    lower_enabled: config.lower_enabled !== false,
    upper_pinned: Math.min(
      MAX_SYSTEM_PINNED,
      Math.max(0, Math.trunc(config.upper_pinned ?? 0)),
      config.upper.length
    ),
    lower_pinned: Math.min(
      MAX_SYSTEM_PINNED,
      Math.max(0, Math.trunc(config.lower_pinned ?? 0)),
      lower.length
    ),
  }
}

import { ANCHOR_FAMILIES, primaryFamily, fontIdentity, toFontFamilyStack } from './fontFamily'

export const MAX_CUSTOM_FONTS = 20

export type FontItemKind = 'default' | 'orphan' | 'anchor' | 'removable'

export interface FontItem {
  family: string
  kind: FontItemKind
  selected: boolean
  removable: boolean
  previewStack: string
}

export type AddFontError = '' | 'blank' | 'tooLong' | 'invalidChars' | 'duplicate' | 'limit'

const INVALID_RE = /["\\]/
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1f\x7f-\x9f]/
const CSS_INJECTION_RE = /[<>;{}]/

function anchorIdSet(): Set<string> {
  return new Set(ANCHOR_FAMILIES.map((a) => fontIdentity(a)))
}

// Structural list (availability decorated by the component). Order: System Default, [orphan], anchors, removable.
export function buildFontList(fontFamily: string, customFonts: string[]): FontItem[] {
  const selId = fontIdentity(fontFamily || '')
  const anchors = anchorIdSet()
  const removableIds = new Set(customFonts.map((c) => fontIdentity(c)))
  const items: FontItem[] = []

  items.push({
    family: '',
    kind: 'default',
    selected: selId === '',
    removable: false,
    previewStack: 'inherit',
  })

  if (fontFamily && selId !== '' && !anchors.has(selId) && !removableIds.has(selId)) {
    const fam = primaryFamily(fontFamily)
    items.push({
      family: fam,
      kind: 'orphan',
      selected: true,
      removable: false,
      previewStack: toFontFamilyStack(fam),
    })
  }

  for (const a of ANCHOR_FAMILIES) {
    const id = fontIdentity(a)
    items.push({
      family: a,
      kind: 'anchor',
      selected: selId === id,
      removable: false,
      previewStack: toFontFamilyStack(a),
    })
  }

  for (const c of customFonts) {
    const id = fontIdentity(c)
    items.push({
      family: c,
      kind: 'removable',
      selected: selId === id,
      removable: true,
      previewStack: toFontFamilyStack(c),
    })
  }

  return items
}

// Normalizer — MUST mirror backend clamp_custom_fonts (Rust): trim, drop blank, drop >100, drop invalid chars,
// ci identity-dedup, drop anchor-dupes, keep-first insertion-order, cap 20.
export function normalizeCustomFonts(list: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const anchors = anchorIdSet()
  for (const raw of list) {
    const primary = primaryFamily(raw ?? '')
    if (!primary) continue
    if ([...primary].length > 100) continue
    if (INVALID_RE.test(primary) || CONTROL_RE.test(primary) || CSS_INJECTION_RE.test(primary))
      continue
    const id = primary.toLowerCase()
    if (anchors.has(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(primary)
    if (out.length >= MAX_CUSTOM_FONTS) break
  }
  return out
}

// Validate an add-input name (already primaryFamily-normalized by the caller). Returns error code ('' = ok).
export function validateFontName(name: string, customFonts: string[]): AddFontError {
  const primary = primaryFamily(name)
  if (!primary) return 'blank'
  if ([...primary].length > 100) return 'tooLong'
  if (INVALID_RE.test(primary) || CONTROL_RE.test(primary) || CSS_INJECTION_RE.test(primary))
    return 'invalidChars'
  const id = primary.toLowerCase()
  if (anchorIdSet().has(id)) return 'duplicate'
  if (new Set(customFonts.map((c) => fontIdentity(c))).has(id)) return 'duplicate'
  if (customFonts.length >= MAX_CUSTOM_FONTS) return 'limit'
  return ''
}

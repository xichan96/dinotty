import { mix, parseHex } from '../themes'

// Source of truth: src/workspace_mgmt/mod.rs WORKSPACE_PALETTE
export const WORKSPACE_COLORS = [
  '#E06C75',
  '#D19A66',
  '#E5C07B',
  '#98C379',
  '#56B6C2',
  '#61AFEF',
  '#C678DD',
] as const

const WIDE_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|[！-｠￠-￦]/u

export function fnv1a32(s: string): number {
  const bytes = new TextEncoder().encode(s)
  let h = 0x811c9dc5
  for (const b of bytes) {
    h = (h ^ b) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function paletteColorFor(id: string): string {
  return WORKSPACE_COLORS[fnv1a32(id) % 7]
}

export function isValidHex(s: string | undefined): boolean {
  return !!s && /^#[0-9A-Fa-f]{6}$/.test(s)
}

export function stripMeaningless(s: string): string {
  return s.replace(/[\s\p{Cc}\p{Cf}]/gu, '')
}

export function capMonogram(str: string): string {
  type SegmenterConstructor = new (
    locales?: string | string[],
    options?: { granularity: 'grapheme' },
  ) => { segment(input: string): Iterable<{ segment: string }> }
  const Segmenter = (Intl as unknown as { Segmenter: SegmenterConstructor }).Segmenter
  const segmenter = new Segmenter(undefined, { granularity: 'grapheme' })
  const clusters = [...segmenter.segment(str)]
    .map(({ segment }) => segment)
    .filter((cluster) => stripMeaningless(cluster) !== '')

  if (clusters.length === 0) return ''

  if (WIDE_RE.test(clusters[0])) {
    return clusters.slice(0, 2).join('')
  }

  return [...clusters.slice(0, 3).join('').toLocaleUpperCase()].slice(0, 3).join('')
}

export function autoMonogram(name: string): string {
  return capMonogram(name) || '?'
}

export function resolveAbbr(ws: { abbr?: string; name: string }): string {
  return capMonogram(ws.abbr ?? '') || autoMonogram(ws.name)
}

export function resolveColor(ws: { color?: string; id: string }): string {
  return isValidHex(ws.color) ? ws.color! : paletteColorFor(ws.id)
}

export function relativeLuminance(hex: string): number {
  const linearize = (channel: number) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const { r, g, b } = parseHex(hex)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

export function contrastRatio(a: string, b: string): number {
  const aLuminance = relativeLuminance(a)
  const bLuminance = relativeLuminance(b)
  return (Math.max(aLuminance, bLuminance) + 0.05) / (Math.min(aLuminance, bLuminance) + 0.05)
}

export function outlineColor(hex: string, cardBgHex: string): string {
  if (contrastRatio(hex, cardBgHex) >= 3) return hex

  const target = contrastRatio('#000000', cardBgHex) >= contrastRatio('#FFFFFF', cardBgHex)
    ? '#000000'
    : '#FFFFFF'
  for (let step = 1; step <= 9; step += 1) {
    const candidate = mix(hex, target, step / 10).toUpperCase()
    if (contrastRatio(candidate, cardBgHex) >= 3) return candidate
  }
  return target
}

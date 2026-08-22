export const ANCHOR_FAMILIES = [
  'Menlo',
  'Consolas',
  'Courier New',
  'DejaVu Sans Mono',
  'monospace',
] as const

const GENERIC_KEYWORDS = new Set(['monospace', 'serif', 'sans-serif'])

export function primaryFamily(value: string): string {
  const first = (value.split(',')[0] ?? '').trim()
  if (first.length >= 2) {
    const q = first[0]
    if ((q === '"' || q === "'") && first[first.length - 1] === q) {
      return first.slice(1, -1).trim()
    }
  }
  return first
}

export function toFontFamilyStack(name: string): string {
  const p = primaryFamily(name)
  if (GENERIC_KEYWORDS.has(p.toLowerCase())) return p.toLowerCase()
  const esc = p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${esc}", monospace`
}

export function fontIdentity(x: string): string {
  return primaryFamily(x).trim().toLowerCase()
}

export function isGenericKeyword(name: string): boolean {
  return GENERIC_KEYWORDS.has(primaryFamily(name).toLowerCase())
}

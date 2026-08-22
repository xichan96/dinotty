import { primaryFamily, isGenericKeyword } from './fontFamily'

const GENERICS = ['monospace', 'serif', 'sans-serif'] as const
const SAMPLES = ['mmMWQ@%8', 'ill1!.,;'] as const
const PROBE_SIZE = 72

export function computeAvailability(
  name: string,
  measure: (fontStack: string, sample: string) => number
): boolean {
  if (name === '' || isGenericKeyword(name)) return true
  try {
    const esc = primaryFamily(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    for (const g of GENERICS) {
      for (const s of SAMPLES) {
        const base = measure(g, s)
        const cand = measure(`"${esc}", ${g}`, s)
        if (base <= 0 || !Number.isFinite(base) || cand <= 0 || !Number.isFinite(cand)) return true
        if (cand !== base) return true
      }
    }
    return false
  } catch {
    return true
  }
}

const cache = new Map<string, boolean>()

// DOM-based text width measurement. Canvas measureText does NOT resolve system
// fonts inside macOS WKWebView (it returns identical widths for every family,
// producing false "not installed"), whereas a laid-out span's offsetWidth
// reflects the actually-matched font. visibility:hidden keeps layout intact.
function measureViaDom(fontStack: string, sample: string): number {
  const span = document.createElement('span')
  span.textContent = sample
  span.style.position = 'absolute'
  span.style.left = '-9999px'
  span.style.top = '-9999px'
  span.style.visibility = 'hidden'
  span.style.whiteSpace = 'nowrap'
  span.style.fontSize = `${PROBE_SIZE}px`
  span.style.fontFamily = fontStack
  document.body.appendChild(span)
  const w = span.offsetWidth
  document.body.removeChild(span)
  return w
}

export function isFontAvailable(name: string): boolean {
  const key = primaryFamily(name).toLowerCase()
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (typeof document === 'undefined' || !document.body) return true
  const result = computeAvailability(name, measureViaDom)
  cache.set(key, result)
  return result
}

export function clearNegativeFontCache(): void {
  for (const [k, v] of cache) if (!v) cache.delete(k)
}

export function clearFontCache(): void {
  cache.clear()
}

if (typeof document !== 'undefined') {
  const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts
  if (fonts && typeof fonts.addEventListener === 'function') {
    fonts.addEventListener('loadingdone', () => clearNegativeFontCache())
  }
}

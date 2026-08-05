import {
  terminalKeyBindingDefs,
  useKeybindings,
  type KeyBinding,
} from '../composables/useKeybindings'
import { trailingPathDeleteLen } from './shell'

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

export function applyAfterTerminalComposition(apply: () => void): boolean {
  const focused =
    typeof document !== 'undefined' &&
    document.activeElement instanceof HTMLTextAreaElement &&
    document.activeElement.classList.contains('xterm-helper-textarea')
      ? document.activeElement
      : null

  if (focused?.dataset.dinottyComposing === 'true') {
    focused.addEventListener('compositionend', apply, { once: true })
    return false
  }

  apply()
  return true
}

export interface MobileTerminalModifiers {
  ctrl: boolean
  alt: boolean
}

export function applyMobileTerminalModifiers(
  input: string,
  modifiers: MobileTerminalModifiers
): { data: string; modifiers: MobileTerminalModifiers; consumed: boolean } {
  let data = input
  let ctrl = modifiers.ctrl
  let alt = modifiers.alt
  let consumed = false

  if (ctrl && data.length === 1 && data.charCodeAt(0) <= 0x7f) {
    const upper = data.toUpperCase()
    let code: number | null = null
    if (upper >= 'A' && upper <= 'Z') code = upper.charCodeAt(0) - 64
    else if (data === ' ' || data === '@') code = 0
    else if (data === '[') code = 27
    else if (data === '\\') code = 28
    else if (data === ']') code = 29
    else if (data === '^') code = 30
    else if (data === '_') code = 31
    else if (data === '?') code = 127

    if (code !== null) {
      data = String.fromCharCode(code)
      ctrl = false
      consumed = true
    }
  }

  if (alt && data) {
    data = `\x1b${data}`
    alt = false
    consumed = true
  }

  return { data, modifiers: { ctrl, alt }, consumed }
}

// Dedup window (ms) for WKWebView onData double-fire.
// xterm.js + WKWebView on macOS can produce 2 onData events for one key
// (modifier-prefixed sequence + actual char). The inter-event gap in
// WKWebView multi-focus replay is sub-millisecond, while the gap between
// the modifier-prefixed event and the real char in a Shift+key press is
// typically > 2ms. A 2ms window rejects the multi-focus duplicate but
// keeps the modifier sequence intact. (was 5ms - caused Shift+punct to
// require a double press.)
export const DEDUP_WINDOW_MS = 2

export const IME_SYM_PAIR_MS = 400

/**
 * Determine whether an incoming onData payload should be dropped because
 * it is a WKWebView multi-focus replay of the previous event. Exported
 * for unit testing.
 */
export function isDuplicateOnData(
  data: string,
  prev: string,
  prevAt: number,
  now: number
): boolean {
  if (prev === '') return false
  if (data !== prev) return false
  return now - prevAt < DEDUP_WINDOW_MS
}

// Contiguous codepoint ranges of Shift+key punctuation that macOS Chinese IME can emit.
// Covers the WHOLE finite alphabet by block, not a per-key whitelist:
//   ASCII punct · General Punctuation (- – ' ' " " …) · CJK Symbols & Punctuation (、。《》「」『』【】〈〉)
//   · Fullwidth Forms punct subranges. Excludes fullwidth letters/digits and U+3000 ideographic space.
const SHIFT_SYMBOL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x21, 0x2f],
  [0x3a, 0x40],
  [0x5b, 0x60],
  [0x7b, 0x7e],
  [0x2010, 0x2027],
  [0x3001, 0x301f],
  [0xff01, 0xff0f],
  [0xff1a, 0xff20],
  [0xff3b, 0xff40],
  [0xff5b, 0xff5e],
]
// Standalone Shift+key punctuation outside any range: ¥(U+00A5 macOS pinyin shift+4) ·(U+00B7) ￥(U+FFE5).
const SHIFT_SYMBOL_SINGLETONS = new Set([0x00a5, 0x00b7, 0xffe5])

// Single char produced by Shift+key that is a symbol/punctuation (NOT a letter/digit/space).
// Excludes pinyin preedit letters (n,i,h,...) and digits, so the rescue can never touch CJK composition.
export function isShiftSymbolChar(data: string): boolean {
  // Doubled CJK punctuation emitted by one keypress: -- (U+2014×2) / …… (U+2026×2)
  if (data.length === 2) {
    const d = data.charCodeAt(0)
    return d === data.charCodeAt(1) && (d === 0x2014 || d === 0x2026)
  }
  if (data.length !== 1) return false
  const cp = data.charCodeAt(0)
  return (
    SHIFT_SYMBOL_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) || SHIFT_SYMBOL_SINGLETONS.has(cp)
  )
}

export function stripImeConfirmSpace(data: string): string {
  // Candidate-confirm space leaks as <sym><space> (incl. --/…… + space); strip the trailing ws.
  if (
    data.length >= 2 &&
    /\s/.test(data[data.length - 1]) &&
    isShiftSymbolChar(data.slice(0, -1))
  ) {
    return data.slice(0, -1)
  }
  return data
}

export function isSinglePrintableAscii(data: string): boolean {
  return data.length === 1 && data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) <= 0x7e
}

export function isSinglePrintableGrapheme(data: string, allowSpace = false): boolean {
  if (data.length !== 1) return false
  const cp = data.charCodeAt(0)
  if (cp === 0x20) return allowSpace
  if (cp < 0x20 || cp === 0x7f) return false
  return cp <= 0x7e || (cp >= 0xff01 && cp <= 0xff5e)
}

export function terminalKeybindingMatches(
  e: KeyboardEvent,
  binding: KeyBinding,
  virtualMeta = false
): boolean {
  const effMeta = e.metaKey || virtualMeta
  const effAlt = virtualMeta ? false : e.altKey
  return (
    e.key.toLowerCase() === binding.key.toLowerCase() &&
    e.shiftKey === !!binding.shift &&
    effMeta === !!binding.meta &&
    e.ctrlKey === !!binding.ctrl &&
    effAlt === !!binding.alt
  )
}

export function handleTerminalShortcutKeydown(
  e: KeyboardEvent,
  sendData: (data: string) => void,
  virtualMeta = false,
  getLineBeforeCursor?: () => string | null
): boolean {
  const key = e.key.toLowerCase()
  if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && (key === 'c' || key === 'v'))
    return false

  const { getBinding } = useKeybindings()
  for (const def of terminalKeyBindingDefs) {
    const sequence = def.sequence
    if (!sequence) continue
    if (terminalKeybindingMatches(e, getBinding(def.id), virtualMeta)) {
      e.preventDefault()
      e.stopPropagation()
      if (def.id === 'term.deleteToLineStart' && getLineBeforeCursor) {
        const line = getLineBeforeCursor()
        if (line !== null) {
          const len = trailingPathDeleteLen(line)
          if (len > 0) {
            sendData('\x7f'.repeat(len))
            return true
          }
        }
      }
      sendData(sequence)
      return true
    }
  }
  return false
}

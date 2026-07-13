import type { ThemeColors } from '../composables/useDeviceThemeSelection'

export type ImportResult =
  | { ok: true; colors: ThemeColors }
  | { ok: false; errors: string[] }

export function normalizeColor(raw: string): string | null {
  const trimmed = raw.trim()
  const value = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  if (value.length !== 3 && value.length !== 6) return null

  for (const character of value) {
    const code = character.charCodeAt(0)
    const isDigit = code >= 48 && code <= 57
    const isLowerHex = code >= 97 && code <= 102
    const isUpperHex = code >= 65 && code <= 70
    if (!isDigit && !isLowerHex && !isUpperHex) return null
  }

  const lower = value.toLowerCase()
  if (lower.length === 6) return `#${lower}`
  return `#${lower[0]}${lower[0]}${lower[1]}${lower[1]}${lower[2]}${lower[2]}`
}

interface RawTheme {
  foreground?: unknown
  background?: unknown
  cursor?: unknown
  ansi: unknown[]
  errors: string[]
}

function emptyRawTheme(): RawTheme {
  return { ansi: new Array(16), errors: [] }
}

function parseJsonTheme(text: string): RawTheme | ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, errors: [`Invalid JSON: ${message}`] }
  }

  const root = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const nested = root.colors
  const source =
    typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : root
  const raw = emptyRawTheme()
  if ('foreground' in source) raw.foreground = source.foreground
  if ('background' in source) raw.background = source.background
  if ('cursor' in source) raw.cursor = source.cursor
  if (Array.isArray(source.ansi)) {
    for (let index = 0; index < 16; index += 1) {
      if (index in source.ansi) raw.ansi[index] = source.ansi[index]
    }
  }
  return raw
}

function isDecimalIndex(value: string): boolean {
  if (value.length === 0) return false
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 48 || code > 57) return false
  }
  return true
}

function parseGhosttyTheme(text: string): RawTheme {
  const raw = emptyRawTheme()
  const paletteIndexes = new Set<number>()

  for (const sourceLine of text.split('\n')) {
    const line = sourceLine.endsWith('\r') ? sourceLine.slice(0, -1) : sourceLine
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator < 0) {
      if (trimmed.startsWith('palette')) raw.errors.push(`Malformed palette line: ${trimmed}`)
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (key === 'foreground') raw.foreground = value
    else if (key === 'background') raw.background = value
    else if (key === 'cursor-color' || key === 'cursor') raw.cursor = value
    else if (key === 'palette') {
      const paletteSeparator = value.indexOf('=')
      if (paletteSeparator < 0) {
        raw.errors.push(`Malformed palette line: ${trimmed}`)
        continue
      }

      const indexText = value.slice(0, paletteSeparator).trim()
      if (!isDecimalIndex(indexText)) {
        raw.errors.push(`Malformed palette line: ${trimmed}`)
        continue
      }

      const index = Number(indexText)
      if (index > 15) continue
      if (paletteIndexes.has(index)) {
        raw.errors.push(`Duplicate palette ${index}`)
        continue
      }

      paletteIndexes.add(index)
      raw.ansi[index] = value.slice(paletteSeparator + 1).trim()
    }
  }

  return raw
}

function validateRawTheme(raw: RawTheme): ImportResult {
  const errors = [...raw.errors]

  const validateField = (field: string, value: unknown): string | null => {
    if (value === undefined) {
      errors.push(`Missing ${field}`)
      return null
    }

    const normalized = typeof value === 'string' ? normalizeColor(value) : null
    if (normalized === null) errors.push(`Invalid ${field}: ${String(value)}`)
    return normalized
  }

  const foreground = validateField('foreground', raw.foreground)
  const background = validateField('background', raw.background)
  const cursor = validateField('cursor', raw.cursor)
  const ansi = Array.from({ length: 16 }, (_, index) =>
    validateField(`palette ${index}`, raw.ansi[index]),
  )

  if (errors.length > 0 || foreground === null || background === null || cursor === null) {
    return { ok: false, errors }
  }

  return { ok: true, colors: { foreground, background, cursor, ansi: ansi as string[] } }
}

export function parseThemeFile(text: string): ImportResult {
  const trimmed = text.trim()
  const raw = trimmed.startsWith('{') ? parseJsonTheme(trimmed) : parseGhosttyTheme(text)
  if ('ok' in raw) return raw
  return validateRawTheme(raw)
}

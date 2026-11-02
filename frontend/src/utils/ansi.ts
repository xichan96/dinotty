/**
 * ANSI SGR parsing for log files.
 *
 * The parser only understands styling (SGR) sequences. Everything else that
 * looks like an escape sequence is stripped: cursor movement, erase, OSC
 * titles/hyperlinks, and so on are noise in a static log viewer. Segments are
 * returned as plain objects so callers can render them with `:style` — this
 * module never builds HTML.
 */

export interface AnsiStyle {
  color?: string
  backgroundColor?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

export interface AnsiSegment {
  text: string
  style: AnsiStyle
}

const ESC = '\u001b'
const BEL = '\u0007'

/** Default dark-theme palette, matching the log viewer surface. */
const BASIC_COLORS = [
  '#000000',
  '#cd3131',
  '#0dbc79',
  '#e5e510',
  '#2472c8',
  '#bc3fbc',
  '#11a8cd',
  '#e5e5e5',
]

const BRIGHT_COLORS = [
  '#666666',
  '#f14c4c',
  '#23d18b',
  '#f5f543',
  '#3b8eea',
  '#d670d6',
  '#29b8db',
  '#e5e5e5',
]

export const ANSI_DEFAULT_FG = '#d4d4d4'
export const ANSI_DEFAULT_BG = '#141414'

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.trunc(value)))
}

function rgbToHex(red: number, green: number, blue: number): string {
  const hex = (value: number) => clampByte(value).toString(16).padStart(2, '0')
  return `#${hex(red)}${hex(green)}${hex(blue)}`
}

/** Map an xterm 256-colour index to a CSS hex colour. */
export function colorFrom256(index: number): string {
  const n = clampByte(index)
  if (n < 8) return BASIC_COLORS[n]
  if (n < 16) return BRIGHT_COLORS[n - 8]
  if (n < 232) {
    const cube = n - 16
    const levels = [0, 95, 135, 175, 215, 255]
    return rgbToHex(
      levels[Math.floor(cube / 36)],
      levels[Math.floor((cube % 36) / 6)],
      levels[cube % 6]
    )
  }
  const gray = 8 + (n - 232) * 10
  return rgbToHex(gray, gray, gray)
}

function resetStyle(style: AnsiStyle): void {
  delete style.color
  delete style.backgroundColor
  delete style.bold
  delete style.dim
  delete style.italic
  delete style.underline
  delete style.inverse
}

/** Parse a SGR parameter list (the part between `ESC[` and `m`) into `style`. */
export function applySgr(style: AnsiStyle, params: string): void {
  const parts = (params === '' ? '0' : params).split(';').map((part) => {
    const value = Number.parseInt(part, 10)
    return Number.isNaN(value) ? 0 : value
  })

  for (let index = 0; index < parts.length; index += 1) {
    const code = parts[index]

    // Extended colours consume the following parameters themselves.
    if (code === 38 || code === 48) {
      const target = code === 38 ? 'color' : 'backgroundColor'
      const mode = parts[index + 1]
      if (mode === 5) {
        const paletteIndex = parts[index + 2]
        if (paletteIndex !== undefined) {
          style[target] = colorFrom256(paletteIndex)
          index += 2
        }
      } else if (mode === 2) {
        const red = parts[index + 2]
        const green = parts[index + 3]
        const blue = parts[index + 4]
        if (red !== undefined && green !== undefined && blue !== undefined) {
          style[target] = rgbToHex(red, green, blue)
          index += 4
        }
      } else if (mode !== undefined) {
        // Malformed extended colour: skip the mode byte only.
        index += 1
      }
      continue
    }

    if (code === 0) {
      resetStyle(style)
    } else if (code === 1) {
      style.bold = true
    } else if (code === 2) {
      style.dim = true
    } else if (code === 3) {
      style.italic = true
    } else if (code === 4) {
      style.underline = true
    } else if (code === 7) {
      style.inverse = true
    } else if (code === 22) {
      delete style.bold
      delete style.dim
    } else if (code === 23) {
      delete style.italic
    } else if (code === 24) {
      delete style.underline
    } else if (code === 27) {
      delete style.inverse
    } else if (code === 39) {
      delete style.color
    } else if (code === 49) {
      delete style.backgroundColor
    } else if (code >= 30 && code <= 37) {
      style.color = BASIC_COLORS[code - 30]
    } else if (code >= 90 && code <= 97) {
      style.color = BRIGHT_COLORS[code - 90]
    } else if (code >= 40 && code <= 47) {
      style.backgroundColor = BASIC_COLORS[code - 40]
    } else if (code >= 100 && code <= 107) {
      style.backgroundColor = BRIGHT_COLORS[code - 100]
    }
    // Unknown SGR codes are ignored.
  }
}

/**
 * Return the end index of the CSI sequence starting at `start` (which points at
 * `ESC`), or `input.length` when the sequence is unterminated.
 */
function csiEnd(input: string, start: number): number {
  let index = start + 2
  while (index < input.length) {
    const code = input.charCodeAt(index)
    if (code >= 0x40 && code <= 0x7e) return index + 1
    index += 1
  }
  return input.length
}

/** Return the end index of the OSC sequence starting at `start`. */
function oscEnd(input: string, start: number): number {
  let index = start + 2
  while (index < input.length) {
    if (input[index] === BEL) return index + 1
    if (input[index] === ESC && input[index + 1] === '\\') return index + 2
    index += 1
  }
  return input.length
}

/** Consume a non-CSI/OSC escape sequence, including intermediates. */
function escapeEnd(input: string, start: number): number {
  let index = start + 1
  while (index < input.length) {
    const code = input.charCodeAt(index)
    if (code >= 0x20 && code <= 0x2f) {
      index += 1
      continue
    }
    // Final byte (0x30-0x7e): consume it and stop.
    return index + 1
  }
  return input.length
}

/**
 * Split `input` into styled segments. Newlines stay in the segment text so
 * callers can split later; see `parseAnsiLines` for the common case.
 */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  const style: AnsiStyle = {}
  let text = ''
  let index = 0

  const flush = () => {
    if (text !== '') {
      segments.push({ text, style: { ...style } })
      text = ''
    }
  }

  while (index < input.length) {
    if (input[index] !== ESC) {
      text += input[index]
      index += 1
      continue
    }

    const kind = input[index + 1]
    if (kind === '[') {
      const end = csiEnd(input, index)
      const final = input[end - 1]
      if (final === 'm' && end > index + 2) {
        flush()
        applySgr(style, input.slice(index + 2, end - 1))
      } else if (final === 'm') {
        flush()
        applySgr(style, '')
      }
      index = end
      continue
    }

    if (kind === ']') {
      index = oscEnd(input, index)
      continue
    }

    if (kind === undefined) break
    index = escapeEnd(input, index)
  }

  flush()
  return segments
}

/**
 * Parse a multi-line ANSI string into one segment list per line. SGR state is
 * carried across newlines, which is how real logs behave; each segment is
 * clipped at line boundaries.
 */
export function parseAnsiLines(input: string): AnsiSegment[][] {
  const lines: AnsiSegment[][] = [[]]
  for (const segment of parseAnsi(input)) {
    const parts = segment.text.split('\n')
    for (let index = 0; index < parts.length; index += 1) {
      if (index > 0) lines.push([])
      if (parts[index] !== '') {
        lines[lines.length - 1].push({ text: parts[index], style: segment.style })
      }
    }
  }
  return lines
}

/** Resolve a parsed style to inline CSS properties. */
export function ansiStyleToCss(style: AnsiStyle): Record<string, string> {
  const css: Record<string, string> = {}
  let color = style.color
  let backgroundColor = style.backgroundColor

  if (style.inverse) {
    const foreground = backgroundColor ?? ANSI_DEFAULT_BG
    backgroundColor = color ?? ANSI_DEFAULT_FG
    color = foreground
  }

  if (color !== undefined) css.color = color
  if (backgroundColor !== undefined) css.backgroundColor = backgroundColor
  if (style.bold) css.fontWeight = '700'
  if (style.italic) css.fontStyle = 'italic'
  if (style.underline) css.textDecoration = 'underline'
  if (style.dim) css.opacity = '0.65'
  return css
}

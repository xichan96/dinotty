/**
 * JSON key tree with accurate source lines.
 *
 * `JSON.parse` validates the document (and gives us the browser's error
 * position); a small scanner then walks the already-valid text so every key
 * and array element carries its real 1-based line number. No dependency.
 */
import type { OutlineItem } from '../types/outline'

export interface JsonOutlineResult {
  items: OutlineItem[]
  errorLine?: number
  errorMessage?: string
}

class JsonScanError extends Error {
  constructor(
    message: string,
    readonly line: number
  ) {
    super(message)
    this.name = 'JsonScanError'
  }
}

function previewString(value: string): string {
  const clipped = value.length > 60 ? `${value.slice(0, 60)}…` : value
  return `"${clipped}"`
}

function errorLineOf(error: unknown, source: string): number {
  const message = error instanceof Error ? error.message : String(error)
  const lineMatch = /\(line (\d+) column \d+\)/i.exec(message) ?? /\bline (\d+)\b/i.exec(message)
  if (lineMatch) return Number(lineMatch[1])

  const positionMatch = /\bposition (\d+)\b/i.exec(message)
  if (!positionMatch) return 1

  const position = Number(positionMatch[1])
  let line = 1
  for (let i = 0; i < position && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++
  }
  return line
}

class JsonScanner {
  private index = 0
  private line = 1

  constructor(private readonly source: string) {}

  parseDocument(): OutlineItem[] {
    this.skipWhitespace()
    if (this.index >= this.source.length) return []

    const ch = this.source[this.index]
    if (ch === '{') return this.parseObject('$', '', this.line).children ?? []
    if (ch === '[') return this.parseArray('$', '', this.line).children ?? []

    this.parseScalar('$', 'value', this.line)
    return []
  }

  private parseValue(path: string, label: string, line: number): OutlineItem {
    this.skipWhitespace()
    const ch = this.source[this.index]
    if (ch === '{') return this.parseObject(path, label, line)
    if (ch === '[') return this.parseArray(path, label, line)
    return this.parseScalar(path, label, line)
  }

  private parseObject(path: string, label: string, line: number): OutlineItem {
    this.expect('{')
    const children: OutlineItem[] = []
    const seenKeys = new Map<string, number>()
    this.skipWhitespace()

    if (this.peek() === '}') {
      this.index++
      return { id: path, label, kind: 'object', line, value: '{0}', children }
    }

    while (true) {
      this.skipWhitespace()
      const keyLine = this.line
      const key = this.parseString()
      this.skipWhitespace()
      this.expect(':')
      this.skipWhitespace()
      // Duplicate keys are legal JSON (last one wins); suffix the id so the
      // tree still has unique keys for Vue.
      const occurrence = (seenKeys.get(key) ?? 0) + 1
      seenKeys.set(key, occurrence)
      const childPath = occurrence === 1 ? `${path}.${key}` : `${path}.${key}#${occurrence}`
      children.push(this.parseValue(childPath, key, keyLine))

      this.skipWhitespace()
      const ch = this.peek()
      if (ch === ',') {
        this.index++
        continue
      }
      if (ch === '}') {
        this.index++
        break
      }
      throw this.error('Expected "," or "}" in object')
    }

    return { id: path, label, kind: 'object', line, value: `{${children.length}}`, children }
  }

  private parseArray(path: string, label: string, line: number): OutlineItem {
    this.expect('[')
    const children: OutlineItem[] = []
    this.skipWhitespace()

    if (this.peek() === ']') {
      this.index++
      return { id: path, label, kind: 'array', line, value: '[0]', children }
    }

    let element = 0
    while (true) {
      this.skipWhitespace()
      const elementLine = this.line
      children.push(this.parseValue(`${path}[${element}]`, `[${element}]`, elementLine))
      element++

      this.skipWhitespace()
      const ch = this.peek()
      if (ch === ',') {
        this.index++
        continue
      }
      if (ch === ']') {
        this.index++
        break
      }
      throw this.error('Expected "," or "]" in array')
    }

    return { id: path, label, kind: 'array', line, value: `[${children.length}]`, children }
  }

  private parseScalar(path: string, label: string, line: number): OutlineItem {
    this.skipWhitespace()
    const ch = this.peek()
    if (ch === '"') {
      const value = this.parseString()
      return { id: path, label, kind: 'scalar', line, value: previewString(value) }
    }

    const start = this.index
    while (this.index < this.source.length) {
      const current = this.source[this.index]
      if (current === ',' || current === '}' || current === ']' || /\s/.test(current)) break
      this.index++
    }
    const raw = this.source.slice(start, this.index)
    return { id: path, label, kind: 'scalar', line, value: raw }
  }

  private parseString(): string {
    this.expect('"')
    const start = this.index

    while (this.index < this.source.length) {
      const ch = this.source[this.index]
      if (ch === '\\') {
        this.index += 2
        continue
      }
      if (ch === '"') {
        const raw = this.source.slice(start, this.index)
        this.index++
        try {
          return JSON.parse(`"${raw}"`) as string
        } catch {
          return raw
        }
      }
      if (ch === '\n') this.line++
      this.index++
    }

    throw this.error('Unterminated string')
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length) {
      const ch = this.source[this.index]
      if (ch === '\n') {
        this.line++
        this.index++
        continue
      }
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.index++
        continue
      }
      break
    }
  }

  private peek(): string {
    return this.source[this.index] ?? ''
  }

  private expect(ch: string): void {
    if (this.source[this.index] !== ch) throw this.error(`Expected "${ch}"`)
    this.index++
  }

  private error(message: string): JsonScanError {
    return new JsonScanError(message, this.line)
  }
}

export function parseJsonOutline(rawSource: string): JsonOutlineResult {
  // A UTF-8 BOM is common in config files and would make JSON.parse fail.
  const source = rawSource.charCodeAt(0) === 0xfeff ? rawSource.slice(1) : rawSource
  if (!source.trim()) return { items: [] }

  try {
    JSON.parse(source)
  } catch (error) {
    return {
      items: [],
      errorLine: errorLineOf(error, source),
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    return { items: new JsonScanner(source).parseDocument() }
  } catch (error) {
    return {
      items: [],
      errorLine: error instanceof JsonScanError ? error.line : 1,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

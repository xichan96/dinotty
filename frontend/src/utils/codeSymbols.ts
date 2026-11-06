/**
 * Conservative regex extraction of top-level code declarations.
 *
 * This is the fallback path until a Monaco document-symbol provider can be
 * reached (standalone Monaco 0.55 has no public
 * `executeDocumentSymbolProvider`). The result is deliberately shallow:
 * top-level only, no type resolution, no macro expansion.
 */
import type { OutlineItem, OutlineKind } from '../types/outline'

export type CodeLanguage = 'typescript' | 'javascript' | 'rust' | 'python' | 'go'

const LANGUAGE_ALIASES: Record<string, CodeLanguage> = {
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  typescriptreact: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  javascript: 'javascript',
  javascriptreact: 'javascript',
  rs: 'rust',
  rust: 'rust',
  py: 'python',
  pyi: 'python',
  python: 'python',
  go: 'go',
  golang: 'go',
}

export function normalizeCodeLanguage(language: string | null | undefined): CodeLanguage | null {
  if (!language) return null
  return LANGUAGE_ALIASES[language.trim().toLowerCase()] ?? null
}

/**
 * Replaceable entry point for a future Monaco provider. A collector returns
 * `null` to fall back to the regex extractor.
 */
export type DocumentSymbolCollector = (
  source: string,
  language: CodeLanguage
) => OutlineItem[] | null

let documentSymbolCollector: DocumentSymbolCollector | null = null

export function setDocumentSymbolCollector(collector: DocumentSymbolCollector | null): void {
  documentSymbolCollector = collector
}

export function collectDocumentSymbols(source: string, language: string): OutlineItem[] {
  const codeLanguage = normalizeCodeLanguage(language)
  if (!codeLanguage) return []
  if (documentSymbolCollector) {
    const items = documentSymbolCollector(source, codeLanguage)
    if (items) return items
  }
  return regexDocumentSymbols(source, codeLanguage)
}

export function regexDocumentSymbols(source: string, language: CodeLanguage): OutlineItem[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return scanTypeScript(source, language)
    case 'rust':
      return scanRust(source)
    case 'python':
      return scanPython(source)
    case 'go':
      return scanGo(source)
  }
}

function makeItem(
  language: CodeLanguage,
  label: string,
  kind: OutlineKind,
  line: number
): OutlineItem {
  return { id: `${language}:${label}:${line}`, label, kind, line }
}

function findUnescaped(line: string, quote: string, start: number): number {
  for (let i = start; i < line.length; i++) {
    if (line[i] === '\\') {
      i++
      continue
    }
    if (line[i] === quote) return i
  }
  return -1
}

/* ── TypeScript / JavaScript ─────────────────────────────────────────────── */

interface JsScanState {
  block: boolean
  quote: string | null
}

function scanJsLine(line: string, state: JsScanState): { code: string; braces: number } {
  let code = ''
  let braces = 0
  let i = 0

  while (i < line.length) {
    if (state.block) {
      const end = line.indexOf('*/', i)
      if (end < 0) return { code, braces }
      state.block = false
      i = end + 2
      code += ' '
      continue
    }
    if (state.quote) {
      const end = findUnescaped(line, state.quote, i)
      if (end < 0) return { code, braces }
      state.quote = null
      i = end + 1
      code += ' '
      continue
    }

    const ch = line[i]
    if (ch === '/' && line[i + 1] === '/') break
    if (ch === '/' && line[i + 1] === '*') {
      state.block = true
      i += 2
      code += ' '
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = findUnescaped(line, ch, i + 1)
      if (end < 0) {
        state.quote = ch
        return { code, braces }
      }
      i = end + 1
      code += ' '
      continue
    }

    code += ch
    if (ch === '{') braces++
    else if (ch === '}') braces--
    i++
  }

  return { code, braces }
}

const TS_PATTERNS: Array<{ re: RegExp; kind: OutlineKind; call?: boolean }> = [
  {
    re: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    kind: 'class',
  },
  {
    re: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/,
    kind: 'interface',
  },
  {
    re: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,
    kind: 'type',
  },
  {
    re: /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/,
    kind: 'type',
  },
  {
    re: /^\s*(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$]*)/,
    kind: 'type',
  },
  {
    re: /^\s*(?:export\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    kind: 'function',
    call: true,
  },
  {
    re: /^\s*(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/,
    kind: 'const',
  },
]

function scanTypeScript(source: string, language: CodeLanguage): OutlineItem[] {
  const items: OutlineItem[] = []
  const state: JsScanState = { block: false, quote: null }
  let depth = 0

  source.split('\n').forEach((line, index) => {
    const scanned = scanJsLine(line, state)
    if (depth === 0) {
      for (const pattern of TS_PATTERNS) {
        const match = pattern.re.exec(scanned.code)
        if (!match) continue
        const label = pattern.call ? `${match[1]}()` : match[1]
        items.push(makeItem(language, label, pattern.kind, index + 1))
        break
      }
    }
    depth = Math.max(0, depth + scanned.braces)
  })

  return items
}

/* ── Rust ────────────────────────────────────────────────────────────────── */

interface RustScanState {
  block: boolean
  quote: string | null
}

function isRustCharLiteral(line: string, index: number): boolean {
  if (line[index + 1] === '\\') return true
  return line[index + 2] === "'"
}

function rustRawStringEnd(line: string, index: number): number {
  if (index > 0 && /[A-Za-z0-9_]/.test(line[index - 1])) return -1
  let cursor = index
  while (line[cursor] === 'b' || line[cursor] === 'r') cursor++
  let hashes = 0
  while (line[cursor] === '#') {
    hashes++
    cursor++
  }
  if (line[cursor] !== '"') return -1
  const close = '"' + '#'.repeat(hashes)
  const end = line.indexOf(close, cursor + 1)
  return end < 0 ? -1 : end + close.length
}

function scanRustLine(line: string, state: RustScanState): { code: string; braces: number } {
  let code = ''
  let braces = 0
  let i = 0

  while (i < line.length) {
    if (state.block) {
      const end = line.indexOf('*/', i)
      if (end < 0) return { code, braces }
      state.block = false
      i = end + 2
      code += ' '
      continue
    }
    if (state.quote) {
      const end = findUnescaped(line, state.quote, i)
      if (end < 0) return { code, braces }
      state.quote = null
      i = end + 1
      code += ' '
      continue
    }

    const ch = line[i]
    if (ch === '/' && line[i + 1] === '/') break
    if (ch === '/' && line[i + 1] === '*') {
      state.block = true
      i += 2
      code += ' '
      continue
    }
    if (ch === 'r' || ch === 'b') {
      const rawEnd = rustRawStringEnd(line, i)
      if (rawEnd > i) {
        i = rawEnd
        code += ' '
        continue
      }
    }
    if (ch === '"' || (ch === "'" && isRustCharLiteral(line, i))) {
      const end = findUnescaped(line, ch, i + 1)
      if (end < 0) {
        state.quote = ch
        return { code, braces }
      }
      i = end + 1
      code += ' '
      continue
    }

    code += ch
    if (ch === '{') braces++
    else if (ch === '}') braces--
    i++
  }

  return { code, braces }
}

const RUST_PATTERNS: Array<{ re: RegExp; kind: OutlineKind; call?: boolean }> = [
  {
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/,
    kind: 'function',
    call: true,
  },
  {
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/,
    kind: 'class',
  },
  {
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/,
    kind: 'type',
  },
  {
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/,
    kind: 'interface',
  },
  {
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?impl(?:<[^>]*>)?\s+(.+?)\s*\{/,
    kind: 'class',
  },
  {
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/,
    kind: 'property',
  },
  {
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(?:mut\s+)?([A-Za-z_]\w*)/,
    kind: 'const',
  },
  {
    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/,
    kind: 'type',
  },
]

function scanRust(source: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const state: RustScanState = { block: false, quote: null }
  let depth = 0

  source.split('\n').forEach((line, index) => {
    const scanned = scanRustLine(line, state)
    if (depth === 0) {
      for (const pattern of RUST_PATTERNS) {
        const match = pattern.re.exec(scanned.code)
        if (!match) continue
        const name = match[1].trim()
        items.push(makeItem('rust', name + (pattern.call ? '()' : ''), pattern.kind, index + 1))
        break
      }
    }
    depth = Math.max(0, depth + scanned.braces)
  })

  return items
}

/* ── Python ──────────────────────────────────────────────────────────────── */

interface PythonScanState {
  triple: string | null
}

function scanPythonLine(
  line: string,
  state: PythonScanState
): { code: string; state: PythonScanState } {
  let code = ''
  let triple = state.triple
  let i = 0

  while (i < line.length) {
    if (triple) {
      const end = line.indexOf(triple, i)
      if (end < 0) return { code, state: { triple } }
      i = end + 3
      triple = null
      code += ' '
      continue
    }

    const ch = line[i]
    if (ch === '#') break
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      triple = line.slice(i, i + 3)
      i += 3
      code += ' '
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = findUnescaped(line, ch, i + 1)
      if (end < 0) {
        code += line.slice(i)
        break
      }
      i = end + 1
      code += ' '
      continue
    }

    code += ch
    i++
  }

  return { code, state: { triple } }
}

const PYTHON_DEF = /^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/
const PYTHON_CLASS = /^([ \t]*)class\s+([A-Za-z_]\w*)/
const PYTHON_ASSIGN = /^([A-Za-z_]\w*)\s*(?::\s*[^=\n]+)?=(?!=)/

function scanPython(source: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const state: PythonScanState = { triple: null }

  source.split('\n').forEach((line, index) => {
    const scanned = scanPythonLine(line, state)
    state.triple = scanned.state.triple
    const code = scanned.code
    if (!code.trim() || /^[ \t]/.test(code)) return

    const def = PYTHON_DEF.exec(code)
    if (def) {
      items.push(makeItem('python', `${def[2]}()`, 'function', index + 1))
      return
    }
    const cls = PYTHON_CLASS.exec(code)
    if (cls) {
      items.push(makeItem('python', cls[2], 'class', index + 1))
      return
    }
    const assign = PYTHON_ASSIGN.exec(code)
    if (assign) items.push(makeItem('python', assign[1], 'const', index + 1))
  })

  return items
}

/* ── Go ──────────────────────────────────────────────────────────────────── */

interface GoScanState {
  block: boolean
  quote: string | null
}

function scanGoLine(line: string, state: GoScanState): { code: string; braces: number } {
  let code = ''
  let braces = 0
  let i = 0

  while (i < line.length) {
    if (state.block) {
      const end = line.indexOf('*/', i)
      if (end < 0) return { code, braces }
      state.block = false
      i = end + 2
      code += ' '
      continue
    }
    if (state.quote) {
      const end = state.quote === '`' ? line.indexOf('`', i) : findUnescaped(line, state.quote, i)
      if (end < 0) return { code, braces }
      state.quote = null
      i = end + 1
      code += ' '
      continue
    }

    const ch = line[i]
    if (ch === '/' && line[i + 1] === '/') break
    if (ch === '/' && line[i + 1] === '*') {
      state.block = true
      i += 2
      code += ' '
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = ch === '`' ? line.indexOf('`', i + 1) : findUnescaped(line, ch, i + 1)
      if (end < 0) {
        state.quote = ch
        return { code, braces }
      }
      i = end + 1
      code += ' '
      continue
    }

    code += ch
    if (ch === '{') braces++
    else if (ch === '}') braces--
    i++
  }

  return { code, braces }
}

const GO_FUNC =
  /^func\s*(?:\(\s*(?:[A-Za-z_]\w*\s+)?\*?([A-Za-z_]\w*)\s*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(/
const GO_TYPE = /^type\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*(struct|interface)\b/
const GO_TYPE_ALIAS = /^type\s+([A-Za-z_]\w*)/
const GO_CONST = /^const\s+([A-Za-z_]\w*)/
const GO_VAR = /^var\s+([A-Za-z_]\w*)/

function scanGo(source: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const state: GoScanState = { block: false, quote: null }
  let depth = 0
  let group: 'const' | 'var' | 'type' | null = null

  source.split('\n').forEach((line, index) => {
    const scanned = scanGoLine(line, state)
    const code = scanned.code
    const trimmed = code.trim()

    if (group) {
      if (/^\)/.test(trimmed)) {
        group = null
      } else if (trimmed) {
        if (group === 'type') {
          const typed = /^\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*(struct|interface)\b/.exec(code)
          if (typed) {
            items.push(
              makeItem('go', typed[1], typed[2] === 'interface' ? 'interface' : 'class', index + 1)
            )
          } else {
            const alias = /^\s*([A-Za-z_]\w*)/.exec(code)
            if (alias) items.push(makeItem('go', alias[1], 'type', index + 1))
          }
        } else {
          const entry = /^\s*([A-Za-z_]\w*)/.exec(code)
          if (entry) {
            items.push(
              makeItem('go', entry[1], group === 'const' ? 'const' : 'property', index + 1)
            )
          }
        }
      }
      depth = Math.max(0, depth + scanned.braces)
      return
    }

    if (depth === 0 && trimmed) {
      if (/^(?:const|var|type)\s*\(\s*$/.test(trimmed)) {
        group = trimmed.startsWith('const') ? 'const' : trimmed.startsWith('var') ? 'var' : 'type'
      } else {
        const fn = GO_FUNC.exec(trimmed)
        if (fn) {
          const receiver = fn[1]
          const label = receiver ? `${receiver}.${fn[2]}()` : `${fn[2]}()`
          items.push(makeItem('go', label, receiver ? 'method' : 'function', index + 1))
        } else {
          const typed = GO_TYPE.exec(trimmed)
          if (typed) {
            items.push(
              makeItem('go', typed[1], typed[2] === 'interface' ? 'interface' : 'class', index + 1)
            )
          } else {
            const alias = GO_TYPE_ALIAS.exec(trimmed)
            if (alias) items.push(makeItem('go', alias[1], 'type', index + 1))
            else {
              const constant = GO_CONST.exec(trimmed)
              if (constant) items.push(makeItem('go', constant[1], 'const', index + 1))
              else {
                const variable = GO_VAR.exec(trimmed)
                if (variable) items.push(makeItem('go', variable[1], 'property', index + 1))
              }
            }
          }
        }
      }
    }

    depth = Math.max(0, depth + scanned.braces)
  })

  return items
}

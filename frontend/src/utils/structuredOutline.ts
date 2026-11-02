/**
 * Key trees for structured configuration files: JSON, YAML and TOML.
 *
 * JSON reuses `parseJsonOutline`; YAML walks the `yaml` AST (which carries
 * source ranges) and TOML walks the `toml-eslint-parser` AST (which carries
 * `loc` on every node). Both produce the same `OutlineItem` shape the JSON
 * scanner does, so the outline panel does not need per-format rendering.
 */
import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseAllDocuments,
  type Document,
  type Node,
  type Pair,
} from 'yaml'
import { ParseError, parseTOML, type AST } from 'toml-eslint-parser'
import type { OutlineItem } from '../types/outline'
import { parseJsonOutline } from './jsonOutline'

export type StructuredFormat = 'json' | 'yaml' | 'toml'

export interface StructuredOutlineResult {
  items: OutlineItem[]
  errorLine?: number
  errorMessage?: string
}

/** Defensive caps for alias-heavy YAML and pathological inline values. */
const MAX_DEPTH = 32
const MAX_NODES = 4000

export function structuredFormatForLanguage(
  language: string | null | undefined
): StructuredFormat | null {
  switch ((language ?? '').trim().toLowerCase()) {
    case 'json':
      return 'json'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'toml':
      return 'toml'
    default:
      return null
  }
}

export function parseStructuredOutline(
  text: string,
  format: StructuredFormat
): StructuredOutlineResult {
  if (format === 'json') return parseJsonOutline(text)

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (!source.trim()) return { items: [] }
  return format === 'yaml' ? parseYamlOutline(source) : parseTomlOutline(source)
}

/* ── shared previews ─────────────────────────────────────────────────────── */

function previewString(value: string): string {
  const clipped = value.length > 60 ? `${value.slice(0, 60)}…` : value
  return JSON.stringify(clipped)
}

function previewValue(value: unknown): string {
  if (typeof value === 'string') return previewString(value)
  if (value === null || value === undefined) return 'null'
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/* ── YAML ────────────────────────────────────────────────────────────────── */

function parseYamlOutline(source: string): StructuredOutlineResult {
  const lineCounter = new LineCounter()
  let docs: ReturnType<typeof parseAllDocuments>
  try {
    // `parseAllDocuments` keeps a multi-document stream from becoming a hard
    // error; the outline currently shows the first document only.
    docs = parseAllDocuments(source, { lineCounter })
  } catch (error) {
    return { items: [], errorLine: 1, errorMessage: errorText(error) }
  }

  if (docs.length === 0) return { items: [] }

  const doc = docs[0]
  if (doc.errors.length > 0) {
    const error = doc.errors[0]
    return {
      items: [],
      errorLine: error.linePos?.[0]?.line ?? 1,
      errorMessage: error.message,
    }
  }

  try {
    return { items: buildYamlItems(doc, (offset) => lineCounter.linePos(offset).line) }
  } catch (error) {
    return { items: [], errorLine: 1, errorMessage: errorText(error) }
  }
}

function buildYamlItems(doc: Document, lineFor: (offset: number) => number): OutlineItem[] {
  const contents = doc.contents
  if (!contents) return []

  let budget = MAX_NODES
  const visiting = new Set<Node>()

  function spend(): boolean {
    if (budget <= 0) return false
    budget--
    return true
  }

  function lineOf(node: unknown, fallback: number): number {
    if (!isNode(node)) return fallback
    const offset = node.range?.[0]
    return typeof offset === 'number' ? lineFor(offset) : fallback
  }

  /** Resolve aliases, refusing alias-to-alias cycles. */
  function resolve(node: Node): Node | null {
    let current: Node = node
    const seen = new Set<Node>()
    while (isAlias(current)) {
      if (seen.has(current)) return null
      seen.add(current)
      const target = current.resolve(doc)
      if (!target) return null
      current = target
    }
    return current
  }

  function keyInfo(pair: Pair, fallback: number): { label: string; line: number } {
    if (isScalar(pair.key)) {
      return {
        label: pair.key.value == null ? 'null' : String(pair.key.value),
        line: lineOf(pair.key, fallback),
      }
    }
    return { label: '?', line: lineOf(pair.key, fallback) }
  }

  function buildValue(
    node: Node | null | undefined,
    id: string,
    label: string,
    line: number,
    depth: number
  ): OutlineItem | null {
    if (!spend()) return null
    if (node == null) return { id, label, kind: 'scalar', line, value: 'null' }

    const value = resolve(node)
    if (!value) {
      const source = isAlias(node) ? node.source : String(node)
      return { id, label, kind: 'scalar', line, value: `*${source}` }
    }

    if (isScalar(value)) {
      return { id, label, kind: 'scalar', line, value: previewValue(value.value) }
    }

    if (visiting.has(value)) {
      // An alias pointing back at an ancestor: mark it instead of recursing.
      return { id, label, kind: 'scalar', line, value: '<circular>' }
    }

    if (isMap(value)) {
      const item: OutlineItem = {
        id,
        label,
        kind: 'object',
        line,
        value: `{${value.items.length}}`,
      }
      if (depth >= MAX_DEPTH) return item
      visiting.add(value)
      item.children = mapChildren(value, id, line, depth)
      visiting.delete(value)
      item.value = `{${item.children.length}}`
      return item
    }

    if (isSeq(value)) {
      const item: OutlineItem = { id, label, kind: 'array', line, value: `[${value.items.length}]` }
      if (depth >= MAX_DEPTH) return item
      visiting.add(value)
      item.children = seqChildren(value, id, line, depth)
      visiting.delete(value)
      item.value = `[${item.children.length}]`
      return item
    }

    return { id, label, kind: 'scalar', line, value: previewValue(String(value)) }
  }

  function mapChildren(
    map: { items: Pair[] },
    parentId: string,
    fallbackLine: number,
    depth: number
  ): OutlineItem[] {
    const children: OutlineItem[] = []
    const seenKeys = new Map<string, number>()
    for (const pair of map.items) {
      const key = keyInfo(pair, fallbackLine)
      const occurrence = (seenKeys.get(key.label) ?? 0) + 1
      seenKeys.set(key.label, occurrence)
      const suffix = occurrence === 1 ? '' : `#${occurrence}`
      const child = buildValue(
        pair.value as Node | null,
        `${parentId}.${key.label}${suffix}`,
        key.label,
        key.line,
        depth + 1
      )
      if (!child) break
      children.push(child)
    }
    return children
  }

  function seqChildren(
    seq: { items: unknown[] },
    parentId: string,
    fallbackLine: number,
    depth: number
  ): OutlineItem[] {
    const children: OutlineItem[] = []
    for (let index = 0; index < seq.items.length; index++) {
      const element = seq.items[index]
      const child = buildValue(
        element as Node | null,
        `${parentId}[${index}]`,
        `[${index}]`,
        lineOf(element, fallbackLine),
        depth + 1
      )
      if (!child) break
      children.push(child)
    }
    return children
  }

  const root = resolve(contents)
  if (!root) return []
  if (isMap(root)) {
    if (visiting.has(root)) return []
    visiting.add(root)
    const items = mapChildren(root, '$', 1, 0)
    visiting.delete(root)
    return items
  }
  if (isSeq(root)) {
    if (visiting.has(root)) return []
    visiting.add(root)
    const items = seqChildren(root, '$', 1, 0)
    visiting.delete(root)
    return items
  }
  return []
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/* ── TOML ────────────────────────────────────────────────────────────────── */

interface RawItem {
  id: string
  label: string
  kind: 'object' | 'array' | 'scalar'
  line: number
  value?: string
  children: RawItem[]
  /** Child lookup for map nodes; arrays are indexed by `children`. */
  index?: Map<string, RawItem>
}

function newMap(id: string, label: string, line: number): RawItem {
  return { id, label, kind: 'object', line, children: [], index: new Map() }
}

function newArray(id: string, label: string, line: number): RawItem {
  return { id, label, kind: 'array', line, children: [] }
}

function parseTomlOutline(source: string): StructuredOutlineResult {
  let program: AST.TOMLProgram
  try {
    program = parseTOML(source)
  } catch (error) {
    if (error instanceof ParseError) {
      return { items: [], errorLine: error.lineNumber, errorMessage: error.message }
    }
    return { items: [], errorLine: 1, errorMessage: errorText(error) }
  }

  try {
    return { items: buildTomlItems(program) }
  } catch (error) {
    return { items: [], errorLine: 1, errorMessage: errorText(error) }
  }
}

function buildTomlItems(program: AST.TOMLProgram): OutlineItem[] {
  const root = newMap('$', '', 1)
  const state = { budget: MAX_NODES }
  const top = program.body[0]
  let current = root

  for (const statement of top.body) {
    if (statement.type === 'TOMLKeyValue') {
      insertKeyValue(current, statement, 0, state)
      continue
    }

    const line = statement.loc.start.line
    const resolved = statement.resolvedKey
    if (resolved.length === 0) continue

    if (statement.kind === 'array') {
      // `resolvedKey` for `[[a.b]]` is `['a', <index>, 'b', <index>]`; the
      // array node itself is the key before the final element index.
      const parent = ensurePath(root, resolved.slice(0, -2), line, state)
      const last = resolved[resolved.length - 2]
      if (typeof last !== 'string') continue
      let array = parent.index?.get(last)
      if (!array || array.kind !== 'array') {
        array = newArray(`${parent.id}.${last}`, last, line)
        parent.children.push(array)
        parent.index?.set(last, array)
      }
      if (!spend(state)) break
      const index = array.children.length
      const element = newMap(`${array.id}[${index}]`, `[${index}]`, line)
      array.children.push(element)
      current = element
    } else {
      current = ensurePath(root, resolved, line, state)
      // The declaration line is the most precise position for a table node.
      current.line = line
    }

    // Key-values of a table live on the table node, not as top-level siblings.
    for (const pair of statement.body) insertKeyValue(current, pair, 0, state)
  }

  return root.children.map(finalizeRaw)
}

/** Walk an already-resolved key path, creating map nodes as needed. */
function ensurePath(
  start: RawItem,
  path: (string | number)[],
  line: number,
  state: { budget: number }
): RawItem {
  let current = start
  for (const key of path) {
    if (typeof key === 'number') {
      const child = current.children[key]
      if (!child) return current
      current = child
      continue
    }
    let child = current.index?.get(key)
    if (!child) {
      if (!spend(state)) return current
      child = newMap(`${current.id}.${key}`, key, line)
      current.children.push(child)
      current.index?.set(key, child)
    }
    current = child
  }
  return current
}

function keyNames(key: AST.TOMLKey): string[] {
  return key.keys.map((part) => (part.type === 'TOMLBare' ? part.name : part.value))
}

function insertKeyValue(
  container: RawItem,
  pair: AST.TOMLKeyValue,
  depth: number,
  state: { budget: number }
): void {
  const keys = keyNames(pair.key)
  if (keys.length === 0) return
  const line = pair.key.loc.start.line
  const parent =
    keys.length === 1 ? container : ensurePath(container, keys.slice(0, -1), line, state)
  if (!parent.index) return
  const last = keys[keys.length - 1]
  if (parent.index.has(last)) return
  const child = toRawValue(pair.value, `${parent.id}.${last}`, last, line, depth, state)
  parent.children.push(child)
  parent.index.set(last, child)
}

function toRawValue(
  value: AST.TOMLContentNode,
  id: string,
  label: string,
  line: number,
  depth: number,
  state: { budget: number }
): RawItem {
  if (!spend(state)) return { id, label, kind: 'scalar', line, value: '…', children: [] }

  if (value.type === 'TOMLArray') {
    const item = newArray(id, label, line)
    item.value = `[${value.elements.length}]`
    if (depth >= MAX_DEPTH) return item
    for (let index = 0; index < value.elements.length; index++) {
      const element = value.elements[index]
      item.children.push(
        toRawValue(
          element,
          `${id}[${index}]`,
          `[${index}]`,
          element.loc.start.line,
          depth + 1,
          state
        )
      )
    }
    return item
  }

  if (value.type === 'TOMLInlineTable') {
    const item = newMap(id, label, line)
    item.value = `{${value.body.length}}`
    if (depth >= MAX_DEPTH) return item
    for (const pair of value.body) insertKeyValue(item, pair, depth + 1, state)
    item.value = `{${item.children.length}}`
    return item
  }

  return { id, label, kind: 'scalar', line, value: previewTomlScalar(value), children: [] }
}

function previewTomlScalar(value: AST.TOMLValue): string {
  switch (value.kind) {
    case 'string':
      return previewString(value.value)
    case 'integer':
    case 'float':
      return value.number
    case 'boolean':
      return String(value.value)
    default:
      return value.datetime
  }
}

function spend(state: { budget: number }): boolean {
  if (state.budget <= 0) return false
  state.budget--
  return true
}

function finalizeRaw(raw: RawItem): OutlineItem {
  if (raw.kind === 'scalar') {
    return { id: raw.id, label: raw.label, kind: 'scalar', line: raw.line, value: raw.value }
  }
  const children = raw.children.map(finalizeRaw)
  return {
    id: raw.id,
    label: raw.label,
    kind: raw.kind,
    line: raw.line,
    value: raw.kind === 'object' ? `{${children.length}}` : `[${children.length}]`,
    children,
  }
}

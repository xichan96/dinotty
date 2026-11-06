/**
 * Outline extraction through the Monaco TypeScript language worker.
 *
 * `monaco.languages.typescript.getTypeScriptWorker` is public (though typed as
 * deprecated in 0.55), and the worker exposes `getNavigationTree`, which is the
 * same tree VS Code uses for "Go to Symbol in File". This module only consumes
 * that public surface: it never imports compiler internals or pokes at the
 * document-symbol provider registry.
 *
 * The worker runs in a web worker and can hang on a cold start, so every call
 * is bounded by a timeout and returns `null` on any failure. Callers fall back
 * to the synchronous regex extractor.
 */
import type { OutlineItem, OutlineKind } from '../types/outline'

/** The subset of `monaco.languages.typescript` we need, typed structurally. */
export interface TypeScriptLanguageApi {
  getTypeScriptWorker?: () => Promise<(...uris: unknown[]) => Promise<TypeScriptWorkerLike>>
  getJavaScriptWorker?: () => Promise<(...uris: unknown[]) => Promise<TypeScriptWorkerLike>>
}

export interface MonacoSymbolsApi {
  languages?: {
    typescript?: TypeScriptLanguageApi
  }
}

export interface TypeScriptWorkerLike {
  getNavigationTree(fileName: string): Promise<unknown>
}

/** A `monaco.Position`-shaped value; only the line number matters here. */
export interface MonacoSymbolPosition {
  lineNumber: number
}

/** The subset of `monaco.editor.ITextModel` used for offset -> line mapping. */
export interface MonacoSymbolModel {
  getPositionAt(offset: number): MonacoSymbolPosition
  getLanguageId?(): string
  getVersionId(): number
  uri?: { toString(): string }
}

/** A `typescript.NavigationTree` node, reduced to the fields we read. */
export interface NavigationTree {
  text?: string
  kind?: string
  spans?: Array<{ start: number }>
  childItems?: NavigationTree[]
}

export interface MonacoSymbolsOptions {
  /** Language used in item ids; defaults to the model language. */
  language?: string
  /** Maximum nesting of emitted items (top-level items are depth 1). */
  maxDepth?: number
  /** Hard cap on emitted items. */
  maxItems?: number
}

const DEFAULT_MAX_DEPTH = 8
const DEFAULT_MAX_ITEMS = 4000
const DEFAULT_TIMEOUT_MS = 2500

const KNOWN_KINDS = new Set<OutlineKind>([
  'class',
  'interface',
  'function',
  'method',
  'property',
  'const',
  'type',
  'object',
])

/** TS kinds with a direct equivalent; everything else becomes `property`. */
export function outlineKindForMonacoKind(kind: string | undefined): OutlineKind {
  const value = (kind ?? '').toLowerCase() as OutlineKind
  return KNOWN_KINDS.has(value) ? value : 'property'
}

/** The synthetic file node TS wraps every navigation tree in. */
function isSyntheticRoot(node: NavigationTree): boolean {
  return node.kind === 'script' || node.kind === 'module'
}

interface MapBudget {
  remaining: number
  usedIds: Map<string, number>
  language: string
}

function mapNode(
  node: NavigationTree,
  model: MonacoSymbolModel,
  depth: number,
  maxDepth: number,
  budget: MapBudget
): OutlineItem | null {
  if (budget.remaining <= 0 || depth >= maxDepth) return null

  const label = (node.text ?? '').trim()
  if (!label || label === '<unknown>') return null

  const start = node.spans?.[0]?.start
  const line = Number.isFinite(start) ? model.getPositionAt(start as number).lineNumber : 1

  const baseId = `${budget.language}:${label}:${line}`
  const seen = budget.usedIds.get(baseId) ?? 0
  budget.usedIds.set(baseId, seen + 1)
  const id = seen === 0 ? baseId : `${baseId}#${seen + 1}`

  budget.remaining--

  const item: OutlineItem = {
    id,
    label,
    kind: outlineKindForMonacoKind(node.kind),
    line,
  }

  if (depth + 1 < maxDepth) {
    const children: OutlineItem[] = []
    for (const child of node.childItems ?? []) {
      const mapped = mapNode(child, model, depth + 1, maxDepth, budget)
      if (mapped) children.push(mapped)
      if (budget.remaining <= 0) break
    }
    if (children.length > 0) item.children = children
  }

  return item
}

/**
 * Convert a TS `NavigationTree` into outline items.
 *
 * The synthetic `script`/`module` root is unwrapped, labels are trimmed, empty
 * and `<unknown>` entries are dropped, ids are `language:label:line` with a
 * `#n` suffix for duplicates, and traversal is bounded by depth and item caps.
 */
export function navigationTreeToOutline(
  root: NavigationTree | null | undefined,
  model: MonacoSymbolModel,
  options: MonacoSymbolsOptions = {}
): OutlineItem[] {
  if (!root) return []

  const maxDepth = Math.max(1, options.maxDepth ?? DEFAULT_MAX_DEPTH)
  const maxItems = Math.max(1, options.maxItems ?? DEFAULT_MAX_ITEMS)
  const language = options.language ?? model.getLanguageId?.() ?? 'typescript'
  const budget: MapBudget = { remaining: maxItems, usedIds: new Map(), language }

  const nodes = isSyntheticRoot(root) ? (root.childItems ?? []) : [root]
  const items: OutlineItem[] = []
  for (const node of nodes) {
    const mapped = mapNode(node, model, 0, maxDepth, budget)
    if (mapped) items.push(mapped)
    if (budget.remaining <= 0) break
  }
  return items
}

function workerGetterFor(
  api: MonacoSymbolsApi | null | undefined,
  language: string
): (() => Promise<(...uris: unknown[]) => Promise<TypeScriptWorkerLike>>) | null {
  const ts = api?.languages?.typescript
  if (!ts) return null
  if (language.startsWith('javascript')) {
    return ts.getJavaScriptWorker ?? ts.getTypeScriptWorker ?? null
  }
  return ts.getTypeScriptWorker ?? null
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export interface CollectTypeScriptSymbolsOptions {
  /** Normalized code language; used for ids and to pick the JS/TS worker. */
  language?: string
  /** Give up (return `null`) after this many milliseconds. */
  timeoutMs?: number
}

/**
 * Fetch a file outline from Monaco's TypeScript service.
 *
 * Returns `null` when the API is unavailable, the worker rejects/hangs, or it
 * yields no usable navigation tree. The caller then uses the regex fallback.
 */
export async function collectTypeScriptSymbols(
  api: MonacoSymbolsApi | null | undefined,
  model: MonacoSymbolModel | null | undefined,
  options: CollectTypeScriptSymbolsOptions = {}
): Promise<OutlineItem[] | null> {
  if (!api || !model || !model.uri) return null

  const language = options.language ?? model.getLanguageId?.() ?? 'typescript'
  const getWorker = workerGetterFor(api, language)
  if (!getWorker) return null

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fileName = model.uri.toString()

  const task = (async () => {
    const workerFactory = await getWorker()
    const worker = await workerFactory(model.uri as unknown)
    const tree = await worker.getNavigationTree(fileName)
    if (!tree || typeof tree !== 'object') return null
    return navigationTreeToOutline(tree as NavigationTree, model, { language })
  })().catch(() => null)

  return withTimeout(task, timeoutMs)
}

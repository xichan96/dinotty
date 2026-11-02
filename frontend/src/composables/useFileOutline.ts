/**
 * Aggregate a file's outline source: Markdown headings (from the preview's
 * lexer pass), top-level code symbols (regex fallback) or a JSON key tree.
 *
 * Results are cached per content version and code/JSON scans are debounced so
 * typing a large file does not re-scan on every keystroke. Code/JSON parsing
 * prefers a Web Worker and falls back to the synchronous builder when workers
 * are unavailable, fail, or time out.
 */
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'
import type { OutlineItem, OutlineMode, OutlineSource } from '../types/outline'
import { normalizeCodeLanguage } from '../utils/codeSymbols'
import {
  buildOutlineSync,
  type OutlineWorkerMode,
  type OutlineWorkerReply,
  type OutlineWorkerRequest,
} from '../utils/outlineBuild'

export interface UseFileOutlineOptions {
  kind: MaybeRefOrGetter<string | null | undefined>
  language: MaybeRefOrGetter<string | null | undefined>
  text: MaybeRefOrGetter<string>
  /** Heading items produced by the same `marked.lexer` pass as the preview. */
  markdownTokens?: MaybeRefOrGetter<OutlineItem[] | null | undefined>
  /** Source text that produced `markdownTokens`; a mismatch means stale. */
  markdownTokensSource?: MaybeRefOrGetter<string | undefined>
  /**
   * Monaco TypeScript symbols for TS/JS files. When non-null the code outline
   * uses them instead of the regex scan; `null` falls back to regex.
   */
  codeSymbols?: MaybeRefOrGetter<OutlineItem[] | null | undefined>
  /** Debounce for code/JSON scans. Markdown is already debounced upstream. */
  debounceMs?: number
  /** Injection seam for tests; return `null` to force the synchronous path. */
  createWorker?: () => Worker | null
}

export function outlineModeFor(
  kind: string | null | undefined,
  language: string | null | undefined
): OutlineMode {
  if (kind === 'markdown') return 'markdown'
  const tag = (language ?? '').trim().toLowerCase()
  if (tag === 'json') return 'json'
  return normalizeCodeLanguage(tag) ? 'code' : 'none'
}

const EMPTY_SOURCE: OutlineSource = {
  mode: 'none',
  items: [],
  status: 'empty',
  loading: false,
}

/** Give up on the worker and scan synchronously after this long. */
const WORKER_TIMEOUT_MS = 2000

function createOutlineWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('../workers/outline.worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    return null
  }
}

interface ActiveRequest {
  id: number
  key: string
  mode: OutlineWorkerMode
  language: string | null
  text: string
  timer: ReturnType<typeof setTimeout>
}

export function useFileOutline(options: UseFileOutlineOptions) {
  const mode = computed(() => outlineModeFor(toValue(options.kind), toValue(options.language)))
  const source = ref<OutlineSource>({ ...EMPTY_SOURCE })
  const debounceMs = options.debounceMs ?? 220
  const createWorker = options.createWorker ?? createOutlineWorker

  let timer: ReturnType<typeof setTimeout> | null = null
  let cacheKey = ''
  let cached: OutlineSource | null = null

  let worker: Worker | null = null
  let workerUnavailable = false
  let requestSeq = 0
  let active: ActiveRequest | null = null

  function keyFor(): string {
    return `${mode.value}\u0000${toValue(options.language) ?? ''}\u0000${toValue(options.text)}`
  }

  function buildLocal(): OutlineSource {
    const current = mode.value
    if (current === 'none') return { ...EMPTY_SOURCE }

    const text = toValue(options.text) ?? ''
    if (current === 'markdown') {
      const tokens = toValue(options.markdownTokens)
      if (tokens == null) {
        return { mode: current, items: [], status: 'ok', loading: true, provider: 'lexer' }
      }
      const tokensSource = toValue(options.markdownTokensSource)
      const loading = typeof tokensSource === 'string' && tokensSource !== text
      return {
        mode: current,
        items: tokens,
        status: tokens.length > 0 ? 'ok' : 'empty',
        loading,
        provider: 'lexer',
      }
    }

    const monacoItems = toValue(options.codeSymbols)
    if (current === 'code' && monacoItems != null) {
      const language = normalizeCodeLanguage(toValue(options.language))
      return {
        mode: current,
        items: monacoItems,
        status: monacoItems.length > 0 ? 'ok' : 'empty',
        loading: false,
        provider: 'monaco',
        language: language ?? undefined,
      }
    }

    return buildOutlineSync({ mode: current, language: toValue(options.language), text })
  }

  function finish(key: string, next: OutlineSource): void {
    if (!next.loading) {
      cacheKey = key
      cached = next
    }
    if (key === keyFor()) source.value = next
  }

  function cancelActive(): void {
    if (!active) return
    clearTimeout(active.timer)
    active = null
  }

  function disableWorker(): void {
    workerUnavailable = true
    const current = worker
    worker = null
    if (!current) return
    try {
      current.terminate()
    } catch {
      // A worker that cannot terminate is already unusable.
    }
  }

  function fallback(request: ActiveRequest): void {
    finish(
      request.key,
      buildOutlineSync({
        mode: request.mode,
        language: request.language,
        text: request.text,
      })
    )
  }

  function onWorkerMessage(reply: OutlineWorkerReply): void {
    if (!active || !reply || reply.id !== active.id) return
    const request = active
    cancelActive()
    if (!reply.source || typeof reply.source !== 'object') {
      disableWorker()
      fallback(request)
      return
    }
    finish(request.key, reply.source)
  }

  function onWorkerTimeout(id: number): void {
    if (!active || active.id !== id) return
    const request = active
    cancelActive()
    disableWorker()
    fallback(request)
  }

  function onWorkerFailure(): void {
    const request = active
    cancelActive()
    disableWorker()
    if (request) fallback(request)
  }

  function ensureWorker(): Worker | null {
    if (workerUnavailable) return null
    if (worker) return worker
    try {
      const created = createWorker()
      if (!created) {
        workerUnavailable = true
        return null
      }
      created.onmessage = (event: MessageEvent<OutlineWorkerReply>) =>
        onWorkerMessage(event.data)
      created.onerror = () => onWorkerFailure()
      worker = created
      return created
    } catch {
      workerUnavailable = true
      return null
    }
  }

  /** Returns true when the request was handed to a worker. */
  function requestBuild(key: string): boolean {
    const current = mode.value
    if (current !== 'code' && current !== 'json') return false
    const created = ensureWorker()
    if (!created) return false

    cancelActive()
    const id = ++requestSeq
    const request: ActiveRequest = {
      id,
      key,
      mode: current,
      language: toValue(options.language) ?? null,
      text: toValue(options.text) ?? '',
      timer: setTimeout(() => onWorkerTimeout(id), WORKER_TIMEOUT_MS),
    }
    active = request

    const message: OutlineWorkerRequest = {
      id: request.id,
      mode: request.mode,
      language: request.language,
      text: request.text,
    }
    try {
      created.postMessage(message)
    } catch {
      cancelActive()
      disableWorker()
      fallback(request)
    }
    return true
  }

  function commit(): void {
    // Monaco results arrive pre-debounced and can change without a text change
    // (a stale result discarded then refilled), so recompute rather than cache.
    if (mode.value === 'code' && toValue(options.codeSymbols) != null) {
      source.value = buildLocal()
      return
    }
    const key = keyFor()
    if (cached && cacheKey === key) {
      source.value = { ...cached }
      return
    }
    if (requestBuild(key)) return
    finish(key, buildLocal())
  }

  function schedule(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    const current = mode.value
    if (current === 'none' || current === 'markdown') {
      commit()
      return
    }
    if (current === 'code' && toValue(options.codeSymbols) != null) {
      commit()
      return
    }

    // A reply for the previous text must not land while the new scan debounces.
    cancelActive()

    const key = keyFor()
    if (cached && cacheKey === key) {
      source.value = { ...cached, loading: false }
      return
    }

    source.value = {
      mode: current,
      items: source.value.mode === current ? source.value.items : [],
      status: 'ok',
      loading: true,
      provider: current === 'json' ? 'json' : 'regex',
      language: normalizeCodeLanguage(toValue(options.language)) ?? undefined,
    }
    timer = setTimeout(() => {
      timer = null
      commit()
    }, debounceMs)
  }

  function rescan(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    cancelActive()
    cacheKey = ''
    cached = null
    commit()
  }

  watch(
    [
      () => toValue(options.kind),
      () => toValue(options.language),
      () => toValue(options.text),
      () => toValue(options.markdownTokens),
      () => toValue(options.markdownTokensSource),
      () => toValue(options.codeSymbols),
    ],
    schedule,
    { immediate: true, flush: 'post' }
  )

  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      cancelActive()
      disableWorker()
    })
  }

  return { source, mode, rescan }
}

/**
 * Aggregate a file's outline source: Markdown headings (from the preview's
 * lexer pass), top-level code symbols (regex fallback) or a JSON key tree.
 *
 * Results are cached per content version and code/JSON scans are debounced so
 * typing a large file does not re-scan on every keystroke.
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
import {
  isStructuredMode,
  type OutlineItem,
  type OutlineMode,
  type OutlineSource,
} from '../types/outline'
import { collectDocumentSymbols, normalizeCodeLanguage } from '../utils/codeSymbols'
import { parseJsonOutline } from '../utils/jsonOutline'
import { parseStructuredOutline, structuredFormatForLanguage } from '../utils/structuredOutline'

export interface UseFileOutlineOptions {
  kind: MaybeRefOrGetter<string | null | undefined>
  language: MaybeRefOrGetter<string | null | undefined>
  text: MaybeRefOrGetter<string>
  /** Heading items produced by the same `marked.lexer` pass as the preview. */
  markdownTokens?: MaybeRefOrGetter<OutlineItem[] | null | undefined>
  /** Source text that produced `markdownTokens`; a mismatch means stale. */
  markdownTokensSource?: MaybeRefOrGetter<string | undefined>
  /** Debounce for code/JSON scans. Markdown is already debounced upstream. */
  debounceMs?: number
}

export function outlineModeFor(
  kind: string | null | undefined,
  language: string | null | undefined
): OutlineMode {
  if (kind === 'markdown') return 'markdown'
  const tag = (language ?? '').trim().toLowerCase()
  const structured = structuredFormatForLanguage(tag)
  if (structured) return structured
  return normalizeCodeLanguage(tag) ? 'code' : 'none'
}

const EMPTY_SOURCE: OutlineSource = {
  mode: 'none',
  items: [],
  status: 'empty',
  loading: false,
}

export function useFileOutline(options: UseFileOutlineOptions) {
  const mode = computed(() => outlineModeFor(toValue(options.kind), toValue(options.language)))
  const source = ref<OutlineSource>({ ...EMPTY_SOURCE })
  const debounceMs = options.debounceMs ?? 220

  let timer: ReturnType<typeof setTimeout> | null = null
  let cacheKey = ''
  let cached: OutlineSource | null = null

  function keyFor(): string {
    return `${mode.value}\u0000${toValue(options.language) ?? ''}\u0000${toValue(options.text)}`
  }

  function build(): OutlineSource {
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

    if (isStructuredMode(current)) {
      // JSON keeps its dedicated provider; YAML/TOML share the structured one.
      const provider = current === 'json' ? 'json' : 'structured'
      const result =
        current === 'json' ? parseJsonOutline(text) : parseStructuredOutline(text, current)
      if (result.errorLine !== undefined) {
        return {
          mode: current,
          items: [],
          status: 'error',
          loading: false,
          provider,
          message: result.errorMessage,
          errorLine: result.errorLine,
        }
      }
      return {
        mode: current,
        items: result.items,
        status: result.items.length > 0 ? 'ok' : 'empty',
        loading: false,
        provider,
      }
    }

    const language = normalizeCodeLanguage(toValue(options.language))
    const items = language ? collectDocumentSymbols(text, language) : []
    return {
      mode: current,
      items,
      status: items.length > 0 ? 'ok' : 'empty',
      loading: false,
      provider: 'regex',
      language: language ?? undefined,
    }
  }

  function commit(): void {
    const key = keyFor()
    if (cached && cacheKey === key) {
      source.value = { ...cached }
      return
    }
    const next = build()
    if (!next.loading) {
      cacheKey = key
      cached = next
    }
    source.value = next
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
      provider: isStructuredMode(current) ? (current === 'json' ? 'json' : 'structured') : 'regex',
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
    })
  }

  return { source, mode, rescan }
}

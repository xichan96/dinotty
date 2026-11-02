/**
 * Debounced, staleness-guarded fetch of Monaco TypeScript symbols for the
 * outline panel.
 *
 * Monaco's language service lives in a worker and is only meaningful while the
 * editor is open on the same file revision, so results are discarded when the
 * model version, file path, language or pane generation changed while the
 * worker was busy. Any failure leaves `symbols` at `null`, which lets
 * `useFileOutline` fall back to the regex scan.
 */
import {
  getCurrentScope,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'
import { whenEditorReady } from './useEditorRegistry'
import {
  collectTypeScriptSymbols,
  type MonacoSymbolModel,
  type MonacoSymbolsApi,
} from '../utils/monacoSymbols'
import type { OutlineItem } from '../types/outline'

export type MonacoOutlineLanguage = 'typescript' | 'javascript'

export interface UseMonacoOutlineSymbolsOptions {
  /** Editor registry key for the pane that owns the Monaco model. */
  leafId: string
  /** Usually `outlineOpen`: no work while the panel is closed. */
  enabled: MaybeRefOrGetter<boolean>
  /** Only `typescript`/`javascript` run; anything else clears the result. */
  language: MaybeRefOrGetter<MonacoOutlineLanguage | null | undefined>
  /** Guards against applying results after switching files. */
  filePath: MaybeRefOrGetter<string | null | undefined>
  /** Change this (e.g. the live editor text) to request a refresh. */
  revision: MaybeRefOrGetter<unknown>
  debounceMs?: number
  /** Test seam for resolving the Monaco namespace. */
  loadApi?: () => Promise<MonacoSymbolsApi | null | undefined>
}

async function loadMonacoApi(): Promise<MonacoSymbolsApi | null> {
  const api = await import('monaco-editor')
  return api as unknown as MonacoSymbolsApi
}

export function useMonacoOutlineSymbols(options: UseMonacoOutlineSymbolsOptions) {
  const symbols = ref<OutlineItem[] | null>(null)
  const debounceMs = options.debounceMs ?? 300
  const loadApi = options.loadApi ?? loadMonacoApi

  let timer: ReturnType<typeof setTimeout> | null = null
  // Bumped on every cancel/clear and every scheduled run; only the run holding
  // the current token may publish its result.
  let generation = 0

  function eligible(): boolean {
    const language = toValue(options.language)
    return toValue(options.enabled) === true && (language === 'typescript' || language === 'javascript')
  }

  function cancel(): void {
    generation++
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function clear(): void {
    cancel()
    symbols.value = null
  }

  async function run(
    token: number,
    path: string | null | undefined,
    language: MonacoOutlineLanguage
  ): Promise<void> {
    const editor = await whenEditorReady(options.leafId)
    if (token !== generation || !eligible() || toValue(options.filePath) !== path) return

    const model = editor.getModel() as MonacoSymbolModel | null
    if (!model) return

    let api: MonacoSymbolsApi | null
    try {
      api = (await loadApi()) ?? null
    } catch {
      api = null
    }
    if (token !== generation || !eligible() || toValue(options.filePath) !== path) return

    // Capture right before the worker call: edits during the round-trip make
    // the tree stale even though the request still resolves.
    const version = model.getVersionId()
    const items = await collectTypeScriptSymbols(api, model, { language })
    if (token !== generation || !eligible() || toValue(options.filePath) !== path) return
    if (model.getVersionId() !== version) return

    symbols.value = items
  }

  function schedule(): void {
    if (!eligible()) {
      clear()
      return
    }
    if (timer) clearTimeout(timer)
    const token = ++generation
    const path = toValue(options.filePath)
    const language = toValue(options.language) as MonacoOutlineLanguage
    timer = setTimeout(() => {
      timer = null
      void run(token, path, language)
    }, debounceMs)
  }

  // File/language/pane changes invalidate existing symbols immediately and
  // hand the outline back to the regex scan until new results land.
  watch(
    [
      () => toValue(options.enabled),
      () => toValue(options.language),
      () => toValue(options.filePath),
    ],
    () => {
      clear()
      schedule()
    },
    { immediate: true, flush: 'post' }
  )

  // Keystrokes only refresh the result; the previous one stays visible until
  // the debounced worker call replaces it.
  watch(() => toValue(options.revision), schedule)

  if (getCurrentScope()) onScopeDispose(clear)

  return { symbols, refresh: schedule }
}

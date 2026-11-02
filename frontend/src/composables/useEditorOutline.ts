/**
 * Outline panel state and scroll-spy for one editor pane.
 *
 * The toggle and active row are per pane; the width is global and owned by
 * OutlinePanel (localStorage). Scroll-spy drives `outlineActiveId` from the
 * rendered Markdown preview or from Monaco's visible range.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type * as monaco from 'monaco-editor'
import { isEditableTextKind } from './useFileEditor'
import { useFileOutline } from './useFileOutline'
import { useMonacoOutlineSymbols } from './useMonacoOutlineSymbols'
import { whenEditorReady } from './useEditorRegistry'
import { normalizeCodeLanguage } from '../utils/codeSymbols'
import { flattenOutline, outlineAtLine } from '../utils/outlineTree'
import type { OutlineItem, OutlineMode } from '../types/outline'

const OUTLINE_READING_OFFSET = 88
const OUTLINE_SUPPRESS_MS = 1200
const OUTLINE_MOBILE_QUERY = '(max-width: 720px)'

export interface EditorOutlineMeta {
  kind?: string | null
  language?: string | null
}

export interface EditorOutlinePreviewContent {
  mdPreviewEl?: HTMLElement | null
}

export interface UseEditorOutlineOptions {
  leafId: string
  t: (key: string) => string
  meta: Ref<EditorOutlineMeta | null>
  activeFilePath: Ref<string | null>
  previewContentRef: Ref<EditorOutlinePreviewContent | null>
  editorText: Ref<string>
  mdShowPreview: Ref<boolean>
  markdownOutline: Ref<OutlineItem[] | null>
  markdownOutlineSource: Ref<string>
}

export function useEditorOutline(opts: UseEditorOutlineOptions) {
  const outlineOpen = ref(false)
  const outlineActiveId = ref('')
  const outlineMobile = ref(false)
  const outlinePanelId = computed(() => `outline-panel-${opts.leafId}`)

  const outlineLanguage = computed(() => opts.meta.value?.language ?? '')

  // Only TS/JS get Monaco's navigation tree; Rust/Python/Go and non-code files
  // keep the regex extractor. The composable handles debounce, worker timeouts
  // and discarding results whose model version or file changed mid-flight.
  const monacoSymbolLanguage = computed<'typescript' | 'javascript' | null>(() => {
    if (!isEditableTextKind(opts.meta.value?.kind)) return null
    const language = normalizeCodeLanguage(opts.meta.value?.language)
    return language === 'typescript' || language === 'javascript' ? language : null
  })
  const { symbols: monacoSymbols, refresh: refreshMonacoSymbols } = useMonacoOutlineSymbols({
    leafId: opts.leafId,
    enabled: outlineOpen,
    language: monacoSymbolLanguage,
    filePath: opts.activeFilePath,
    revision: opts.editorText,
  })

  const { source: outlineSource, rescan: rescanFileOutline } = useFileOutline({
    kind: computed(() => opts.meta.value?.kind ?? null),
    language: outlineLanguage,
    text: opts.editorText,
    markdownTokens: opts.markdownOutline,
    markdownTokensSource: opts.markdownOutlineSource,
    codeSymbols: monacoSymbols,
  })

  /** Retry from the panel: re-scan the regex source and refetch Monaco symbols. */
  function rescanOutline(): void {
    rescanFileOutline()
    refreshMonacoSymbols()
  }

  const outlineAvailable = computed(
    () => isEditableTextKind(opts.meta.value?.kind) && outlineSource.value.mode !== 'none'
  )
  const outlinePanelMode = computed<Exclude<OutlineMode, 'none'>>(() =>
    outlineSource.value.mode === 'none' ? 'code' : outlineSource.value.mode
  )

  const outlineLanguageLabel = computed(() => {
    if (outlineSource.value.mode === 'markdown') return opts.t('outline.typeMarkdown')
    if (outlineSource.value.mode === 'json') return opts.t('outline.typeJson')
    if (outlineSource.value.mode === 'yaml') return opts.t('outline.typeYaml')
    if (outlineSource.value.mode === 'toml') return opts.t('outline.typeToml')
    const labels: Record<string, string> = {
      typescript: 'TypeScript',
      javascript: 'JavaScript',
      rust: 'Rust',
      python: 'Python',
      go: 'Go',
    }
    const language = outlineSource.value.language
    return language ? (labels[language] ?? language) : opts.t('outline.typeCode')
  })

  const outlineFlat = computed(() => flattenOutline(outlineSource.value.items))
  const outlineAnchorIds = computed(() => {
    const ids = new Map<string, string>()
    for (const entry of outlineFlat.value) {
      if (entry.item.anchor) ids.set(entry.item.anchor, entry.item.id)
    }
    return ids
  })

  let outlineMediaQuery: MediaQueryList | null = null
  let outlineSpyToken = 0
  let outlineSpyRaf = 0
  let disposeOutlineSpy: (() => void) | null = null
  let outlineSpySuppressedUntil = 0
  let outlineFlashTimer: ReturnType<typeof setTimeout> | null = null
  let outlineFlashEl: HTMLElement | null = null

  function syncOutlineMobile(): void {
    outlineMobile.value = outlineMediaQuery?.matches ?? false
  }

  function toggleOutline(): void {
    outlineOpen.value = !outlineOpen.value
  }

  function stopOutlineSpy(): void {
    outlineSpyToken++
    if (outlineSpyRaf) {
      cancelAnimationFrame(outlineSpyRaf)
      outlineSpyRaf = 0
    }
    if (disposeOutlineSpy) {
      disposeOutlineSpy()
      disposeOutlineSpy = null
    }
  }

  function setOutlineActive(id: string): void {
    if (id && outlineActiveId.value !== id) outlineActiveId.value = id
  }

  function computePreviewSpy(scroller: HTMLElement): void {
    if (!outlineOpen.value || performance.now() < outlineSpySuppressedUntil) return
    const threshold = scroller.getBoundingClientRect().top + OUTLINE_READING_OFFSET
    const headings = scroller.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
    let active = ''
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].getBoundingClientRect().top > threshold) break
      const mapped = outlineAnchorIds.value.get(headings[i].id)
      if (mapped) active = mapped
    }
    if (!active) {
      for (let i = 0; i < headings.length; i++) {
        const mapped = outlineAnchorIds.value.get(headings[i].id)
        if (mapped) {
          active = mapped
          break
        }
      }
    }
    setOutlineActive(active)
  }

  function computeSourceSpy(monacoEditor: monaco.editor.IStandaloneCodeEditor): void {
    if (!outlineOpen.value || performance.now() < outlineSpySuppressedUntil) return
    const topLine = monacoEditor.getVisibleRanges()[0]?.startLineNumber ?? 1
    const item = outlineAtLine(outlineFlat.value, topLine) ?? outlineFlat.value[0]?.item
    if (item) setOutlineActive(item.id)
  }

  function schedulePreviewSpy(scroller: HTMLElement): void {
    if (outlineSpyRaf) return
    outlineSpyRaf = requestAnimationFrame(() => {
      outlineSpyRaf = 0
      computePreviewSpy(scroller)
    })
  }

  function scheduleSourceSpy(monacoEditor: monaco.editor.IStandaloneCodeEditor): void {
    if (outlineSpyRaf) return
    outlineSpyRaf = requestAnimationFrame(() => {
      outlineSpyRaf = 0
      computeSourceSpy(monacoEditor)
    })
  }

  function setupOutlineSpy(): void {
    stopOutlineSpy()
    if (!outlineOpen.value || !outlineAvailable.value) return

    if (opts.mdShowPreview.value && opts.meta.value?.kind === 'markdown') {
      const scroller = opts.previewContentRef.value?.mdPreviewEl ?? null
      if (!scroller) return
      const onScroll = () => schedulePreviewSpy(scroller)
      scroller.addEventListener('scroll', onScroll, { passive: true })
      disposeOutlineSpy = () => scroller.removeEventListener('scroll', onScroll)
      computePreviewSpy(scroller)
      return
    }

    const token = outlineSpyToken
    void whenEditorReady(opts.leafId).then((monacoEditor) => {
      if (token !== outlineSpyToken || !outlineOpen.value) return
      const onScroll = () => scheduleSourceSpy(monacoEditor)
      const disposable = monacoEditor.onDidScrollChange(onScroll)
      disposeOutlineSpy = () => disposable.dispose()
      computeSourceSpy(monacoEditor)
    })
  }

  function prefersReducedMotion(): boolean {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  }

  function flashOutlineTarget(element: HTMLElement): void {
    if (outlineFlashEl) outlineFlashEl.classList.remove('outline-target-flash')
    if (outlineFlashTimer) clearTimeout(outlineFlashTimer)
    void element.offsetWidth
    element.classList.add('outline-target-flash')
    outlineFlashEl = element
    outlineFlashTimer = setTimeout(() => {
      element.classList.remove('outline-target-flash')
      if (outlineFlashEl === element) outlineFlashEl = null
      outlineFlashTimer = null
    }, 1300)
  }

  function onOutlineReveal(item: OutlineItem): void {
    outlineActiveId.value = item.id
    outlineSpySuppressedUntil = performance.now() + OUTLINE_SUPPRESS_MS

    if (opts.meta.value?.kind === 'markdown' && opts.mdShowPreview.value) {
      const scroller = opts.previewContentRef.value?.mdPreviewEl ?? null
      if (!scroller || !item.anchor) return
      const target = Array.from(
        scroller.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
      ).find((heading) => heading.id === item.anchor)
      if (!target) return
      const top =
        scroller.scrollTop +
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        26
      scroller.scrollTo({
        top: Math.max(0, top),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
      flashOutlineTarget(target)
      return
    }

    const path = opts.activeFilePath.value
    void whenEditorReady(opts.leafId).then((monacoEditor) => {
      if (opts.activeFilePath.value !== path) return
      const model = monacoEditor.getModel()
      const line = Math.max(1, Math.min(item.line, model?.getLineCount() ?? item.line))
      monacoEditor.revealLineInCenter(line)
      monacoEditor.setPosition({ lineNumber: line, column: 1 })
      monacoEditor.focus()
    })
  }

  watch(
    [
      outlineOpen,
      outlineAvailable,
      () => opts.mdShowPreview.value,
      () => opts.meta.value?.kind,
      () => opts.activeFilePath.value,
      () => outlineSource.value.items,
    ],
    () => void nextTick(setupOutlineSpy),
    { flush: 'post' }
  )

  onMounted(() => {
    if (typeof window.matchMedia === 'function') {
      outlineMediaQuery = window.matchMedia(OUTLINE_MOBILE_QUERY)
      syncOutlineMobile()
      outlineMediaQuery.addEventListener?.('change', syncOutlineMobile)
    }
  })

  onBeforeUnmount(() => {
    stopOutlineSpy()
    if (outlineFlashTimer) clearTimeout(outlineFlashTimer)
    outlineMediaQuery?.removeEventListener?.('change', syncOutlineMobile)
  })

  return {
    outlineOpen,
    outlineActiveId,
    outlineMobile,
    outlinePanelId,
    outlineAvailable,
    outlinePanelMode,
    outlineLanguageLabel,
    outlineSource,
    toggleOutline,
    rescanOutline,
    onOutlineReveal,
  }
}

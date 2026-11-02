import { ref, computed, watch, type Ref } from 'vue'
import { getApiBase, apiUrl, authFetch, getAuthToken } from './apiBase'
import { isTauri } from './useTransport'
import { loadKatex } from './markdownEnhance'
import { esc, renderMarkdownCode } from '../utils/markdownCode'
import { outlineFromMarkedTokens } from '../utils/markdownOutline'
import type { OutlineItem } from '../types/outline'

export { esc }

/** File kinds that Monaco edits as text (HTML included: it has a source view
 *  and can be saved back, unlike media/office/pdf). */
export function isEditableTextKind(kind: string | null | undefined): boolean {
  return kind === 'text' || kind === 'markdown' || kind === 'html'
}

interface Meta {
  kind: string
  content?: string
  language?: string
  truncated?: boolean
  message?: string
}

// Lazy-loaded heavy libraries
let _markedPromise: Promise<typeof import('marked')> | null = null
let _domPurifyPromise: Promise<typeof import('dompurify')> | null = null

export function getMarked() {
  if (!_markedPromise) {
    // KaTeX rides along with marked so inline `$…$` / `$$…$$` is parsed in
    // the same lazy chunk; ```math fences are rendered after sanitizing.
    _markedPromise = Promise.all([import('marked'), loadKatex(), import('marked-katex-extension')]).then(
      ([m, , katexExtension]) => {
        m.use({
          gfm: true,
          breaks: true,
          renderer: {
            code: renderMarkdownCode,
          },
        })
        m.use(katexExtension.default({ throwOnError: false }))
        return m
      }
    )
  }
  return _markedPromise
}

/** Resolve a relative image path against the markdown file's directory */
function resolveImagePath(relPath: string, filePath: string): string {
  if (/^(https?:\/\/|data:|blob:)/.test(relPath)) return relPath
  const baseDir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
  const parts = (baseDir ? baseDir + '/' + relPath : relPath).split('/')
  const resolved: string[] = []
  for (const p of parts) {
    if (p === '.' || p === '') continue
    if (p === '..') resolved.pop()
    else resolved.push(p)
  }
  return resolved.join('/')
}

/** Rewrite relative <img src> in rendered HTML to /api/workspace/raw URLs */
function rewriteImageSrcs(html: string, filePath: string, paneId: string): string {
  return html.replace(/<img\b([^>]*?)\ssrc=(["'])(.+?)\2/gi, (_match, prefix, quote, src) => {
    if (/^(https?:\/\/|\/api\/workspace\/raw)/.test(src))
      return `<img${prefix} src=${quote}${src}${quote}`
    const resolved = resolveImagePath(src, filePath)
    const q = new URLSearchParams({ pane_id: paneId, path: resolved })
    if (isTauri()) {
      const token = getAuthToken()
      if (token) q.set('token', token)
    }
    return `<img${prefix} src=${quote}${apiUrl(`/api/workspace/raw?${q}`)}${quote}`
  })
}

export function getDOMPurify() {
  if (!_domPurifyPromise) _domPurifyPromise = import('dompurify')
  return _domPurifyPromise
}

export function useFileEditor(opts: {
  paneId: () => string
  selectedRel: Ref<string | null>
  selectedIsDir: Ref<boolean>
  meta: Ref<Meta | null>
}) {
  const editorText = ref('')
  const editorBaseline = ref('')
  const mdShowPreview = ref(false)
  const htmlShowPreview = ref(false)
  const markdownEditorHtml = ref('')
  /** Heading tree from the same lexer pass; `null` until the first scan lands. */
  const markdownOutline = ref<OutlineItem[] | null>(null)
  /** Buffer text the heading tree was produced from. */
  const markdownOutlineSource = ref('')
  const editorSelection = ref<{ text: string; rect: DOMRect | null } | null>(null)

  const editorDirty = computed(() => editorText.value !== editorBaseline.value)

  const canSaveEditorContext = computed(
    () =>
      !!opts.selectedRel.value &&
      !opts.selectedIsDir.value &&
      !opts.meta.value?.truncated &&
      isEditableTextKind(opts.meta.value?.kind)
  )

  const canSaveEditor = computed(() => canSaveEditorContext.value && editorDirty.value)

  // Markdown rendering with debounce
  let mdDebounceTimer: ReturnType<typeof setTimeout> | null = null

  watch(editorText, (src) => {
    if (mdDebounceTimer) {
      clearTimeout(mdDebounceTimer)
      mdDebounceTimer = null
    }
    if (!src) {
      markdownEditorHtml.value = ''
      markdownOutline.value = []
      markdownOutlineSource.value = ''
      return
    }
    mdDebounceTimer = setTimeout(async () => {
      try {
        const [m, dp] = await Promise.all([getMarked(), getDOMPurify()])
        // Lex once: the parser consumes the same token list, and the heading
        // outline keeps the source offsets without a second full parse.
        const tokens = m.lexer(src)
        const outline = outlineFromMarkedTokens(tokens)
        let html = m.parser(tokens) as string
        const filePath = opts.selectedRel.value
        if (filePath) html = rewriteImageSrcs(html, filePath, opts.paneId())
        markdownEditorHtml.value = dp.default.sanitize(html)
        // The buffer may have changed while the async imports were resolving.
        if (editorText.value === src) {
          markdownOutline.value = outline
          markdownOutlineSource.value = src
        }
      } catch {
        markdownEditorHtml.value = ''
        if (editorText.value === src) {
          markdownOutline.value = []
          markdownOutlineSource.value = src
        }
      }
    }, 300)
  })

  /**
   * PUT the active buffer. Returns the snapshot that was saved so the caller
   * can commit the baseline to the right tab — the active tab may change while
   * the request is in flight, and writing the response into whatever tab is
   * active by then would clear another tab's dirty flag.
   */
  async function saveEditor(): Promise<{ filePath: string; content: string } | null> {
    if (!canSaveEditor.value || !opts.selectedRel.value) return null
    const filePath = opts.selectedRel.value
    const content = editorText.value
    await getApiBase()
    const q = new URLSearchParams({ pane_id: opts.paneId(), path: filePath })
    const res = await authFetch(apiUrl(`/api/workspace/file?${q}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) return null
    return { filePath, content }
  }

  /** Drop the heading tree when switching tabs, before the new lexer pass lands. */
  function clearMarkdownOutline() {
    markdownOutline.value = null
    markdownOutlineSource.value = ''
  }

  function resetEditor() {
    editorText.value = ''
    editorBaseline.value = ''
    mdShowPreview.value = false
    htmlShowPreview.value = false
    editorSelection.value = null
    clearMarkdownOutline()
  }

  function onEditorSelectionChange(payload: { text: string; rect: DOMRect | null }) {
    if (payload.text && payload.rect) {
      editorSelection.value = payload
    } else {
      editorSelection.value = null
    }
  }

  function onSelectionDismiss() {
    editorSelection.value = null
  }

  return {
    editorText,
    editorBaseline,
    mdShowPreview,
    htmlShowPreview,
    markdownEditorHtml,
    markdownOutline,
    markdownOutlineSource,
    editorSelection,
    editorDirty,
    canSaveEditorContext,
    canSaveEditor,
    saveEditor,
    resetEditor,
    clearMarkdownOutline,
    onEditorSelectionChange,
    onSelectionDismiss,
  }
}

/** Factory alias — use this when creating independent editor instances per pane */
export const createFileEditor = useFileEditor

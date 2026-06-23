import { ref, computed, watch, type Ref } from 'vue'
import { getApiBase, apiUrl, authFetch } from './apiBase'

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

export function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function getMarked() {
  if (!_markedPromise) {
    _markedPromise = import('marked').then((m) => {
      m.use({
        gfm: true,
        breaks: true,
        renderer: {
          code({ text, lang }: { text: string; lang?: string }) {
            const language = (lang || 'plaintext').trim() || 'plaintext'
            const safeLang = language.replace(/[^a-z0-9_-]/gi, '') || 'plaintext'
            return `<pre><code class="language-${safeLang}">${esc(text)}</code></pre>`
          },
        },
      })
      return m
    })
  }
  return _markedPromise
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
  const editorSelection = ref<{ text: string; rect: DOMRect | null } | null>(null)

  const editorDirty = computed(() => editorText.value !== editorBaseline.value)

  const canSaveEditorContext = computed(
    () =>
      !!opts.selectedRel.value &&
      !opts.selectedIsDir.value &&
      !opts.meta.value?.truncated &&
      (opts.meta.value?.kind === 'text' || opts.meta.value?.kind === 'markdown'),
  )

  const canSaveEditor = computed(() => canSaveEditorContext.value && editorDirty.value)

  // Markdown rendering with debounce
  let mdDebounceTimer: ReturnType<typeof setTimeout> | null = null

  watch(editorText, (src) => {
    if (mdDebounceTimer) { clearTimeout(mdDebounceTimer); mdDebounceTimer = null }
    if (!src) { markdownEditorHtml.value = ''; return }
    mdDebounceTimer = setTimeout(async () => {
      try {
        const [m, dp] = await Promise.all([getMarked(), getDOMPurify()])
        const html = m.parse(src, { async: false }) as string
        markdownEditorHtml.value = dp.default.sanitize(html)
      } catch { markdownEditorHtml.value = '' }
    }, 300)
  })

  async function saveEditor() {
    if (!canSaveEditor.value || !opts.selectedRel.value) return
    await getApiBase()
    const q = new URLSearchParams({ pane_id: opts.paneId(), path: opts.selectedRel.value })
    const res = await authFetch(apiUrl(`/api/workspace/file?${q}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editorText.value }),
    })
    if (!res.ok) return
    editorBaseline.value = editorText.value
    if (opts.meta.value && (opts.meta.value.kind === 'text' || opts.meta.value.kind === 'markdown')) {
      opts.meta.value = { ...opts.meta.value, content: editorText.value, truncated: false, message: undefined }
    }
  }

  function resetEditor() {
    editorText.value = ''
    editorBaseline.value = ''
    mdShowPreview.value = false
    htmlShowPreview.value = false
    editorSelection.value = null
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
    editorSelection,
    editorDirty,
    canSaveEditorContext,
    canSaveEditor,
    saveEditor,
    resetEditor,
    onEditorSelectionChange,
    onSelectionDismiss,
  }
}

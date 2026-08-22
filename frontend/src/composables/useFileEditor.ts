import { ref, computed, watch, type Ref } from 'vue'
import { getApiBase, apiUrl, authFetch, getAuthToken } from './apiBase'
import { isTauri } from './useTransport'

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
  const editorSelection = ref<{ text: string; rect: DOMRect | null } | null>(null)

  const editorDirty = computed(() => editorText.value !== editorBaseline.value)

  const canSaveEditorContext = computed(
    () =>
      !!opts.selectedRel.value &&
      !opts.selectedIsDir.value &&
      !opts.meta.value?.truncated &&
      (opts.meta.value?.kind === 'text' || opts.meta.value?.kind === 'markdown')
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
      return
    }
    mdDebounceTimer = setTimeout(async () => {
      try {
        const [m, dp] = await Promise.all([getMarked(), getDOMPurify()])
        let html = m.parse(src, { async: false }) as string
        const filePath = opts.selectedRel.value
        if (filePath) html = rewriteImageSrcs(html, filePath, opts.paneId())
        markdownEditorHtml.value = dp.default.sanitize(html)
      } catch {
        markdownEditorHtml.value = ''
      }
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
    if (
      opts.meta.value &&
      (opts.meta.value.kind === 'text' || opts.meta.value.kind === 'markdown')
    ) {
      opts.meta.value = {
        ...opts.meta.value,
        content: editorText.value,
        truncated: false,
        message: undefined,
      }
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

/** Factory alias — use this when creating independent editor instances per pane */
export const createFileEditor = useFileEditor

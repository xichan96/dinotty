import { ref } from 'vue'
import { getApiBase, apiUrl, authFetch } from './apiBase'
import { esc, getDOMPurify } from './useFileEditor'

function officeNodeToHtml(node: any): string {
  if (!node) return ''
  const type = String(node.type || '')
  if (type === 'table') {
    const rows = Array.isArray(node.children) ? node.children : []
    const tr = rows.map((r: any) => {
      const cells = Array.isArray(r.children) ? r.children : []
      const tds = cells.map((c: any) => `<td>${esc(String(c.text ?? ''))}</td>`).join('')
      return `<tr>${tds}</tr>`
    }).join('')
    return `<table>${tr}</table>`
  }
  if (type === 'list') {
    const items = Array.isArray(node.children) ? node.children : []
    const li = items.map((it: any) => `<li>${officeNodeToHtml(it) || esc(String(it.text ?? ''))}</li>`).join('')
    return `<ul>${li}</ul>`
  }
  if (type === 'heading') {
    const level = Math.max(1, Math.min(6, Number(node?.metadata?.level || 2)))
    return `<h${level}>${esc(String(node.text ?? ''))}</h${level}>`
  }
  if (type === 'paragraph') {
    const txt = String(node.text ?? '').trim()
    if (!txt) return ''
    return `<p>${esc(txt)}</p>`
  }
  const children = Array.isArray(node.children) ? node.children.map(officeNodeToHtml).join('') : ''
  if (children) return children
  const txt = String(node.text ?? '').trim()
  return txt ? `<p>${esc(txt)}</p>` : ''
}

export function useOfficePreview(opts: { paneId: () => string }) {
  const officeLoading = ref(false)
  const officeErr = ref('')
  const officeHtml = ref('')

  async function loadOfficePreview(rel: string) {
    officeLoading.value = true
    officeErr.value = ''
    officeHtml.value = ''
    try {
      await getApiBase()
      const q = new URLSearchParams({ pane_id: opts.paneId(), path: rel })
      const res = await authFetch(apiUrl(`/api/workspace/raw?${q}`))
      if (!res.ok) throw new Error('raw')
      const buf = await res.arrayBuffer()
      const [officeMod, dp] = await Promise.all([import('officeparser'), getDOMPurify()])
      const ast: any = await (officeMod.default as any).parseOffice(buf)
      const nodes = Array.isArray(ast?.content) ? ast.content : []
      const html = nodes.map(officeNodeToHtml).join('') || `<pre>${esc(ast?.toText?.() || '')}</pre>`
      officeHtml.value = dp.default.sanitize(html)
    } catch {
      officeErr.value = 'unsupported'
    } finally {
      officeLoading.value = false
    }
  }

  function resetOffice() {
    officeLoading.value = false
    officeErr.value = ''
    officeHtml.value = ''
  }

  return { officeLoading, officeErr, officeHtml, loadOfficePreview, resetOffice }
}

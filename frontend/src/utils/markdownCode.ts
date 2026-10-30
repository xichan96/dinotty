/** Escape text for safe interpolation into HTML element content. */
export function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Render one fenced code block.
 *
 * ```mermaid fences become inert placeholders: mermaid's SVG is generated after
 * DOMPurify has sanitized the document (see `mermaidPreview.ts`), and the source
 * is kept inside the placeholder so a broken diagram can still show its code.
 */
export function renderMarkdownCode({ text, lang }: { text: string; lang?: string }) {
  const info = (lang || '').trim()
  const language = info.split(/\s+/)[0] || 'plaintext'
  if (language.toLowerCase() === 'mermaid') {
    return `<div class="md-mermaid" data-mermaid><pre class="md-mermaid-src">${esc(text)}</pre><div class="md-mermaid-canvas"></div></div>`
  }
  const safeLang = language.replace(/[^a-z0-9_-]/gi, '') || 'plaintext'
  return `<pre><code class="language-${safeLang}">${esc(text)}</code></pre>`
}

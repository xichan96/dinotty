/** Escape text for safe interpolation into HTML element content. */
export function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Render one fenced code block as an inert placeholder.
 *
 * Mermaid diagrams and ```math blocks are enhanced after DOMPurify has
 * sanitized the document (see `markdownEnhance.ts`), so the renderer only
 * emits empty canvases plus the escaped source. Regular code blocks keep their
 * escaped source in `<code>` until the enhancer swaps in highlighted markup.
 */
export function renderMarkdownCode({ text, lang }: { text: string; lang?: string }) {
  const info = (lang || '').trim()
  const language = info.split(/\s+/)[0] || 'plaintext'
  const lower = language.toLowerCase()
  if (lower === 'mermaid') {
    return `<div class="md-mermaid" data-mermaid><pre class="md-mermaid-src">${esc(text)}</pre><div class="md-mermaid-canvas"></div></div>`
  }
  if (lower === 'math') {
    return `<div class="md-math" data-md-math><pre class="md-math-src">${esc(text)}</pre><div class="md-math-canvas"></div></div>`
  }
  const safeLang = language.replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'plaintext'
  return `<div class="md-code-block" data-md-code data-md-lang="${safeLang}"><pre><code class="language-${safeLang}">${esc(text)}</code></pre></div>`
}

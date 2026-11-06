/**
 * Post-sanitize enhancements for the markdown preview.
 *
 * Marked emits placeholders for fenced code and ```math blocks, and KaTeX
 * (through `marked-katex-extension`) already converts `$…$` / `$$…$$` during
 * parsing. Everything that needs a real DOM — syntax highlighting, copy
 * buttons, latex rendering and heading anchors — runs here, after DOMPurify,
 * so the HTML assigned with `v-html` is always the sanitized markup. Results
 * are discarded when the preview re-renders mid-flight, mirroring
 * `mermaidPreview.ts`.
 */
import { copyToClipboard } from '../utils/clipboard'

export interface KatexRenderer {
  renderToString(tex: string, options?: { displayMode?: boolean; throwOnError?: boolean }): string
}

export interface HighlightRenderer {
  getLanguage(name: string): unknown
  highlight(
    code: string,
    options: { language: string; ignoreIllegals?: boolean }
  ): { value: string }
}

export interface EnhanceMarkdownOptions {
  /** Localized copy-button labels. */
  copyLabel?: string
  copiedLabel?: string
  /** Returns false once the caller no longer wants the result. */
  isCurrent?: () => boolean
  /** Test seams: replace the lazily loaded libraries. */
  renderHighlight?: (source: string, language: string) => string | null
  renderMath?: (source: string) => string
}

export interface MarkdownClickLabels {
  copyLabel?: string
  copiedLabel?: string
}

export const CODE_BLOCK_SELECTOR = '[data-md-code]'
export const MATH_BLOCK_SELECTOR = '[data-md-math]'
export const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6'

const COPY_FLASH_MS = 2000

let katexPromise: Promise<KatexRenderer> | null = null
let highlightPromise: Promise<HighlightRenderer> | null = null

export function loadKatex(): Promise<KatexRenderer> {
  if (!katexPromise) {
    katexPromise = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
      ([mod]) => (mod.default ?? mod) as KatexRenderer
    )
  }
  return katexPromise
}

export function loadHighlight(): Promise<HighlightRenderer> {
  if (!highlightPromise) {
    highlightPromise = import('highlight.js/lib/common').then(
      (mod) => (mod.default ?? mod) as unknown as HighlightRenderer
    )
  }
  return highlightPromise
}

/** Keep the raw source per code block so copy never reads highlighted markup. */
const codeSources = new WeakMap<HTMLElement, string>()

/**
 * GitHub-style heading slug: lowercase, drop punctuation, spaces become
 * hyphens. Letters and digits from every script are kept.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
}

/** Give every heading a stable, unique id (duplicates get -1, -2, …). */
export function assignHeadingIds(root: ParentNode): void {
  const used = new Set<string>()
  const headings = Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
  // Seed with ids that came from the markdown source so generated ids never
  // collide with an explicit anchor.
  for (const heading of headings) if (heading.id) used.add(heading.id)

  for (const heading of headings) {
    if (heading.id) continue
    const base = slugifyHeading(heading.textContent ?? '')
    if (!base) continue
    let id = base
    let suffix = 1
    while (used.has(id)) id = `${base}-${suffix++}`
    used.add(id)
    heading.id = id
  }
}

function codeLabel(language: string): string {
  const label = language.trim() || 'plaintext'
  return label.toLowerCase() === 'plaintext' ? 'text' : label
}

function prepareCodeBlock(block: HTMLElement, options: EnhanceMarkdownOptions) {
  const code = block.querySelector<HTMLElement>('code')
  if (!code) return
  codeSources.set(block, code.textContent ?? '')

  if (!block.querySelector('.md-code-head')) {
    const head = document.createElement('div')
    head.className = 'md-code-head'

    const lang = document.createElement('span')
    lang.className = 'md-code-lang'
    lang.textContent = codeLabel(block.dataset.mdLang ?? '')
    head.appendChild(lang)

    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'md-code-copy'
    copy.dataset.mdCopy = ''
    copy.textContent = options.copyLabel ?? 'Copy'
    head.appendChild(copy)

    block.insertBefore(head, block.firstChild)
  }
}

/**
 * Enhance every untouched code/math placeholder under `root` in place and
 * assign heading ids. Safe to call repeatedly: blocks are claimed synchronously
 * and skipped on later calls.
 */
export async function enhanceMarkdownBlocks(
  root: ParentNode,
  options: EnhanceMarkdownOptions = {}
): Promise<void> {
  assignHeadingIds(root)

  const current = options.isCurrent ?? (() => true)
  const codeBlocks = Array.from(root.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR)).filter(
    (block) => !block.dataset.mdState
  )
  const mathBlocks = Array.from(root.querySelectorAll<HTMLElement>(MATH_BLOCK_SELECTOR)).filter(
    (block) => !block.dataset.mdState
  )

  for (const block of codeBlocks) {
    block.dataset.mdState = 'pending'
    prepareCodeBlock(block, options)
  }
  for (const block of mathBlocks) block.dataset.mdState = 'pending'

  if (codeBlocks.length > 0) {
    let render = options.renderHighlight
    if (!render) {
      try {
        const hljs = await loadHighlight()
        render = (source, language) => {
          if (!language || !hljs.getLanguage(language)) return null
          try {
            return hljs.highlight(source, { language, ignoreIllegals: true }).value
          } catch {
            return null
          }
        }
      } catch {
        render = () => null
      }
    }
    for (const block of codeBlocks) {
      // A previous markdown render replaced these nodes — drop the stale work.
      if (!current() || !block.isConnected) return
      const code = block.querySelector<HTMLElement>('code')
      if (!code) continue
      const source = codeSources.get(block) ?? code.textContent ?? ''
      const html = render(source, block.dataset.mdLang ?? '')
      if (html != null) code.innerHTML = html
      block.dataset.mdState = 'done'
    }
  }

  if (mathBlocks.length > 0) {
    let render = options.renderMath
    if (!render) {
      try {
        const katex = await loadKatex()
        render = (source) =>
          katex.renderToString(source, { displayMode: true, throwOnError: false })
      } catch {
        // Leave the source visible rather than showing an empty block.
        for (const block of mathBlocks) block.dataset.mdState = 'error'
      }
    }
    const renderMath = render
    if (renderMath) {
      for (const block of mathBlocks) {
        if (!current() || !block.isConnected) return
        const source = block.querySelector<HTMLElement>('.md-math-src')
        const canvas = block.querySelector<HTMLElement>('.md-math-canvas')
        if (!source || !canvas) continue
        const html = renderMath(source.textContent ?? '')
        if (html) canvas.innerHTML = html
        block.dataset.mdState = 'done'
      }
    }
  }
}

function flashCopied(button: HTMLElement, copiedLabel: string, copyLabel?: string) {
  const restore = copyLabel ?? button.textContent ?? ''
  button.textContent = copiedLabel
  const sequence = String((Number(button.dataset.mdCopySeq) || 0) + 1)
  button.dataset.mdCopySeq = sequence
  setTimeout(() => {
    if (button.isConnected && button.dataset.mdCopySeq === sequence) button.textContent = restore
  }, COPY_FLASH_MS)
}

/**
 * One delegated click handler for the preview container: copy buttons and
 * same-page anchor links. External links keep their default behaviour.
 */
export function handleMarkdownPreviewClick(event: MouseEvent, labels: MarkdownClickLabels = {}) {
  const target = event.target
  if (!(target instanceof Element)) return

  const copyButton = target.closest<HTMLElement>('[data-md-copy]')
  if (copyButton) {
    event.preventDefault()
    const block = copyButton.closest<HTMLElement>(CODE_BLOCK_SELECTOR)
    if (!block) return
    const code = block.querySelector<HTMLElement>('code')
    const source = codeSources.get(block) ?? code?.textContent ?? ''
    void copyToClipboard(source).then(
      () => flashCopied(copyButton, labels.copiedLabel ?? 'Copied', labels.copyLabel),
      () => undefined
    )
    return
  }

  const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]')
  if (!anchor) return
  event.preventDefault()

  const raw = anchor.getAttribute('href')?.slice(1) ?? ''
  let id = raw
  try {
    id = decodeURIComponent(raw)
  } catch {
    // Keep the raw fragment when it is not valid percent-encoding.
  }
  if (!id) return

  const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : document
  const heading = Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)).find(
    (element) => element.id === id
  )
  heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * Mermaid diagrams for the markdown preview.
 *
 * The marked renderer emits a placeholder (`<div class="md-mermaid">`) for every
 * ```mermaid fence and mermaid itself is imported here, lazily, the first time a
 * document actually contains one. Keeping the import out of the markdown hot
 * path matters: mermaid ships its own diagram implementations and is far bigger
 * than the whole rest of the preview pipeline.
 */
import { luminance } from '../themes'

export interface MermaidRenderResult {
  svg: string
  bindFunctions?: (element: Element) => void
}

export interface MermaidRenderOptions {
  /** Localized text shown when a diagram cannot be rendered. */
  errorLabel?: string
  /** Returns false once the caller no longer wants the result. */
  isCurrent?: () => boolean
  /** Test seam: replaces the real mermaid renderer. */
  render?: (id: string, source: string, container: HTMLElement) => Promise<MermaidRenderResult>
}

const BLOCK_SELECTOR = '[data-mermaid]'

let mermaidPromise: Promise<typeof import('mermaid')> | null = null
let appliedConfigKey = ''
let diagramSeq = 0

function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import('mermaid')
  return mermaidPromise
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/**
 * Derive mermaid's theme from the app's CSS variables so diagrams sit on the
 * same background and use the same text/border colours as the preview.
 */
export function buildMermaidConfig() {
  const background = cssVar('--bg-surface', '#141414')
  const dark = luminance(background) < 0.5
  const fg = cssVar('--fg', dark ? '#dddddd' : '#222222')
  const border = cssVar('--border', dark ? '#444444' : '#cccccc')
  const nodeBkg = cssVar('--bg-hover', dark ? '#2a2a2a' : '#e6e6e6')
  return {
    theme: dark ? 'dark' : 'default',
    fontFamily: cssVar('--font-ui', 'system-ui, sans-serif'),
    fontSize: 14,
    themeVariables: {
      background,
      mainBkg: nodeBkg,
      primaryColor: nodeBkg,
      primaryTextColor: fg,
      primaryBorderColor: border,
      secondaryColor: cssVar('--tab-bg', dark ? '#202020' : '#f0f0f0'),
      tertiaryColor: background,
      textColor: fg,
      nodeTextColor: fg,
      nodeBorder: border,
      lineColor: cssVar('--fg-muted', dark ? '#888888' : '#666666'),
      edgeLabelBackground: background,
      clusterBkg: background,
      clusterBorder: border,
      attributeBackgroundColorOdd: nodeBkg,
      attributeBackgroundColorEven: background,
    },
  } as const
}

function ensureInitialized(mermaid: typeof import('mermaid')) {
  const config = buildMermaidConfig()
  const key = JSON.stringify(config)
  if (key === appliedConfigKey) return
  mermaid.default.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    ...config,
  })
  appliedConfigKey = key
}

function showError(block: HTMLElement, sourceElement: HTMLElement, message: string, label: string) {
  block.dataset.mermaidState = 'error'
  const error = document.createElement('div')
  error.className = 'md-mermaid-error'
  error.textContent = label
  error.title = message
  block.insertBefore(error, sourceElement)
}

/**
 * Render every untouched mermaid placeholder under `root` in place.
 *
 * The raw source stays visible until the SVG is ready, so a slow first load
 * (the diagram chunks are fetched on demand) still shows something useful, and
 * a syntax error leaves the source in place next to the error label.
 */
export async function renderMermaidBlocks(
  root: ParentNode,
  options: MermaidRenderOptions = {}
): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter(
    (block) => !block.dataset.mermaidState
  )
  if (blocks.length === 0) return
  // Claim them synchronously so overlapping calls never render the same block.
  for (const block of blocks) block.dataset.mermaidState = 'pending'

  const current = options.isCurrent ?? (() => true)
  let render = options.render
  if (!render) {
    try {
      const mermaid = await loadMermaid()
      ensureInitialized(mermaid)
      render = (id, source, container) => mermaid.default.render(id, source, container)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const block of blocks) {
        const source = block.querySelector<HTMLElement>('.md-mermaid-src')
        if (source) {
          showError(block, source, message, options.errorLabel ?? 'Diagram failed to render')
        }
      }
      return
    }
  }

  for (const block of blocks) {
    // A previous markdown render replaced these nodes — drop the stale work.
    if (!current() || !block.isConnected) return
    const sourceElement = block.querySelector<HTMLElement>('.md-mermaid-src')
    const canvas = block.querySelector<HTMLElement>('.md-mermaid-canvas')
    if (!sourceElement || !canvas) continue
    try {
      const result = await render(
        `dinotty-mermaid-${++diagramSeq}`,
        sourceElement.textContent ?? '',
        canvas
      )
      if (!current() || !block.isConnected) return
      canvas.innerHTML = result.svg
      result.bindFunctions?.(canvas)
      block.dataset.mermaidState = 'done'
    } catch (error) {
      if (!current() || !block.isConnected) return
      const message = error instanceof Error ? error.message : String(error)
      showError(block, sourceElement, message, options.errorLabel ?? 'Diagram failed to render')
    }
  }
}

/**
 * Derive the Markdown outline from the same `marked` token list that renders
 * the preview. Heading line numbers are accumulated from `token.raw`, so the
 * source position stays accurate without a second parse of the document.
 */
import type { Token, Tokens } from 'marked'
import { slugifyHeading } from '../composables/markdownEnhance'
import type { OutlineItem } from '../types/outline'

interface HeadingSeed {
  label: string
  depth: number
  line: number
  anchor: string
}

function countNewlines(raw: string): number {
  let count = 0
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) === 10) count++
  }
  return count
}

/** Approximate the rendered `textContent` of a heading's inline tokens. */
function inlinePlainText(tokens: Token[] | undefined, fallback: string): string {
  if (!tokens || tokens.length === 0) return decodeEntities(stripInlineMarkdown(fallback))
  let out = ''
  for (const token of tokens) {
    const value = token as Tokens.Generic
    switch (value.type) {
      case 'text':
        out += decodeEntities(value.text ?? '')
        break
      case 'codespan':
      case 'escape':
        // Code-span and escape content is already literal, not entity-encoded.
        out += value.text ?? ''
        break
      case 'br':
        // A <br> contributes no textContent.
        break
      case 'image':
        // An <img> contributes no text content to the heading element.
        break
      case 'html':
        out += decodeEntities(stripTags(value.text ?? ''))
        break
      default:
        if (Array.isArray(value.tokens)) {
          out += inlinePlainText(value.tokens as Token[], value.text ?? '')
        } else {
          out += decodeEntities(value.text ?? '')
        }
    }
  }
  return out
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

/** Mirror the browser's textContent decoding without another Markdown pass. */
function decodeEntities(text: string): string {
  if (text.indexOf('&') < 0) return text
  if (typeof document === 'undefined') return text
  const area = document.createElement('textarea')
  area.innerHTML = text
  return area.value
}

/** Fallback for headings whose inline tokens are unavailable. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1')
}

/**
 * Turn `marked.lexer()` output into a heading tree.
 *
 * Slugs deliberately mirror `assignHeadingIds()` from `markdownEnhance.ts`:
 * a single slugger per document and `-1`, `-2`, … for duplicates, which keeps
 * outline anchors aligned with the rendered preview.
 */
export function outlineFromMarkedTokens(tokens: readonly Token[]): OutlineItem[] {
  const used = new Set<string>()
  const seeds: HeadingSeed[] = []
  let line = 1

  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading
      const label = inlinePlainText(heading.tokens, heading.text).trim()
      const base = label ? slugifyHeading(label) : ''
      if (base) {
        let anchor = base
        let suffix = 1
        while (used.has(anchor)) anchor = `${base}-${suffix++}`
        used.add(anchor)
        seeds.push({ label, depth: heading.depth, line, anchor })
      }
    }
    line += countNewlines((token as { raw?: string }).raw ?? '')
  }

  return buildHeadingTree(seeds)
}

function buildHeadingTree(seeds: readonly HeadingSeed[]): OutlineItem[] {
  const roots: OutlineItem[] = []
  const stack: OutlineItem[] = []

  for (const seed of seeds) {
    const node: OutlineItem = {
      id: seed.anchor,
      label: seed.label,
      kind: 'heading',
      level: seed.depth,
      line: seed.line,
      anchor: seed.anchor,
    }
    while (stack.length > 0 && (stack[stack.length - 1].level ?? 0) >= seed.depth) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) {
      if (!parent.children) parent.children = []
      parent.children.push(node)
    } else {
      roots.push(node)
    }
    stack.push(node)
  }

  return roots
}

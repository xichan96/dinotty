import { describe, expect, it } from 'vitest'
import { Marked } from 'marked'
import { assignHeadingIds, slugifyHeading } from '../composables/markdownEnhance'
import { outlineFromMarkedTokens } from '../utils/markdownOutline'
import { flattenOutline } from '../utils/outlineTree'

function outline(source: string) {
  const lexer = new Marked({ gfm: true, breaks: true })
  return outlineFromMarkedTokens(lexer.lexer(source))
}

describe('markdown outline', () => {
  it('uses the same slugs as the preview heading ids (#330), including duplicates', () => {
    const items = outline('# Goals & non-goals\n\n## Goals & non-goals\n\n### Hello **world**\n')
    const flat = flattenOutline(items)

    const container = document.createElement('div')
    container.innerHTML =
      '<h1>Goals &amp; non-goals</h1><h2>Goals &amp; non-goals</h2><h3>Hello <strong>world</strong></h3>'
    assignHeadingIds(container)
    const previewIds = Array.from(container.querySelectorAll('h1,h2,h3')).map(
      (heading) => heading.id
    )

    expect(flat.map((entry) => entry.item.anchor)).toEqual(previewIds)
    // `slugifyHeading` collapses `\s+` to one hyphen, so "&" leaves a single
    // separator. This matches what #330 writes into the preview, which is the
    // authority here (the design note's "--" example is out of date).
    expect(flat.map((entry) => entry.item.anchor)).toEqual([
      'goals-non-goals',
      'goals-non-goals-1',
      'hello-world',
    ])
    expect(slugifyHeading('Goals & non-goals')).toBe('goals-non-goals')
  })

  it('accumulates source line numbers from token.raw', () => {
    const items = outline('# One\n\nintro\n\n## Two\n\n### Three\n')
    const flat = flattenOutline(items)
    expect(flat.map((entry) => entry.item.line)).toEqual([1, 5, 7])
  })

  it('nests headings by level, including skipped levels', () => {
    const items = outline('# Root\n\n### Deep child\n\n## Sibling\n')
    expect(items).toHaveLength(1)
    expect(items[0].level).toBe(1)
    expect(items[0].children?.map((child) => child.label)).toEqual(['Deep child', 'Sibling'])
  })

  it('decodes HTML entities like the rendered heading textContent', () => {
    const items = outline('# A &amp; B\n\n## caf&eacute;\n')
    const flat = flattenOutline(items)

    const container = document.createElement('div')
    container.innerHTML = '<h1>A &amp; B</h1><h2>caf&eacute;</h2>'
    assignHeadingIds(container)
    const previewIds = Array.from(container.querySelectorAll('h1,h2')).map((heading) => heading.id)

    expect(flat.map((entry) => entry.item.label)).toEqual(['A & B', 'café'])
    expect(flat.map((entry) => entry.item.anchor)).toEqual(previewIds)
  })

  it('strips inline formatting from labels so anchors match textContent', () => {
    const items = outline('# Use `code` and **bold**\n')
    expect(items[0].label).toBe('Use code and bold')
    expect(items[0].anchor).toBe('use-code-and-bold')
  })

  it('returns no items when the document has no headings', () => {
    expect(outline('just a paragraph\n')).toEqual([])
  })

  it('skips headings whose slug is empty', () => {
    expect(outline('# !!!\n\n# Real\n').map((item) => item.label)).toEqual(['Real'])
  })
})

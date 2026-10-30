import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDOMPurify, getMarked } from '../composables/useFileEditor'
import { renderMermaidBlocks } from '../composables/mermaidPreview'

const ER_SOURCE = 'erDiagram\n  USER ||--o{ ORDER : places'

function mermaidFence(): string {
  return '```mermaid\n' + ER_SOURCE + '\n```'
}

function mountPlaceholder(): HTMLElement {
  document.body.innerHTML = `<div class="md-mermaid" data-mermaid><pre class="md-mermaid-src">${ER_SOURCE}</pre><div class="md-mermaid-canvas"></div></div>`
  return document.body.firstElementChild as HTMLElement
}

afterEach(function resetBody() {
  document.body.innerHTML = ''
})

describe('markdown mermaid fences', function markdownFencesSuite() {
  it('emits a diagram placeholder instead of a mermaid code block', async function emitsPlaceholder() {
    const { parse } = await getMarked()
    const html = parse(mermaidFence(), { async: false }) as string

    expect(html).toContain('class="md-mermaid"')
    expect(html).toContain('data-mermaid')
    expect(html).toContain('class="md-mermaid-src"')
    expect(html).toContain('USER ||--o{ ORDER : places')
    expect(html).not.toContain('language-mermaid')
  })

  it('keeps the placeholder attributes through DOMPurify', async function survivesSanitizing() {
    const { parse } = await getMarked()
    const purifier = await getDOMPurify()
    const html = parse(mermaidFence(), { async: false }) as string
    const clean = purifier.default.sanitize(html)

    expect(clean).toContain('data-mermaid')
    expect(clean).toContain('md-mermaid-src')
  })

  it('leaves other fenced code blocks as code', async function leavesOtherCode() {
    const { parse } = await getMarked()
    const html = parse('```ts\nconst a = 1\n```', { async: false }) as string

    expect(html).toContain('language-ts')
    expect(html).not.toContain('md-mermaid')
  })
})

describe('renderMermaidBlocks', function renderBlocksSuite() {
  it('injects the svg and marks the block as done', async function injectsSvg() {
    const block = mountPlaceholder()
    const bindFunctions = vi.fn()
    const render = vi.fn(async (_id: string, _source: string, _container: HTMLElement) => ({
      svg: '<svg data-testid="diagram"></svg>',
      bindFunctions,
    }))

    await renderMermaidBlocks(document.body, { render })

    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0][1]).toBe(ER_SOURCE)
    expect(block.dataset.mermaidState).toBe('done')
    expect(block.querySelector('.md-mermaid-canvas svg')).not.toBeNull()
    expect(bindFunctions).toHaveBeenCalledTimes(1)
  })

  it('keeps the source and explains the failure when rendering throws', async function keepsSourceOnError() {
    const block = mountPlaceholder()
    const render = vi.fn(async () => {
      throw new Error('Parse error on line 2')
    })

    await renderMermaidBlocks(document.body, { render, errorLabel: '图表渲染失败' })

    expect(block.dataset.mermaidState).toBe('error')
    const error = block.querySelector<HTMLElement>('.md-mermaid-error')
    expect(error?.textContent).toBe('图表渲染失败')
    expect(error?.title).toBe('Parse error on line 2')
    expect(block.querySelector('.md-mermaid-src')?.textContent).toContain('erDiagram')
  })

  it('does not render the same block twice', async function rendersOnce() {
    mountPlaceholder()
    const render = vi.fn(async () => ({ svg: '<svg></svg>' }))

    await renderMermaidBlocks(document.body, { render })
    await renderMermaidBlocks(document.body, { render })

    expect(render).toHaveBeenCalledTimes(1)
  })
})

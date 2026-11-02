import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDOMPurify, getMarked } from '../composables/useFileEditor'
import {
  assignHeadingIds,
  enhanceMarkdownBlocks,
  handleMarkdownPreviewClick,
  slugifyHeading,
} from '../composables/markdownEnhance'

const CODE_BLOCK =
  '<div class="md-code-block" data-md-code data-md-lang="ts"><pre><code class="language-ts">const a = 1</code></pre></div>'

async function renderMarkdown(source: string): Promise<string> {
  const [{ parse }, purifier] = await Promise.all([getMarked(), getDOMPurify()])
  return purifier.default.sanitize(parse(source, { async: false }) as string)
}

function clickHandlerFor(labels = {}) {
  return (event: MouseEvent) => handleMarkdownPreviewClick(event, labels)
}

afterEach(function resetBody() {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('markdown math', function mathSuite() {
  it('renders inline and block formulas and keeps them through DOMPurify', async function keepsKatex() {
    const clean = await renderMarkdown('Inline $E=mc^2$ and\n\n$$\n\\int_0^1 x\\,dx\n$$\n')

    expect(clean).toContain('class="katex"')
    expect(clean).toContain('<math')
    expect(clean).toContain('annotation')
    expect(clean).not.toContain('<script')
  })

  it('turns a ```math fence into a placeholder that survives sanitizing', async function mathFence() {
    const clean = await renderMarkdown('```math\n\\frac{1}{2}\n```')

    expect(clean).toContain('data-md-math')
    expect(clean).toContain('md-math-src')
    expect(clean).toContain('\\frac{1}{2}')
    expect(clean).not.toContain('language-math')
  })

  it('renders ```math placeholders after sanitizing', async function rendersFencedMath() {
    const clean = await renderMarkdown('```math\n\\frac{1}{2}\n```')
    document.body.innerHTML = clean
    const renderMath = vi.fn((_source: string) => '<span class="katex-display">rendered</span>')

    await enhanceMarkdownBlocks(document.body, { renderMath })

    const block = document.querySelector<HTMLElement>('[data-md-math]')
    expect(renderMath).toHaveBeenCalledTimes(1)
    expect(renderMath.mock.calls[0][0].trim()).toBe('\\frac{1}{2}')
    expect(block?.dataset.mdState).toBe('done')
    expect(block?.querySelector('.md-math-canvas')?.innerHTML).toContain('katex-display')
  })
})

describe('code blocks', function codeSuite() {
  it('highlights, labels and adds a copy button', async function enhancesCode() {
    document.body.innerHTML = CODE_BLOCK
    const renderHighlight = vi.fn(() => '<span class="hljs-keyword">const</span> a = 1')

    await enhanceMarkdownBlocks(document.body, {
      renderHighlight,
      copyLabel: '复制',
      copiedLabel: '已复制',
    })

    const block = document.querySelector<HTMLElement>('[data-md-code]')!
    expect(renderHighlight).toHaveBeenCalledWith('const a = 1', 'ts')
    expect(block.querySelector('code')?.innerHTML).toContain('hljs-keyword')
    expect(block.querySelector('.md-code-lang')?.textContent).toBe('ts')
    expect(block.querySelector('[data-md-copy]')?.textContent).toBe('复制')
    expect(block.dataset.mdState).toBe('done')
  })

  it('highlights through the lazy highlight.js loader', async function realHighlight() {
    document.body.innerHTML = CODE_BLOCK

    await enhanceMarkdownBlocks(document.body, { copyLabel: 'Copy', copiedLabel: 'Copied' })

    const code = document.querySelector('[data-md-code] code')
    expect(code?.querySelector('.hljs-keyword')?.textContent).toBe('const')
  })

  it('does not enhance the same block twice', async function enhancesOnce() {
    document.body.innerHTML = CODE_BLOCK
    const renderHighlight = vi.fn(() => '<span class="hljs-keyword">const</span> a = 1')

    await enhanceMarkdownBlocks(document.body, { renderHighlight })
    await enhanceMarkdownBlocks(document.body, { renderHighlight })

    expect(renderHighlight).toHaveBeenCalledTimes(1)
  })

  it('copies the original source instead of highlighted text', async function copiesSource() {
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    document.body.innerHTML = CODE_BLOCK
    await enhanceMarkdownBlocks(document.body, {
      renderHighlight: () => '<span class="hljs-keyword">DIFFERENT</span>',
      copyLabel: '复制',
      copiedLabel: '已复制',
    })

    const root = document.querySelector<HTMLElement>('[data-md-code]')!
    root.addEventListener('click', clickHandlerFor({ copiedLabel: '已复制' }))
    const button = root.querySelector<HTMLButtonElement>('[data-md-copy]')!
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('const a = 1')
      expect(button.textContent).toBe('已复制')
    })
  })
})

describe('heading ids and anchors', function headingSuite() {
  it('slugs headings GitHub-style', function slugs() {
    expect(slugifyHeading('Hello, World!')).toBe('hello-world')
    expect(slugifyHeading('  Setup & Usage  ')).toBe('setup-usage')
    expect(slugifyHeading('中文 标题')).toBe('中文-标题')
    expect(slugifyHeading('!!!')).toBe('')
  })

  it('assigns unique ids and keeps existing ones', function assignsIds() {
    document.body.innerHTML =
      '<h2>Hello, World!</h2><h2>Hello, World!</h2><h2>中文 标题</h2><h2>!!!</h2>' +
      '<h3 id="custom">Custom</h3>'

    assignHeadingIds(document.body)

    const ids = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((el) => el.id)
    expect(ids).toEqual(['hello-world', 'hello-world-1', '中文-标题', '', 'custom'])
  })

  it('smooth-scrolls to the heading and blocks the default jump', function scrollsToAnchor() {
    document.body.innerHTML =
      '<div id="preview"><h2 id="target">Target</h2><a href="#target">go</a></div>'
    const root = document.getElementById('preview') as HTMLElement
    const scrollSpy = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    })
    root.addEventListener('click', clickHandlerFor())

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    root.querySelector('a')!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('leaves external links alone', function ignoresExternal() {
    document.body.innerHTML =
      '<div id="preview"><a href="https://example.com">out</a></div>'
    const root = document.getElementById('preview') as HTMLElement
    root.addEventListener('click', clickHandlerFor())

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    root.querySelector('a')!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})

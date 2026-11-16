import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import {
  injectBaseHref,
  isWorkspaceRelativeRef,
  resolveRelativePath,
  rewriteHtmlPreview,
} from '../utils/htmlPreview'
import FilePreviewContent from '../components/workspace/FilePreviewContent.vue'

// The host page mints the preview token through `authFetch`; unit tests must not
// touch the network, so the mock decides whether a token exists.
const authFetchMock = vi.hoisted(() => vi.fn())
vi.mock('../composables/apiBase', async function mockApiBase(importOriginal) {
  const actual = await importOriginal<typeof import('../composables/apiBase')>()
  return { ...actual, authFetch: authFetchMock }
})

function toRaw(rel: string): string {
  return `/api/workspace/raw?pane_id=p1&path=${encodeURIComponent(rel)}`
}

/** The serializer escapes `&`/quotes; the browser decodes them on parse. */
function unescapeHtml(value: string | undefined): string {
  return (value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

beforeAll(function disableHappyDomFileLoading() {
  // DOMParser documents are inert in real browsers, but happy-dom would fetch
  // the `<link>`/`<script>` targets we inject. Keep the unit test offline.
  const win = window as unknown as {
    happyDOM: { settings: Record<string, boolean> }
  }
  win.happyDOM.settings.disableCSSFileLoading = true
  win.happyDOM.settings.disableJavaScriptFileLoading = true
  win.happyDOM.settings.disableJavaScriptEvaluation = true
  win.happyDOM.settings.disableIframePageLoading = true
  win.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true
})

describe('resolveRelativePath', function resolveRelativePathSuite() {
  it('应相对 HTML 所在目录解析路径', function resolvesSibling() {
    expect(resolveRelativePath('site/docs/index.html', './style.css')).toBe('site/docs/style.css')
    expect(resolveRelativePath('site/docs/index.html', '../img/logo.png')).toBe('site/img/logo.png')
  })

  it('应忽略查询串与锚点，并拒绝逃出根目录的引用', function handlesSuffixes() {
    expect(resolveRelativePath('index.html', 'app.js?v=2#main')).toBe('app.js')
    expect(resolveRelativePath('index.html', '../../secret.txt')).toBeNull()
    expect(resolveRelativePath('index.html', '#anchor')).toBeNull()
  })
})

describe('isWorkspaceRelativeRef', function isWorkspaceRelativeRefSuite() {
  it('应只接受普通相对路径', function classifiesRefs() {
    expect(isWorkspaceRelativeRef('img/a.png')).toBe(true)
    expect(isWorkspaceRelativeRef('https://example.com/a.png')).toBe(false)
    expect(isWorkspaceRelativeRef('//cdn/a.png')).toBe(false)
    expect(isWorkspaceRelativeRef('/assets/a.png')).toBe(false)
    expect(isWorkspaceRelativeRef('data:image/png;base64,xx')).toBe(false)
    expect(isWorkspaceRelativeRef('#top')).toBe(false)
  })
})

describe('rewriteHtmlPreview', function rewriteHtmlPreviewSuite() {
  it('应改写相对资源、srcset 与内联 CSS', function rewritesAssets() {
    const html = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./site.css">
    <style>.hero { background: url('../img/hero.png'); }</style>
  </head>
  <body>
    <img src="logo.png" srcset="logo.png 1x, logo@2x.png 2x">
    <script src="app.js"></script>
    <a href="other.html">Other</a>
    <div style="background-image: url(&quot;bg.png&quot;)"></div>
  </body>
</html>`

    const result = unescapeHtml(rewriteHtmlPreview(html, 'site/index.html', toRaw))

    expect(result.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(result).toContain(`href="${toRaw('site/site.css')}"`)
    expect(result).toContain(`src="${toRaw('site/logo.png')}"`)
    expect(result).toContain(`${toRaw('site/logo.png')} 1x, ${toRaw('site/logo@2x.png')} 2x`)
    expect(result).toContain(`src="${toRaw('site/app.js')}"`)
    expect(result).toContain(`href="${toRaw('site/other.html')}"`)
    const css = result.replace(/['"]/g, '')
    expect(css).toContain(`url(${toRaw('img/hero.png')})`)
    expect(css).toContain(`url(${toRaw('site/bg.png')})`)
  })

  it('应保持外部、绝对与 data URL 不变', function keepsExternalRefs() {
    const html = `<img src="https://example.com/a.png"><img src="/assets/b.png"><img src="data:image/png;base64,AA">`
    const result = unescapeHtml(rewriteHtmlPreview(html, 'index.html', toRaw))
    expect(result).toContain('https://example.com/a.png')
    expect(result).toContain('/assets/b.png')
    expect(result).toContain('data:image/png;base64,AA')
  })

  it('空内容或缺少文件路径时应原样返回', function handlesEmptyInput() {
    expect(rewriteHtmlPreview('', 'index.html', toRaw)).toBe('')
    expect(rewriteHtmlPreview('<img src="a.png">', '', toRaw)).toBe('<img src="a.png">')
  })
})

describe('injectBaseHref', function injectBaseHrefSuite() {
  it('应在 head 开头插入 base，使相对与脚本生成的 URL 都指向预览读取器', function injectsIntoHead() {
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
    const result = injectBaseHref(html, '/preview-ws/tok/')
    expect(result).toContain('<head><base href="/preview-ws/tok/"><meta charset="utf-8">')
  })

  it('应改写页面自带的 base，而不是重复插入', function rewritesExistingBase() {
    const html = '<html><head><base href="https://example.com/" target="_blank"></head></html>'
    const result = injectBaseHref(html, '/preview-ws/tok/')
    expect(result).toContain('<base href="/preview-ws/tok/" target="_blank">')
    expect(result.match(/<base\b/gi)).toHaveLength(1)
  })

  it('原文没有 head 时应补一个', function createsHead() {
    expect(injectBaseHref('<html><body>hi</body></html>', '/preview-ws/t/')).toContain(
      '<html><head><base href="/preview-ws/t/"></head><body>hi</body></html>'
    )
    expect(injectBaseHref('<img src="a.png">', '/preview-ws/t/')).toBe(
      '<base href="/preview-ws/t/"><img src="a.png">'
    )
  })

  it('空内容或空 base 时应原样返回', function handlesEmptyInput() {
    expect(injectBaseHref('', '/preview-ws/t/')).toBe('')
    expect(injectBaseHref('<img src="a.png">', '')).toBe('<img src="a.png">')
  })

  it('不改变文档里的相对引用：交给 base 解析', function leavesRefsAlone() {
    const html =
      '<html><head><link rel="stylesheet" href="css/base.css"></head><body><img src="assets/img/a.jpg"></body></html>'
    const result = injectBaseHref(html, '/preview-ws/tok/prototype/')
    expect(result).toContain('href="css/base.css"')
    expect(result).toContain('src="assets/img/a.jpg"')
  })
})

describe('FilePreviewContent HTML integration', function htmlIntegrationSuite() {
  function mountHtml(htmlShowPreview: boolean) {
    return mount(FilePreviewContent, {
      props: {
        previewLoading: false,
        previewErr: '',
        selectedRel: 'site/index.html',
        selectedIsDir: false,
        meta: { kind: 'html', content: '', language: 'html', truncated: false },
        rawUrl: '/api/workspace/raw?path=site/index.html',
        showSave: true,
        audioTitle: '',
        audioSub: '',
        audioTimeNow: '0:00',
        audioTimeTotal: '0:00',
        audioSeekValue: 0,
        audioVolValue: 100,
        audioPlaying: false,
        editorDirty: false,
        editorText: '<!doctype html><img src="logo.png">',
        canSaveEditor: true,
        mdShowPreview: false,
        htmlShowPreview,
        markdownEditorHtml: '',
        officeLoading: false,
        officeErr: '',
        officeHtml: '',
        paneId: 'pane-1',
        filePath: 'site/index.html',
      },
      global: { stubs: { MonacoEditor: true } },
    })
  }

  afterEach(function resetAuthFetch() {
    authFetchMock.mockReset()
    vi.useRealTimers()
  })

  async function mountAndSettle(htmlShowPreview: boolean) {
    // Fake timers must be installed before mount: the preview rebuild is
    // debounced, so a timer created on the real clock would never fire here.
    vi.useFakeTimers()
    const wrapper = mountHtml(htmlShowPreview)
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
    return wrapper
  }

  it('拿到令牌后应注入 base，让 iframe 自己加载相对资源', async function rendersBaseHref() {
    authFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ token: 'tok123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const wrapper = await mountAndSettle(true)
    const iframe = wrapper.find('iframe')
    expect(iframe.exists()).toBe(true)
    expect(iframe.attributes('sandbox')).toContain('allow-scripts')
    const srcdoc = unescapeHtml(iframe.attributes('srcdoc'))
    expect(srcdoc).toMatch(/<base href="[^"]*\/preview-ws\/tok123\/">/)
    // The document keeps its own relative references: the browser resolves them
    // against the base, which is what makes script-built URLs work too.
    expect(srcdoc).toContain('src="logo.png"')
  })

  it('拿不到令牌时应回退到 raw 端点改写', async function fallsBackToRawUrls() {
    authFetchMock.mockResolvedValue(new Response(null, { status: 401 }))
    const wrapper = await mountAndSettle(true)
    const srcdoc = unescapeHtml(wrapper.find('iframe').attributes('srcdoc'))
    expect(srcdoc).not.toContain('<base')
    expect(srcdoc).toContain('/api/workspace/raw?pane_id=pane-1&path=site%2Flogo.png')
  })

  it('源码模式应渲染编辑器而非 iframe', function rendersSource() {
    const wrapper = mountHtml(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('.file-editor-root').exists()).toBe(true)
  })
})

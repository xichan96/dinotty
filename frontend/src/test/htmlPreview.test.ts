import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  isWorkspaceRelativeRef,
  resolveRelativePath,
  rewriteHtmlPreview,
} from '../utils/htmlPreview'
import FilePreviewContent from '../components/workspace/FilePreviewContent.vue'

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

  it('预览模式应渲染改写后的 srcdoc iframe', function rendersIframe() {
    const wrapper = mountHtml(true)
    const iframe = wrapper.find('iframe')
    expect(iframe.exists()).toBe(true)
    expect(iframe.attributes('sandbox')).toContain('allow-scripts')
    expect(unescapeHtml(iframe.attributes('srcdoc'))).toContain(
      '/api/workspace/raw?pane_id=pane-1&path=site%2Flogo.png'
    )
  })

  it('源码模式应渲染编辑器而非 iframe', function rendersSource() {
    const wrapper = mountHtml(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('.file-editor-root').exists()).toBe(true)
  })
})

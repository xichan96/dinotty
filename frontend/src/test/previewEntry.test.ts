import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The native preview window is a separate Vite entry. A copy-paste slip
// (mounting main.ts, or forgetting the #app node) would leave the window blank
// with no build error, so pin the HTML contract down.

const PREVIEW_HTML = path.resolve(__dirname, '../../preview.html')
const INDEX_HTML = path.resolve(__dirname, '../../index.html')

describe('preview HTML entry', () => {
  it('mounts /src/preview.ts into #app', () => {
    const html = fs.readFileSync(PREVIEW_HTML, 'utf8')

    expect(html).toMatch(/<div id="app"><\/div>/)
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="\/src\/preview\.ts"/)
  })

  it('does not reuse the main or detached window entry', () => {
    const preview = fs.readFileSync(PREVIEW_HTML, 'utf8')
    const main = fs.readFileSync(INDEX_HTML, 'utf8')

    expect(preview).not.toContain('/src/main.ts')
    expect(preview).not.toContain('/src/detached.ts')
    expect(main).toContain('/src/main.ts')
  })

  it('is registered as a build input', () => {
    const viteConfig = fs.readFileSync(path.resolve(__dirname, '../../vite.config.ts'), 'utf8')
    expect(viteConfig).toContain("'./preview.html'")
  })
})

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The detached window is a separate Vite entry. A copy-paste slip (mounting
// main.ts, or forgetting the #app node) would leave the window blank with no
// build error, so pin the HTML contract down.

const DETACHED_HTML = path.resolve(__dirname, '../../detached.html')
const INDEX_HTML = path.resolve(__dirname, '../../index.html')

describe('detached HTML entry', () => {
  it('mounts /src/detached.ts into #app', () => {
    const html = fs.readFileSync(DETACHED_HTML, 'utf8')

    expect(html).toMatch(/<div id="app"><\/div>/)
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="\/src\/detached\.ts"/)
  })

  it('does not reuse the main window entry', () => {
    const detached = fs.readFileSync(DETACHED_HTML, 'utf8')
    const main = fs.readFileSync(INDEX_HTML, 'utf8')

    expect(detached).not.toContain('/src/main.ts')
    expect(main).toContain('/src/main.ts')
  })
})

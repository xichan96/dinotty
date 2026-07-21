import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// These checks assert CSS rule text only; they do not verify rendered geometry.
const css = readFileSync(resolve(process.cwd(), 'src/styles/mission-control.css'), 'utf8')
const mobileStart = css.indexOf('@media (max-width: 600px)')
const mobileEnd = css.indexOf('/* ── "Add tab" card', mobileStart)
const mobileCss = css.slice(mobileStart, mobileEnd)

describe('mission control mobile layout', () => {
  it('reserves the close button area in the first workspace row', () => {
    expect(mobileCss).toMatch(/\.mc-ws-list-item:first-child\s*{[^}]*padding-right:\s*60px;/s)
    expect(mobileCss).toMatch(/\.mc-ws-list-item:first-child\s*{[^}]*min-height:\s*46px;/s)
  })

  it('provides a 44px close-button touch target inside the mobile override', () => {
    expect(mobileCss).toMatch(/\.mc-close-btn\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s)
  })
})

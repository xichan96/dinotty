import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// These checks assert CSS rule text only; they do not verify rendered geometry.
const css = readFileSync(resolve(process.cwd(), 'src/styles/mission-control.css'), 'utf8')
const mobileStart = css.indexOf('@media (max-width: 600px)')
const mobileEnd = css.indexOf('/* ── "Add tab" card', mobileStart)
const mobileCss = css.slice(mobileStart, mobileEnd)

describe('mission control mobile layout', () => {
  it('turns the workspace list into a horizontally scrollable chip row', () => {
    expect(mobileCss).toMatch(/\.mc-ws-list-scroll\s*{[^}]*flex-direction:\s*row;/s)
    expect(mobileCss).toMatch(/\.mc-ws-list-scroll\s*{[^}]*overflow-x:\s*auto;/s)
    expect(mobileCss).toMatch(/\.mc-ws-list-scroll\s*{[^}]*touch-action:\s*pan-x;/s)
  })

  it('renders workspaces as non-shrinking pill chips', () => {
    expect(mobileCss).toMatch(/\.mc-ws-list-item\s*{[^}]*flex-shrink:\s*0;/s)
    expect(mobileCss).toMatch(/\.mc-ws-list-item\s*{[^}]*border-radius:\s*999px;/s)
  })

  it('hides the drag handle in the chip row', () => {
    expect(mobileCss).toMatch(/\.mc-ws-drag-handle\s*{[^}]*display:\s*none;/s)
  })

  it('caps chip label width so long names cannot fill the row', () => {
    expect(mobileCss).toMatch(/\.mc-ws-name\s*{[^}]*max-width:/s)
  })

  it('reserves the close-button area outside the chip scroll region', () => {
    expect(mobileCss).toMatch(/\.mc-ws-list\s*{[^}]*padding-right:\s*56px;/s)
    expect(mobileCss).not.toMatch(/padding-right:\s*60px/)
    expect(mobileCss).not.toMatch(/max-height:\s*40%/)
  })

  it('keeps add-workspace as a pill chip with a 40px target', () => {
    expect(mobileCss).toMatch(/\.mc-ws-add-btn\s*{[^}]*height:\s*40px;/s)
    expect(mobileCss).toMatch(/\.mc-ws-add-btn\s*{[^}]*border-radius:\s*999px;/s)
    expect(mobileCss).toMatch(/\.mc-ws-add-label\s*{[^}]*display:\s*none;/s)
  })

  it('provides a 44px close-button touch target inside the mobile override', () => {
    expect(mobileCss).toMatch(/\.mc-close-btn\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s)
  })
})

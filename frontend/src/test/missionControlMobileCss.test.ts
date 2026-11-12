import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// These checks assert CSS rule text only; they do not verify rendered geometry.
const css = readFileSync(resolve(process.cwd(), 'src/styles/mission-control.css'), 'utf8')
const mobileStart = css.indexOf('@media (max-width: 600px)')
const mobileEnd = css.indexOf('/* ── "Add tab" card', mobileStart)
const mobileCss = css.slice(mobileStart, mobileEnd)

describe('mission control mobile layout', () => {
  it('replaces the horizontal chip row with a current-workspace button', () => {
    expect(mobileCss).toMatch(/\.mc-ws-list\s*{[^}]*display:\s*none;/s)
    expect(mobileCss).toMatch(/\.mc-mobile-ws-head\s*{[^}]*display:\s*flex;/s)
    expect(mobileCss).toMatch(/\.mc-mobile-ws-current\s*{[^}]*height:\s*42px;/s)
  })

  it('renders recent workspaces as compact pill chips', () => {
    expect(mobileCss).toMatch(/\.mc-mobile-ws-recent\s*{[^}]*border-radius:\s*999px;/s)
    expect(mobileCss).toMatch(/\.mc-mobile-ws-recent\s*{[^}]*flex:\s*0 0 auto;/s)
  })

  it('caps recent chip label width so long names cannot fill the row', () => {
    expect(mobileCss).toMatch(/\.mc-mobile-ws-recent-name\s*{[^}]*max-width:/s)
  })

  it('adds a dedicated search button beside the current workspace', () => {
    expect(mobileCss).toMatch(/\.mc-mobile-ws-search\s*{[^}]*width:\s*38px;/s)
    expect(mobileCss).toMatch(/\.mc-mobile-ws-search\s*{[^}]*height:\s*38px;/s)
  })

  it('reserves the close-button area outside the header content', () => {
    expect(mobileCss).toMatch(/\.mc-mobile-ws-head\s*{[^}]*padding:\s*8px 56px 8px 12px;/s)
    expect(mobileCss).not.toMatch(/padding-right:\s*60px/)
    expect(mobileCss).not.toMatch(/max-height:\s*40%/)
  })

  it('provides a 44px close-button touch target inside the mobile override', () => {
    expect(mobileCss).toMatch(/\.mc-close-btn\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s)
  })

  // The server switcher used to be a row of this overlay, with its own mobile
  // sheet. It is the status bar's picker now, so those rules are gone.
  it('leaves nothing of the old in-overlay server bar behind', () => {
    expect(css).not.toMatch(/\.mc-srv-/)
  })
})

describe('desktop workspace search', () => {
  it('pins a search field above the workspace list', () => {
    expect(css).toMatch(/\.mc-ws-search-wrap\s*{[^}]*flex:\s*0 0 auto;/s)
    expect(css).toMatch(/\.mc-ws-search\s*{[^}]*height:\s*32px;/s)
  })

  it('expands result rows to show the workspace path', () => {
    expect(css).toMatch(/\.mc-ws-list-item\.searching\s*{[^}]*height:\s*52px;/s)
    expect(css).toMatch(/\.mc-ws-path\s*{[^}]*text-overflow:\s*ellipsis;/s)
  })
})

describe('workspace picker sheet', () => {
  it('gives the bottom sheet room for search plus a useful number of rows', () => {
    expect(css).toMatch(
      /\.dialog\.dialog--bottom-sheet\.ws-picker-sheet\s*{[^}]*height:\s*min\(86vh, 760px\);/s
    )
    expect(css).toMatch(
      /\.dialog\.dialog--bottom-sheet\.ws-picker-sheet\s*{[^}]*max-height:\s*86vh;/s
    )
  })

  it('lets the workspace list own the scroll instead of the whole sheet', () => {
    expect(css).toMatch(/\.dialog\.ws-picker-sheet \.dialog-body\s*{[^}]*overflow:\s*hidden;/s)
  })
})

describe('mission control pane resizer', () => {
  it('sizes the workspace list from the resizer variable', () => {
    expect(css).toMatch(/\.mc-ws-list\s*{[^}]*width:\s*var\(--mc-ws-list-width, 200px\);/s)
    expect(css).toMatch(/\.mc-ws-list\s*{[^}]*min-width:\s*var\(--mc-ws-list-width, 200px\);/s)
    expect(css).toMatch(/\.mc-ws-resizer\s*{[^}]*cursor:\s*col-resize;/s)
  })

  it('hides the column resizer in the stacked mobile layout', () => {
    expect(mobileCss).toMatch(/\.mc-ws-resizer\s*{[^}]*display:\s*none;/s)
  })
})

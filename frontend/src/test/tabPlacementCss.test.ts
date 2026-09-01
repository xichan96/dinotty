import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// These checks assert CSS rule text only; they do not verify rendered geometry.
const css = readFileSync(resolve(process.cwd(), 'src/styles/layout.css'), 'utf8')
const baseCss = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8')
const tabBarSource = readFileSync(
  resolve(process.cwd(), 'src/components/terminal/TabBar.vue'),
  'utf8'
)
const appSource = readFileSync(resolve(process.cwd(), 'src/App.vue'), 'utf8')

// Every menu that hangs off a tab bar control, and the file its rules live in.
const TAB_BAR_DROPDOWNS: [string, string][] = [
  ['new-menu-dropdown', tabBarSource],
  ['plugin-dropdown', tabBarSource],
  ['preview-menu-dropdown', appSource],
]

describe('workbench placement axis', () => {
  it('keeps the default column flow so the status bar stays below the content', () => {
    expect(css).toMatch(/\.workbench\s*{[^}]*flex-direction:\s*column;/s)
    expect(css).toMatch(/\.workbench\s*{[^}]*flex:\s*1;/s)
  })

  it.each([
    ['top', 'column'],
    ['bottom', 'column-reverse'],
    ['left', 'row'],
    ['right', 'row-reverse'],
  ])('maps placement-%s to flex-direction %s', (mode, direction) => {
    expect(css).toMatch(
      new RegExp(`\\.workbench\\.placement-${mode}\\s*{[^}]*flex-direction:\\s*${direction};`, 's')
    )
  })
})

describe('tab bar placement', () => {
  it('moves the divider and the safe area to the bottom edge in bottom mode', () => {
    expect(css).toMatch(
      /#tab-bar\.placement-bottom\s*{[^}]*border-top:\s*1px solid var\(--border\);/s
    )
    expect(css).toMatch(/#tab-bar\.placement-bottom\s*{[^}]*border-bottom:\s*none;/s)
    expect(css).toMatch(
      /#tab-bar\.placement-bottom\s*{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom, 0px\);/s
    )
  })

  it('turns the bar into a fixed-width column when vertical', () => {
    expect(css).toMatch(/#tab-bar\.is-vertical\s*{[^}]*flex-direction:\s*column;/s)
    expect(css).toMatch(
      /#tab-bar\.is-vertical\s*{[^}]*width:\s*var\(--tab-sidebar-width, 180px\);/s
    )
    expect(css).toMatch(/#tab-bar\.is-vertical\s*{[^}]*height:\s*100%;/s)
  })

  it('puts the divider on the inner edge for each vertical side', () => {
    expect(css).toMatch(
      /#tab-bar\.placement-left\s*{[^}]*border-right:\s*1px solid var\(--border\);/s
    )
    expect(css).toMatch(
      /#tab-bar\.placement-right\s*{[^}]*border-left:\s*1px solid var\(--border\);/s
    )
  })
})

describe('vertical tabs list', () => {
  it('stacks and scrolls along the vertical axis', () => {
    expect(css).toMatch(/#tabs-list\.is-vertical\s*{[^}]*flex-direction:\s*column;/s)
    expect(css).toMatch(/#tabs-list\.is-vertical\s*{[^}]*overflow-y:\s*auto;/s)
    expect(css).toMatch(/#tabs-list\.is-vertical\s*{[^}]*overflow-x:\s*hidden;/s)
  })

  it('uses pan-y touch action so the list can be flicked on touch devices', () => {
    expect(css).toMatch(/#tabs-list\.is-vertical\s*{[^}]*touch-action:\s*pan-y;/s)
    expect(css).toMatch(/#tabs-list\.is-vertical \.tab\s*{[^}]*touch-action:\s*pan-y;/s)
  })

  it('fades along the vertical axis', () => {
    expect(css).toMatch(
      /#tabs-list\.is-vertical\.fade-start\s*{[^}]*mask-image:\s*linear-gradient\(\s*to bottom/s
    )
    expect(css).toMatch(
      /#tabs-list\.is-vertical\.fade-end\s*{[^}]*mask-image:\s*linear-gradient\(\s*to bottom/s
    )
  })

  it('keeps vertical tabs the same height as horizontal ones', () => {
    expect(css).toMatch(/#tabs-list\.is-vertical \.tab\s*{[^}]*flex:\s*0 0 var\(--tab-height\);/s)
    expect(css).toMatch(/#tabs-list\.is-vertical \.tab\s*{[^}]*height:\s*var\(--tab-height\);/s)
    expect(css).toMatch(/#tabs-list\.is-vertical \.tab\s*{[^}]*max-width:\s*none;/s)
  })

  it('marks the active vertical tab with background only, not the accent underline', () => {
    expect(css).toMatch(/#tabs-list\.is-vertical \.tab\.active::after\s*{[^}]*content:\s*none;/s)
  })
})

describe('vertical toolbar compaction', () => {
  it('wraps the tab bar controls in a container that is invisible to layout by default', () => {
    // display: contents makes the wrapper generate no box, so the horizontal
    // placements lay out exactly as they did before the wrapper existed.
    expect(tabBarSource).toMatch(/<div class="tab-bar-tools">/)
    expect(css).toMatch(/\.tab-bar-tools\s*{[^}]*display:\s*contents;/s)
  })

  it('turns the controls into a wrapped grid when vertical instead of one row each', () => {
    expect(css).toMatch(/#tab-bar\.is-vertical \.tab-bar-tools\s*{[^}]*display:\s*flex;/s)
    expect(css).toMatch(/#tab-bar\.is-vertical \.tab-bar-tools\s*{[^}]*flex-wrap:\s*wrap;/s)
  })

  it('sizes the vertical controls from a dedicated compact variable', () => {
    expect(baseCss).toMatch(/--tab-sidebar-btn:\s*\d+px;/)
    expect(css).toMatch(
      /#tab-bar\.is-vertical \.tab-bar-tools > \*\s*{[^}]*flex:\s*0 0 var\(--tab-sidebar-btn\);/s
    )
    expect(css).toMatch(
      /#tab-bar\.is-vertical \.tab-bar-tools > \*\s*{[^}]*height:\s*var\(--tab-sidebar-btn\);/s
    )
  })

  it('no longer stretches each control to a full-width row', () => {
    expect(css).not.toMatch(/#tab-bar\.is-vertical > \.new-tab-split\b/)
    expect(css).not.toMatch(/#tab-bar\.is-vertical > \.preview-menu-wrap\b/)
  })

  it('keeps the tabs list as the element that absorbs the leftover height', () => {
    expect(css).toMatch(/#tab-bar\.is-vertical #tabs-list\s*{[^}]*flex:\s*1 1 auto;/s)
    expect(css).toMatch(/#tab-bar\.is-vertical #tabs-list\s*{[^}]*min-height:\s*0;/s)
  })
})

describe('sidebar resizer', () => {
  it('anchors to the inner edge of each vertical side', () => {
    expect(css).toMatch(/\.placement-left \.tab-sidebar-resizer\s*{[^}]*right:\s*0;/s)
    expect(css).toMatch(/\.placement-right \.tab-sidebar-resizer\s*{[^}]*left:\s*0;/s)
  })

  it('offers a col-resize cursor and an widened hit area', () => {
    expect(css).toMatch(/\.tab-sidebar-resizer\s*{[^}]*cursor:\s*col-resize;/s)
    expect(css).toMatch(/\.tab-sidebar-resizer::before\s*{[^}]*left:\s*-3px;/s)
  })
})

describe('tab bar dropdown flipping', () => {
  it('opens the new-tab and plugin menus upward in bottom mode', () => {
    expect(tabBarSource).toMatch(/\.placement-bottom \.new-menu-dropdown\s*{[^}]*bottom:\s*100%;/s)
    expect(tabBarSource).toMatch(/\.placement-bottom \.plugin-dropdown\s*{[^}]*bottom:\s*100%;/s)
  })

  it('opens the menus sideways in vertical mode', () => {
    // The selector may be grouped with .align-right, so allow more selectors
    // between the anchor and the block.
    expect(tabBarSource).toMatch(/\.placement-left \.new-menu-dropdown[^{}]*{[^}]*left:\s*100%;/s)
    expect(tabBarSource).toMatch(/\.placement-right \.new-menu-dropdown[^{}]*{[^}]*right:\s*100%;/s)
  })

  it('flips the drag-over insertion marker to the top edge when vertical', () => {
    expect(tabBarSource).toMatch(
      /\.is-vertical \.tab\.drag-over\s*{[^}]*border-top:\s*2px solid var\(--accent, #8a8a8a\);/s
    )
  })
})

// Each menu's positioned wrapper, and the file its rules live in.
const TAB_BAR_DROPDOWN_WRAPS: [string, string][] = [
  ['new-tab-split', tabBarSource],
  ['tab-bar-plugin-wrap', tabBarSource],
  ['preview-menu-wrap', appSource],
]

describe('vertical dropdown containment', () => {
  // Horizontally each wrapper is the containing block, which is right: the menu
  // hangs off its own button. Vertically the wrapper is a 30px square in the
  // control grid, so anchoring to it would open the menu mid-sidebar. Dropping
  // the wrapper to static hands the containing block to #tab-bar, which already
  // has position: relative, so the menu anchors to the sidebar's own edges.
  it.each(TAB_BAR_DROPDOWN_WRAPS)(
    'makes .%s stop being the containing block when vertical',
    (name, source) => {
      expect(source).toMatch(
        new RegExp(`\\.is-vertical \\.${name}\\s*{[^}]*position:\\s*static;`, 's')
      )
    }
  )

  it('keeps the sidebar itself as the positioning context', () => {
    expect(css).toMatch(/#tab-bar\.is-vertical\s*{[^}]*position:\s*relative;/s)
  })

  // The vertical controls sit at the very bottom of the sidebar, so a menu that
  // still grows downward from its button runs straight off the viewport. These
  // rules anchor it to the sidebar's bottom edge and cap its height instead.
  it.each(TAB_BAR_DROPDOWNS)('anchors .%s to the sidebar bottom when vertical', (name, source) => {
    expect(source).toMatch(new RegExp(`\\.is-vertical \\.${name}\\s*{[^}]*top:\\s*auto;`, 's'))
    expect(source).toMatch(new RegExp(`\\.is-vertical \\.${name}\\s*{[^}]*bottom:\\s*0;`, 's'))
  })

  it.each(TAB_BAR_DROPDOWNS)('caps .%s to the sidebar height when vertical', (name, source) => {
    // The containing block is the sidebar, so 100% is exactly the room above
    // the anchored bottom edge — no viewport arithmetic to get wrong.
    expect(source).toMatch(
      new RegExp(`\\.is-vertical \\.${name}\\s*{[^}]*max-height:\\s*100%;`, 's')
    )
    expect(source).toMatch(
      new RegExp(`\\.is-vertical \\.${name}\\s*{[^}]*overflow-y:\\s*auto;`, 's')
    )
  })

  it.each(TAB_BAR_DROPDOWNS)(
    'caps .%s width to the room left beside the sidebar',
    (name, source) => {
      // Subtracting the live sidebar width keeps the menu on screen even after
      // the user drags the sidebar wide.
      expect(source).toMatch(
        new RegExp(
          `\\.is-vertical \\.${name}\\s*{[^}]*max-width:\\s*min\\([^;]*100vw[^;]*--tab-sidebar-width[^;]*;`,
          's'
        )
      )
    }
  )

  it('flips a left-docked menu back inside when it would overflow the right edge', () => {
    // No room outside the sidebar: overlap it instead of leaving the viewport.
    expect(tabBarSource).toMatch(
      /\.placement-left \.new-menu-dropdown\.overflow-flip\s*{[^}]*left:\s*auto;/s
    )
    expect(tabBarSource).toMatch(
      /\.placement-right \.new-menu-dropdown\.overflow-flip\s*{[^}]*right:\s*auto;/s
    )
  })

  it('measures the available side room before opening the new-tab menu', () => {
    expect(tabBarSource).toMatch(/newMenuOverflowFlip/)
    expect(tabBarSource).toMatch(/'overflow-flip': newMenuOverflowFlip/)
  })

  it('measures against the sidebar, not the button, when deciding to flip', () => {
    // The button is a 30px square inside the grid; its own edge says nothing
    // about how much room the menu has outside the sidebar.
    expect(tabBarSource).toMatch(/closest\('#tab-bar'\)/)
  })
})

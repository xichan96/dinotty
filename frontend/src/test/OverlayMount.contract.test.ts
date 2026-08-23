import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Host-frozen invariants from global-overlay-design.md §二/§三/§四. The overlay
// host mounts as a sibling of #app-root (so the app capture handlers never see
// its events), holds the z-index band at 600, and keeps the pointer-events
// three-layer model (item none / widget auto). Source-level assertions mirror
// the AppKeyboardRender.contract.test.ts precedent; the behavioral side lives
// in the store / drag / component specs.

const appSource = readFileSync(join(process.cwd(), 'src/App.vue'), 'utf8')
const coreSource = readFileSync(join(process.cwd(), 'src/composables/useAppCore.ts'), 'utf8')
const hostSource = readFileSync(
  join(process.cwd(), 'src/components/plugin/PluginOverlayHost.vue'),
  'utf8'
)
const itemSource = readFileSync(
  join(process.cwd(), 'src/components/plugin/OverlayDragItem.vue'),
  'utf8'
)

describe('overlay host mount + layer contract', () => {
  it('mounts the overlay host as a sibling of #app-root, gated on authenticated', () => {
    expect(appSource).toMatch(
      /<\/div>\s*<PluginOverlayHost v-if="authenticated" :get-plugin-context="getPluginContext" \/>\s*<\/template>/
    )
  })

  it('provides focusActive to the overlay host for R4 focus restore', () => {
    expect(coreSource).toMatch(/provide\(FOCUS_ACTIVE_KEY, focusActive\)/)
  })

  it('keeps the layer z-index band at 600 with pointer-events none', () => {
    expect(hostSource).toMatch(
      /\.overlay-layer\s*\{[^}]*z-index:\s*600;[^}]*pointer-events:\s*none;/s
    )
  })

  it('skips mounting the fixed layer when no overlays are registered', () => {
    expect(hostSource).toMatch(/v-if="visibleOverlays\.length > 0"/)
  })

  it('keeps item non-interactive and widget interactive (three-layer model)', () => {
    expect(itemSource).toMatch(/\.overlay-item\s*\{[^}]*pointer-events:\s*none;/s)
    expect(itemSource).toMatch(/\.overlay-widget\s*\{[^}]*pointer-events:\s*auto;/s)
    expect(itemSource).toMatch(/touch-action:\s*none/)
  })

  it('injects the plugin api into the overlay component', () => {
    expect(itemSource).toMatch(/:api="api"/)
  })
})

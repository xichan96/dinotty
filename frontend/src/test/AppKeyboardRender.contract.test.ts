import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Phase 3 host contract (keyboard-plugin-design.md §三): the keyboard slot
// renders whichever provider the registry resolves — the bundled builtin-keyboard
// OR a third-party keyboard plugin id. System stays host-frozen: the resolved
// system provider never carries a component (registerComponent refuses it), so
// the slot stays empty and the SystemKeyboardToolbar branch takes over.
//
// Source-level assertions mirror the existing KeyboardTab.systemEditor.test.ts
// precedent; the behavioral side (registry guards, id matching, band, bundle
// load) is covered by the composable and plugin-bundle contract suites.

const source = readFileSync(join(process.cwd(), 'src/App.vue'), 'utf8')
const coreSource = readFileSync(join(process.cwd(), 'src/composables/useAppCore.ts'), 'utf8')

describe('App.vue keyboard render contract (Phase 3)', () => {
  it('gates the plugin component slot on the resolved provider component', () => {
    expect(source).toMatch(
      /<component\s+:is="keyboardProviderComponent"\s+v-if="keyboardProviderComponent"\s+ref="keyboardHostRef"\s+:ctx="keyboardCtx"\s*\/>/
    )
  })

  it('keeps the in-core builtin fallback chained to the builtin mode only', () => {
    expect(source).toMatch(/v-else-if="effectiveMobileInputMode === 'builtin'"/)
  })

  it('derives the provider component from the resolved active provider', () => {
    expect(coreSource).toMatch(
      /const keyboardProviderComponent = computed\(\(\) => activeKeyboardProvider\.value\?\.component\)/
    )
  })
})

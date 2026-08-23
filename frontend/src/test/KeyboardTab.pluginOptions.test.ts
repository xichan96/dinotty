import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import KeyboardTab from '../components/settings/KeyboardTab.vue'
import { settings } from '../composables/useSettings'
import { useKeyboardProviders } from '../composables/useKeyboardProviders'
import { loadedPlugins } from '../composables/usePluginLoader'

// Phase 3 contract: an installed third-party keyboard plugin surfaces as an
// extra mobile_input_mode choice, named from its manifest, alongside the two
// host-frozen entries (builtin-keyboard / system).

let wrapper: VueWrapper | null = null

const registeredIds: string[] = []

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  const { unregisterComponent } = useKeyboardProviders()
  for (const id of registeredIds) unregisterComponent(id)
  registeredIds.length = 0
  loadedPlugins.clear()
})

function registerPluginKeyboard(id: string, name: string) {
  useKeyboardProviders().registerComponent(id, 'plugin', defineComponent({ template: '<div />' }))
  registeredIds.push(id)
  loadedPlugins.set(id, {
    id,
    manifest: { id, name, version: '1.0.0' },
    module: { activate: () => ({}) },
    exports: null,
    state: 'active',
  })
}

function optionLabels(): string[] {
  return wrapper!
    .get('[data-setting="mobile-input-mode"]')
    .findAll('[role="radio"]')
    .map((button) => button.text())
}

describe('KeyboardTab mobile input mode options', () => {
  it('lists a registered third-party keyboard plugin by its manifest name', () => {
    settings.locale = 'en'
    settings.mobile_input_mode = 'builtin'
    registerPluginKeyboard('mini-keyboard', 'Mini Keyboard')

    wrapper = mount(KeyboardTab)

    const labels = optionLabels()
    // Order: builtin, system, then plugin contributions.
    expect(labels).toEqual(['Dinotty keyboard', 'System keyboard', 'Mini Keyboard'])
  })

  it('does not surface builtin-keyboard or system as plugin options', () => {
    settings.locale = 'en'
    settings.mobile_input_mode = 'system'
    registerPluginKeyboard('builtin-keyboard', 'Builtin Keyboard')

    wrapper = mount(KeyboardTab)

    expect(optionLabels()).toEqual(['Dinotty keyboard', 'System keyboard'])
  })
})

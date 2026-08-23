import { describe, expect, it } from 'vitest'
import { HOST_PLUGIN_VIEWS, hasHostPluginView } from '../utils/hostPluginViews'
import BuiltinKeyboardInfo from '../components/settings/BuiltinKeyboardInfo.vue'

describe('host plugin view registry', () => {
  it('maps builtin-keyboard to its info card view', () => {
    expect(HOST_PLUGIN_VIEWS['builtin-keyboard']).toBe(BuiltinKeyboardInfo)
  })

  it('reports registered ids and rejects unknown plugin ids', () => {
    expect(hasHostPluginView('builtin-keyboard')).toBe(true)
    expect(hasHostPluginView('mini-keyboard')).toBe(false)
  })
})

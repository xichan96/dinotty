import { describe, it, expect } from 'vitest'
import { defineComponent } from 'vue'
import {
  useKeyboardProviders,
  initHostKeyboardProviders,
  BUILTIN_KEYBOARD_ID,
  SYSTEM_KEYBOARD_ID,
} from '../useKeyboardProviders'

// Contract tests for the host invariants in keyboard-plugin-design.md §二:
// the registry defaults to the bundled builtin keyboard and never lets an
// unregistered provider id become active.

describe('keyboard provider registry (contract: default hits builtin, §二 #3)', () => {
  initHostKeyboardProviders()
  const { providers, register, unregister, registerComponent, unregisterComponent, resolveActive } =
    useKeyboardProviders()

  it('registers both host providers exactly once', () => {
    initHostKeyboardProviders()
    expect(providers.value.get(BUILTIN_KEYBOARD_ID)?.kind).toBe('host')
    expect(providers.value.get(SYSTEM_KEYBOARD_ID)?.kind).toBe('host')
    expect(providers.value.size).toBe(2)
  })

  it('resolves null mode to builtin-keyboard', () => {
    expect(resolveActive(null)).toBe(BUILTIN_KEYBOARD_ID)
  })

  it('resolves undefined mode to builtin-keyboard', () => {
    expect(resolveActive(undefined)).toBe(BUILTIN_KEYBOARD_ID)
  })

  it("resolves 'builtin' to builtin-keyboard", () => {
    expect(resolveActive('builtin')).toBe(BUILTIN_KEYBOARD_ID)
  })

  it("resolves 'system' to system", () => {
    expect(resolveActive('system')).toBe(SYSTEM_KEYBOARD_ID)
  })

  it('falls back to builtin-keyboard for an unregistered plugin id', () => {
    expect(resolveActive('some-unregistered-keyboard')).toBe(BUILTIN_KEYBOARD_ID)
  })

  it('resolves a registered plugin provider id', () => {
    register({ id: 'test-keyboard', kind: 'plugin' })
    expect(resolveActive('test-keyboard')).toBe('test-keyboard')
    unregister('test-keyboard')
  })

  it('falls back to builtin-keyboard after the plugin provider is unregistered', () => {
    register({ id: 'test-keyboard', kind: 'plugin' })
    unregister('test-keyboard')
    expect(resolveActive('test-keyboard')).toBe(BUILTIN_KEYBOARD_ID)
  })

  it('attaches a plugin component to the host builtin entry and restores it on detach', () => {
    const component = defineComponent({ template: '<div />' })
    registerComponent(BUILTIN_KEYBOARD_ID, 'plugin', component, 'auto')
    const attached = providers.value.get(BUILTIN_KEYBOARD_ID)
    // Host kind is preserved so unloading restores the in-core fallback.
    expect(attached?.kind).toBe('host')
    expect(attached?.component).toStrictEqual(component)
    // Phase 2: the reservation band travels with the contribution.
    expect(attached?.desiredHeight).toBe('auto')

    unregisterComponent(BUILTIN_KEYBOARD_ID)
    const restored = providers.value.get(BUILTIN_KEYBOARD_ID)
    expect(restored?.kind).toBe('host')
    expect(restored?.component).toBeUndefined()
    expect(restored?.desiredHeight).toBeUndefined()
  })

  it('carries a fixed desiredHeight through registration', () => {
    const component = defineComponent({ template: '<div />' })
    registerComponent('fixed-keyboard', 'plugin', component, 280)
    expect(providers.value.get('fixed-keyboard')?.desiredHeight).toBe(280)
    unregisterComponent('fixed-keyboard')
    expect(providers.value.has('fixed-keyboard')).toBe(false)
  })

  it('attaches and removes a third-party plugin provider component', () => {
    const component = defineComponent({ template: '<div />' })
    registerComponent('test-keyboard', 'plugin', component)
    expect(providers.value.get('test-keyboard')?.component).toStrictEqual(component)

    unregisterComponent('test-keyboard')
    expect(providers.value.has('test-keyboard')).toBe(false)
  })

  it('never lets a plugin contribution attach to the host-frozen system provider', () => {
    const component = defineComponent({ template: '<div />' })
    registerComponent(SYSTEM_KEYBOARD_ID, 'plugin', component)
    const system = providers.value.get(SYSTEM_KEYBOARD_ID)
    expect(system?.kind).toBe('host')
    expect(system?.component).toBeUndefined()
    expect(system?.desiredHeight).toBeUndefined()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { settings, applyCurrentTheme, getCurrentXtermTheme } from '../composables/useSettings'
import { setThemeSelection, clearThemeSelection } from '../composables/useDeviceThemeSelection'

// happy-dom's localStorage is shadowed by Node's native (throwing) localStorage in
// this env; install a working in-memory Storage so setThemeSelection's persist path
// runs instead of hitting the throwing native impl (which would trip the A6 rollback).
beforeEach(() => {
  const store = new Map<string, string>()
  const mock: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k)
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
  }
  vi.stubGlobal('localStorage', mock)
  try {
    Object.defineProperty(window, 'localStorage', { value: mock, configurable: true, writable: true })
  } catch {
    // window.localStorage may be a non-configurable getter — vi.stubGlobal above still covers it.
  }
})

describe('theme wiring', () => {
  it('module graph initializes without throwing', () => {
    expect(applyCurrentTheme).toBeTypeOf('function')
    expect(getCurrentXtermTheme).toBeTypeOf('function')
  })

  it('applyCurrentTheme applies a complete var set with no selection (server default)', () => {
    clearThemeSelection()
    applyCurrentTheme()

    const style = document.documentElement.style
    expect(style.getPropertyValue('--bg')).not.toBe('')
    expect(style.getPropertyValue('--tab-bg')).not.toBe('')
    expect(style.getPropertyValue('--fg-muted')).not.toBe('')
  })

  it('custom selection applies its stored colors', () => {
    settings.custom_themes.push({
      uuid: 'u1',
      name: 'Device Custom',
      colors: {
        background: '#101010',
        foreground: '#eeeeee',
        cursor: '#ff00ff',
        ansi: Array.from({ length: 16 }, (_, i) => `#${(i + 1).toString(16).padStart(6, '0')}`),
      },
    })

    setThemeSelection({ kind: 'custom', uuid: 'u1' })
    applyCurrentTheme()

    const style = document.documentElement.style
    expect(style.getPropertyValue('--bg')).toBe('#101010')
    expect(style.getPropertyValue('--fg')).toBe('#eeeeee')
    expect(getCurrentXtermTheme().cursor).toBe('#ff00ff')

    clearThemeSelection()
    settings.custom_themes = settings.custom_themes.filter((theme) => theme.uuid !== 'u1')
  })

  it('builtin selection with a tombstone falls back to server default', () => {
    const previousPreset = settings.theme.preset
    settings.theme.preset = 'dark'
    settings.hidden_builtins = ['nord']
    setThemeSelection({ kind: 'builtin', name: 'nord' })

    expect(() => applyCurrentTheme()).not.toThrow()
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#1E1E1E')

    clearThemeSelection()
    settings.hidden_builtins = []
    settings.theme.preset = previousPreset
  })
})

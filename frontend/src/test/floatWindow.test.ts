import { describe, it, expect } from 'vitest'
import {
  filesStatePaneId,
  floatWindowId,
  resolvePreviewOpenMode,
  type PreviewOpenMode,
} from '../types/floatWindow'

describe('resolvePreviewOpenMode', () => {
  it('falls back to the per-kind preference when no explicit mode is given', () => {
    const cases: Array<
      [PreviewOpenMode | undefined, PreviewOpenMode, boolean, boolean, PreviewOpenMode]
    > = [
      [undefined, 'split', false, true, 'split'],
      [undefined, 'floating', false, true, 'floating'],
      [undefined, 'window', false, true, 'window'],
    ]
    for (const [explicit, pref, touch, desktop, want] of cases) {
      expect(resolvePreviewOpenMode(explicit, pref, touch, desktop)).toBe(want)
    }
  })

  it('lets an explicit mode override the preference', () => {
    expect(resolvePreviewOpenMode('floating', 'split', false, true)).toBe('floating')
    expect(resolvePreviewOpenMode('split', 'floating', false, true)).toBe('split')
    expect(resolvePreviewOpenMode('window', 'split', false, true)).toBe('window')
  })

  it('always opens as a split pane on touch devices', () => {
    expect(resolvePreviewOpenMode(undefined, 'floating', true, true)).toBe('split')
    expect(resolvePreviewOpenMode('floating', 'floating', true, true)).toBe('split')
    expect(resolvePreviewOpenMode(undefined, 'window', true, true)).toBe('split')
  })

  it('downgrades the native-window mode to a float outside the desktop shell', () => {
    expect(resolvePreviewOpenMode(undefined, 'window', false, false)).toBe('floating')
    expect(resolvePreviewOpenMode('window', 'split', false, false)).toBe('floating')
  })
})

describe('floatWindowId', () => {
  it('uses the plugin id directly for plugin content (back-compat geometry key)', () => {
    expect(floatWindowId({ kind: 'plugin', pluginId: 'p1' })).toBe('p1')
  })

  it('keys built-in preview windows by their kind (one window per kind)', () => {
    expect(floatWindowId({ kind: 'files', sourcePaneId: 'T-1' })).toBe('float:files')
    expect(floatWindowId({ kind: 'web', initialUrl: 'https://x' })).toBe('float:web')
  })
})

describe('filesStatePaneId', () => {
  it('derives a unique per-session state pane id for the floating file browser', () => {
    expect(filesStatePaneId('T-1')).toBe('float:files:T-1')
  })
})

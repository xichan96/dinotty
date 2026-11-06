import { describe, it, expect } from 'vitest'
import {
  filesStatePaneId,
  floatWindowId,
  resolvePreviewOpenMode,
  type PreviewOpenMode,
} from '../types/floatWindow'

describe('resolvePreviewOpenMode', () => {
  it('falls back to the per-kind preference when no explicit mode is given', () => {
    const cases: Array<[PreviewOpenMode | undefined, PreviewOpenMode, boolean, PreviewOpenMode]> = [
      [undefined, 'split', true, 'split'],
      [undefined, 'floating', true, 'floating'],
      [undefined, 'window', true, 'window'],
    ]
    for (const [explicit, pref, desktop, want] of cases) {
      expect(resolvePreviewOpenMode(explicit, pref, desktop)).toBe(want)
    }
  })

  it('lets an explicit mode override the preference', () => {
    expect(resolvePreviewOpenMode('floating', 'split', true)).toBe('floating')
    expect(resolvePreviewOpenMode('split', 'floating', true)).toBe('split')
    expect(resolvePreviewOpenMode('window', 'split', true)).toBe('window')
  })

  it('downgrades the native-window mode to a float outside the desktop shell', () => {
    expect(resolvePreviewOpenMode(undefined, 'window', false)).toBe('floating')
    expect(resolvePreviewOpenMode('window', 'split', false)).toBe('floating')
  })

  /// Touch clients used to be forced into a split pane. The float is
  /// pointer-drag based and `PluginFloatWindow` clamps to the viewport, so a
  /// phone can honor the preference now.
  it('honors floating mode on touch clients', () => {
    expect(resolvePreviewOpenMode(undefined, 'floating', false)).toBe('floating')
    expect(resolvePreviewOpenMode('floating', 'split', false)).toBe('floating')
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

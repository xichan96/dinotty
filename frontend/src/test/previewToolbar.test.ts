import { describe, expect, it } from 'vitest'
import { normalizePreviewToolbarItems } from '../utils/previewToolbar'

describe('preview toolbar settings', () => {
  it('uses all toolbar actions in the default order when settings are absent', () => {
    expect(normalizePreviewToolbarItems(undefined)).toEqual([
      { id: 'broadcast', visible: true },
      { id: 'new_tab', visible: true },
      { id: 'plugins', visible: true },
      { id: 'files', visible: true },
      { id: 'web', visible: true },
      { id: 'reload', visible: true },
      { id: 'settings', visible: true },
      { id: 'notifications', visible: true },
    ])
  })

  it('preserves a valid custom order and puts missing actions back into the toolbar', () => {
    expect(normalizePreviewToolbarItems([{ id: 'web', visible: false }])).toEqual([
      { id: 'web', visible: false },
      { id: 'broadcast', visible: true },
      { id: 'new_tab', visible: true },
      { id: 'plugins', visible: true },
      { id: 'files', visible: true },
      { id: 'reload', visible: true },
      { id: 'settings', visible: true },
      { id: 'notifications', visible: true },
    ])
  })

  it('discards unknown and duplicate actions', () => {
    expect(
      normalizePreviewToolbarItems([
        { id: 'files', visible: false },
        { id: 'files', visible: true },
        { id: 'unknown', visible: false },
      ])
    ).toEqual([
      { id: 'files', visible: false },
      { id: 'broadcast', visible: true },
      { id: 'new_tab', visible: true },
      { id: 'plugins', visible: true },
      { id: 'web', visible: true },
      { id: 'reload', visible: true },
      { id: 'settings', visible: true },
      { id: 'notifications', visible: true },
    ])
  })

  it('always shows fixed actions even if a hand-edited setting tries to hide them', () => {
    expect(normalizePreviewToolbarItems([{ id: 'settings', visible: false }])).toEqual([
      { id: 'settings', visible: true },
      { id: 'broadcast', visible: true },
      { id: 'new_tab', visible: true },
      { id: 'plugins', visible: true },
      { id: 'files', visible: true },
      { id: 'web', visible: true },
      { id: 'reload', visible: true },
      { id: 'notifications', visible: true },
    ])
  })
})

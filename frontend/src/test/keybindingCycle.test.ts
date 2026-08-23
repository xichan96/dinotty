import { describe, expect, it, vi } from 'vitest'
import { settings } from '../composables/useSettings'
import { defs, useKeybindings } from '../composables/useKeybindings'
import { APP_ACTIONS, getAppAction, getTerminalSequenceAppAction } from '../utils/appActionCatalog'
import { canonicalizeSystemKeyboard } from '../utils/systemKeyboardLayout'
import { handleTerminalShortcutKeydown } from '../composables/useTerminal'

// Regression guard for the former module cycle
// useSettings -> systemKeyboardLayout -> appActionCatalog -> useKeybindings -> useSettings.
// appActionCatalog used to read `defs` at module-eval time, so entering the graph through
// useKeybindings/terminalInput left the binding in TDZ and crashed with
// "Cannot access 'defs' before initialization". The pure catalog now lives in
// utils/keybindingCatalog.ts (no host-module imports); this file imports every cycle
// participant WITHOUT vi.mock and asserts the catalog is fully initialized.
describe('keybinding module cycle (regression)', () => {
  it('evaluates the full graph and populates the catalog from any entry point', () => {
    expect(settings.locale).toBeDefined()
    expect(defs.length).toBeGreaterThan(0)
    expect(useKeybindings().getBinding('newTab')).toEqual({ key: 't', shift: false })

    expect(APP_ACTIONS.map((a) => a.id)).toContain('togglePalette')
    expect(APP_ACTIONS.map((a) => a.id)).toContain('term.newline')
    expect(getAppAction('togglePalette')?.labelKey).toBe('keybinding.togglePalette')
    expect(getTerminalSequenceAppAction('term.lineStart')?.sequence).toBe('\x01')

    expect(
      canonicalizeSystemKeyboard({ upper: [], pages: [[]], lower_enabled: true }).pages
    ).toHaveLength(1)

    const sendData = vi.fn()
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      metaKey: true,
      cancelable: true,
    })
    expect(handleTerminalShortcutKeydown(event, sendData)).toBe(true)
    expect(sendData).toHaveBeenCalledWith('\x01')
  })
})

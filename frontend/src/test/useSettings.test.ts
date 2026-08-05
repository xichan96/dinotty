import { describe, it, expect } from 'vitest'
import { settings, type SettingsData } from '../composables/useSettings'

describe('useSettings - confirm_before_close_tab mirror', () => {
  it('exposes mobile_input_mode as a global setting with no initial choice', () => {
    expect(settings.mobile_input_mode).toBeNull()
  })

  it('exposes confirm_before_close_tab field on SettingsData', () => {
    // Type-level assertion: this line will fail TS compile if the field
    // is missing from the SettingsData interface.
    const _field: keyof SettingsData = 'confirm_before_close_tab'
    expect(_field).toBe('confirm_before_close_tab')
  })

  it('defaults confirm_before_close_tab to true', () => {
    // The reactive settings object should have confirm_before_close_tab
    // set to true out of the box, matching the backend serde default.
    expect(settings.confirm_before_close_tab).toBe(true)
  })

  it('defaults space_confirms_dialogs to false', () => {
    // The reactive settings object should have space_confirms_dialogs
    // set to false out of the box, matching the backend serde default.
    expect(settings.space_confirms_dialogs).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import KeyboardTab from '../components/settings/KeyboardTab.vue'
import { DEFAULT_ACTION_BOTTOM, imeKeyboardOverlapPx, settings } from '../composables/useSettings'

let wrapper: VueWrapper | null = null

beforeEach(() => {
  settings.locale = 'en'
  settings.action_keyboard = {
    rows: [[{ label: 'ak-key', kind: 'send', send: 'x', auto_enter: true }]],
    bottom: DEFAULT_ACTION_BOTTOM,
  }
  settings.toolbar_quick_keys = [{ label: 'tb-key', send: 't' }]
  settings.quick_send_threshold = 63
  settings.keyboard_sound = false
  settings.keyboard_guard_mode = 'off'
  imeKeyboardOverlapPx.value = 0
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('KeyboardTab action keyboard editor', () => {
  it('renders the action keyboard WYSIWYG editor with its bottom cluster and toolbar quick keys', () => {
    wrapper = mount(KeyboardTab)

    expect(wrapper.find('.ak-wysiwyg').exists()).toBe(true)
    expect(wrapper.find('[data-ak-zone="main"]').exists()).toBe(true)
    expect(wrapper.find('[data-ak-zone="bottom"]').exists()).toBe(true)
    expect(wrapper.find('.ak-wyg-enter').exists()).toBe(true)
    expect(wrapper.text()).toContain('ak-key')
    expect(wrapper.text()).toContain('tb-key')
  })

  it('exposes the mobile behavior settings bound to host settings fields', () => {
    wrapper = mount(KeyboardTab)

    const threshold = wrapper.get('[data-setting="quick-send-threshold"]')
    expect((threshold.element as HTMLInputElement).value).toBe('63')
    expect(wrapper.find('[data-setting="keyboard-guard-mode"]').exists()).toBe(true)
    const overlap = wrapper.get('[data-setting="ime-keyboard-overlap-px"]')
    expect((overlap.element as HTMLInputElement).value).toBe('0')
    expect(wrapper.find('.settings-row .toggle input').exists()).toBe(true)
  })

  it('writes an edited key back into the action keyboard settings', async () => {
    wrapper = mount(KeyboardTab)

    await wrapper.get('.ak-wyg-label').trigger('click')
    await wrapper.get('.ak-modal input.shortcut-input').setValue('renamed')
    await wrapper.get('.ak-modal .settings-save').trigger('click')

    expect(settings.action_keyboard?.rows[0][0]).toMatchObject({
      label: 'renamed',
      send: 'x',
      auto_enter: true,
    })
  })

  it('normalizes the quick send threshold on change', async () => {
    wrapper = mount(KeyboardTab)

    await wrapper.get('[data-setting="quick-send-threshold"]').setValue('99999')
    await wrapper.get('[data-setting="quick-send-threshold"]').trigger('change')
    expect(settings.quick_send_threshold).toBe(5000)
  })

  it('uses the reactive Agent icon opt-out for send keys without changing command data', async () => {
    settings.action_keyboard = {
      rows: [[{ label: 'launcher', kind: 'send', send: 'codex --profile work', auto_enter: true }]],
    }
    wrapper = mount(KeyboardTab)

    await wrapper.get('.ak-wyg-label').trigger('click')
    const label = wrapper.get('.ak-modal input.shortcut-input')
    const checkbox = wrapper.get('.ak-agent-icon-check input')
    expect(checkbox.attributes('disabled')).toBeDefined()

    await label.setValue('Claude')
    expect(checkbox.attributes('disabled')).toBeUndefined()
    expect((checkbox.element as HTMLInputElement).checked).toBe(true)
    await checkbox.setValue(false)
    await wrapper.get('.ak-modal .settings-save').trigger('click')

    expect(settings.action_keyboard.rows[0][0]).toMatchObject({
      label: 'Claude',
      send: 'codex --profile work',
      auto_enter: true,
      display: 'text',
    })
  })

  it('uses the same special-key editor for Dinotty keys', async () => {
    settings.action_keyboard = { rows: [[{ label: 'old', kind: 'send', send: 'x' }]] }
    wrapper = mount(KeyboardTab)

    await wrapper.get('.ak-wyg-label').trigger('click')
    await wrapper.get('[data-special-field="kind"]').setValue('special')
    await wrapper.get('[data-special-field="key"]').setValue('cmd')
    expect(wrapper.find('[data-special-field="behavior"]').exists()).toBe(false)
    expect((wrapper.get('[data-special-field="hold"]').element as HTMLInputElement).checked).toBe(
      false
    )
    await wrapper.get('[data-special-field="display"]').setValue('text')
    await wrapper.get('.ak-modal .settings-save').trigger('click')

    expect(settings.action_keyboard.rows[0][0]).toMatchObject({
      kind: 'send',
      special: 'cmd',
      display: 'text',
    })
  })

  it('offers pasteTerminal in the action-key selector with its own default-on auto_enter', async () => {
    settings.action_keyboard = { rows: [[{ label: 'new', send: '', auto_enter: true }]] }
    wrapper = mount(KeyboardTab)

    await wrapper.get('.ak-wyg-label').trigger('click')
    const kindSelect = wrapper
      .findAll('.ak-modal select')
      .find((select) => select.find('option[value="action"]').exists())!
    await kindSelect.setValue('action')

    const actionSelect = wrapper
      .findAll('.ak-modal select')
      .find((select) => select.find('option[value="pasteTerminal"]').exists())!
    expect(actionSelect.find('option[value="pasteTerminal"]').text()).toBe('Paste')

    await actionSelect.setValue('pasteTerminal')
    const autoEnter = wrapper.get<HTMLInputElement>(
      '.ak-modal .ak-auto-enter-check input[type="checkbox"]'
    )
    expect(autoEnter.element.checked).toBe(true)
    await autoEnter.setValue(false)
    await wrapper.get('.ak-modal .settings-save').trigger('click')

    expect(settings.action_keyboard.rows[0][0]).toMatchObject({
      kind: 'action',
      action: 'pasteTerminal',
      auto_enter: false,
    })
  })

  it.each([
    ['term.newline', 'Newline (do not send)'],
    ['term.lineStart', 'Jump to Line Start'],
    ['term.lineEnd', 'Jump to Line End'],
    ['term.deleteToLineStart', 'Delete path or to Line Start'],
  ])('offers %s in the action-key selector without auto_enter', async (id, label) => {
    settings.action_keyboard = { rows: [[{ label: 'new', send: '', auto_enter: true }]] }
    wrapper = mount(KeyboardTab)

    await wrapper.get('.ak-wyg-label').trigger('click')
    const kindSelect = wrapper
      .findAll('.ak-modal select')
      .find((select) => select.find('option[value="action"]').exists())!
    await kindSelect.setValue('action')

    const actionSelect = wrapper
      .findAll('.ak-modal select')
      .find((select) => select.find(`option[value="${id}"]`).exists())!
    expect(actionSelect.find(`option[value="${id}"]`).text()).toBe(label)

    await actionSelect.setValue(id)
    expect(wrapper.find('.ak-modal .ak-auto-enter-check').exists()).toBe(false)
    const repeat = wrapper.get<HTMLInputElement>('.ak-modal .ak-repeat-check input')
    expect(repeat.element.checked).toBe(false)
    await repeat.setValue(true)

    await wrapper.get('.ak-modal .settings-save').trigger('click')
    expect(settings.action_keyboard.rows[0][0]).toMatchObject({
      kind: 'action',
      action: id,
      repeat: true,
    })
    expect(settings.action_keyboard.rows[0][0]).not.toHaveProperty('auto_enter')
  })
})

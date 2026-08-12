import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import KeyboardTab from '../components/settings/KeyboardTab.vue'
import { settings } from '../composables/useSettings'

let wrapper: VueWrapper | null = null

describe('KeyboardTab system IME editor', () => {
  beforeEach(() => {
    settings.locale = 'en'
    settings.mobile_input_mode = 'builtin'
    settings.toolbar_quick_keys = [{ label: 'builtin-only', send: 'b' }]
    settings.action_keyboard = null
    settings.system_keyboard_user_default = null
    settings.system_keyboard = {
      upper: [
        { label: 'upper-a', send: 'a' },
        { label: 'upper-b', send: 'b', grow: 2 },
      ],
      pages: [[{ label: 'p1', send: '1' }], [{ label: 'p2', send: '2' }]],
      lower_enabled: true,
      upper_pinned: 0,
      lower_pinned: 0,
    }
    settings.system_toolbar_mode = 'follow_ime'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('shows the explicit system target independently of the active input mode', () => {
    wrapper = mount(KeyboardTab)

    expect(wrapper.findAll('[data-system-region="upper"][data-system-index]')).toHaveLength(2)
    expect(wrapper.findAll('.system-editor-upper-page')).toHaveLength(1)
    expect(wrapper.findAll('.system-editor-lower-page')).toHaveLength(1)
    expect(wrapper.findAll('[data-system-region="lower"][data-system-index]')).toHaveLength(2)
    expect(wrapper.get('.system-editor-ime-pin').find('svg').exists()).toBe(true)
    expect(wrapper.get('.system-editor-ime-pin').text()).toBe('')
    expect(wrapper.text()).toContain('builtin-only')
    expect(wrapper.text()).toContain('upper-a')
    expect(
      wrapper.findAll('.system-editor-pin-control > span').map((label) => label.text())
    ).toEqual(['Pinned on left', 'Pinned on left'])
  })

  it('keeps the page editor concise and uses explicit add-shortcut actions', () => {
    settings.locale = 'zh'
    wrapper = mount(KeyboardTab)

    expect(wrapper.text()).toContain('上快捷栏 · 1 / 5')
    expect(wrapper.text()).toContain('左侧快捷键置顶数量')
    expect(wrapper.text()).toContain('下快捷栏 · 1 / 5')
    expect(wrapper.findAll('.system-editor-page-head')).toHaveLength(0)
    expect(wrapper.findAll('[data-system-add]').map((button) => button.text())).toEqual([
      '添加快捷键',
      '添加快捷键',
    ])

    const source = readFileSync(
      join(process.cwd(), 'src/components/settings/KeyboardTab.vue'),
      'utf8'
    )
    expect(source).toMatch(/\.system-editor-page\s*\{[^}]*overflow:\s*hidden;/s)
    expect(source).toMatch(/\.system-editor-head\s*\{[^}]*margin-bottom:\s*6px;/s)
    expect(source).toMatch(
      /\.system-editor-pages\s*\{[^}]*gap:\s*0;[^}]*border:\s*1px solid var\(--border\);[^}]*overflow:\s*hidden;/s
    )
    expect(source).toMatch(
      /\.system-editor-page\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*padding:\s*5px 7px;/s
    )
    expect(source).toMatch(/\.system-editor-grid\s*\{[^}]*min-height:\s*44px;/s)
    expect(source).toMatch(
      /\.system-editor-page \+ \.system-editor-page\s*\{[^}]*border-top:\s*1px solid var\(--border\);/s
    )
    expect(source).toMatch(
      /\.system-editor-add:active\s*\{[^}]*transform:\s*translateY\(1px\) scale\(0\.97\);[^}]*box-shadow:\s*inset/s
    )
    expect(source).toMatch(/\.system-editor-add:focus-visible\s*\{[^}]*outline:/s)
    expect(source).toMatch(
      /@media \(max-width: 600px\)[\s\S]*\.system-editor-head > \.toggle\s*\{[^}]*justify-self:\s*end;/
    )
  })

  it('uses the whole key body as the edit target and marks the fixed IME key by color', async () => {
    wrapper = mount(KeyboardTab)

    const editTarget = wrapper.get(
      '[data-system-region="upper"][data-system-index="0"] .system-editor-edit-hit'
    )
    expect(editTarget.element.tagName).toBe('BUTTON')
    await editTarget.trigger('click')
    expect(wrapper.find('.ak-modal').exists()).toBe(true)

    const source = readFileSync(
      join(process.cwd(), 'src/components/settings/KeyboardTab.vue'),
      'utf8'
    )
    expect(source).toMatch(
      /\.system-editor-pinned \.ak-wyg-key,\s*\.system-editor-pinned-copy \.ak-wyg-key,\s*\.system-editor-ime-pin\s*\{[^}]*border-color:[^}]*background:/s
    )
  })

  it('reserves a usable edit body for one-unit keys without removing their handles', () => {
    settings.system_keyboard = {
      upper: [],
      pages: [
        [
          { label: 'fixed-one', send: '1', grow: 1 },
          { label: 'a', send: '2' },
        ],
      ],
      lower_enabled: true,
      upper_pinned: 0,
    }
    wrapper = mount(KeyboardTab)

    const fixed = wrapper.get('[data-system-region="lower"][data-system-index="0"]')
    const auto = wrapper.get('[data-system-region="lower"][data-system-index="1"]')
    expect(fixed.classes()).toContain('system-editor-compact')
    expect(fixed.classes()).toContain('system-editor-resizable')
    expect(fixed.find('.ak-key-grip').exists()).toBe(true)
    expect(fixed.find('.ak-key-resize').exists()).toBe(true)
    expect(auto.classes()).toContain('system-editor-compact')
    expect(auto.classes()).not.toContain('system-editor-resizable')

    const source = readFileSync(
      join(process.cwd(), 'src/components/settings/KeyboardTab.vue'),
      'utf8'
    )
    expect(source).toMatch(/\.system-editor-compact \.ak-wyg-key\s*\{[^}]*padding-left:\s*14px;/s)
    expect(source).toMatch(
      /\.system-editor-compact\.system-editor-resizable \.ak-wyg-key\s*\{[^}]*padding-right:\s*8px;/s
    )
  })

  it('renders runtime-sized page cards with inert pinned copies and visible pin semantics', () => {
    settings.system_keyboard = {
      upper: [
        { label: 'pin-a', send: 'a', grow: 2 },
        { label: 'pin-b', send: 'b', grow: 2 },
        { label: 'upper-1', send: '1', grow: 5 },
        { label: 'upper-2', send: '2', grow: 5 },
        { label: 'upper-3', send: '3', grow: 5 },
      ],
      pages: [
        [
          { label: 'lower-pin', send: 'p', grow: 2 },
          { label: 'lower-1', send: '1', grow: 8 },
          { label: 'lower-2', send: '2', grow: 8 },
        ],
      ],
      lower_enabled: true,
      upper_pinned: 2,
      lower_pinned: 1,
    }
    wrapper = mount(KeyboardTab)

    const upperPages = wrapper.findAll('.system-editor-upper-page')
    expect(upperPages).toHaveLength(3)
    expect(upperPages.map((page) => page.attributes('data-system-page-end'))).toEqual([
      '3',
      '4',
      '5',
    ])
    expect(wrapper.findAll('.system-editor-lower-page')).toHaveLength(2)
    expect(wrapper.findAll('.system-editor-pinned-copy')).toHaveLength(5)
    expect(wrapper.findAll('.system-editor-pinned-copy[data-system-index]')).toHaveLength(0)
    expect(wrapper.findAll('.system-editor-pinned .system-editor-pin-mark')).toHaveLength(3)
    expect(wrapper.findAll('.system-editor-ime-pin svg')).toHaveLength(3)
    expect(
      wrapper.get('[data-system-region="upper"][data-system-index="2"]').attributes('style')
    ).toContain('grid-column: span 5')
  })

  it('keeps the fixed IME preview in the rightmost grid column', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/settings/KeyboardTab.vue'),
      'utf8'
    )

    expect(source).toMatch(/\.system-editor-ime-pin\s*\{[^}]*grid-column:\s*10;/s)
  })

  it('retains lower data while disabled, pins a left prefix, resets layout, and saves policy separately', async () => {
    wrapper = mount(KeyboardTab)

    await wrapper.get('[data-setting="system-lower-enabled"]').setValue(false)
    expect(settings.system_keyboard?.lower_enabled).toBe(false)
    expect(settings.system_keyboard?.pages[0].map((key) => key.label)).toEqual(['p1', 'p2'])

    const pinnedControls = wrapper.findAll('.system-editor-pin-control select')
    expect(pinnedControls).toHaveLength(2)
    await pinnedControls[0].setValue('2')
    expect(settings.system_keyboard?.upper_pinned).toBe(2)
    await pinnedControls[1].setValue('1')
    expect(settings.system_keyboard?.lower_pinned).toBe(1)

    await wrapper.get('[data-setting="system-toolbar-persistent"]').setValue(true)
    expect(settings.system_toolbar_mode).toBe('persistent_mobile')

    await wrapper.get('[data-system-action="reset"]').trigger('click')
    expect(settings.system_keyboard).toBeNull()
    expect(settings.system_toolbar_mode).toBe('persistent_mobile')
  })

  it('enables the Agent icon checkbox immediately from the live send-key label', async () => {
    wrapper = mount(KeyboardTab)

    await wrapper
      .get('[data-system-region="upper"][data-system-index="0"] .ak-wyg-label')
      .trigger('click')
    const label = wrapper.get('.ak-modal input.shortcut-input')
    const checkbox = wrapper.get('.system-agent-icon-check input')
    expect(checkbox.attributes('disabled')).toBeDefined()

    await label.setValue(' CoDeX ')
    expect(checkbox.attributes('disabled')).toBeUndefined()
    expect((checkbox.element as HTMLInputElement).checked).toBe(true)

    await label.setValue('codex --profile work')
    expect(checkbox.attributes('disabled')).toBeDefined()
  })

  it('uses the same reactive Agent icon opt-out for Dinotty send keys without changing command data', async () => {
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

  it('keeps the disabled Agent icon hint readable in both key editors', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/settings/KeyboardTab.vue'),
      'utf8'
    )

    expect(source).toMatch(
      /\.ak-agent-icon-hint,\s*\.system-agent-icon-hint\s*\{[^}]*margin-top:\s*6px;[^}]*line-height:\s*1\.45;/s
    )
  })

  it('rejects an add that would create a sixth lower page without truncating existing keys', async () => {
    settings.system_keyboard = {
      upper: [],
      pages: [
        [
          ...Array.from({ length: 5 }, (_, index) => ({
            label: `full-${index}`,
            send: String(index),
            grow: 10,
          })),
        ],
      ],
      lower_enabled: true,
      upper_pinned: 0,
    }
    wrapper = mount(KeyboardTab)

    const lowerHeader = wrapper.findAll('.system-editor-head')[1]
    await lowerHeader.get('button.shortcut-add').trigger('click')
    await wrapper.get('.ak-modal input.shortcut-input').setValue('page-six')
    await wrapper.get('.ak-modal .settings-save').trigger('click')

    expect(settings.system_keyboard.pages[0]).toHaveLength(5)
    expect(wrapper.text()).toContain('create page 6')
    expect(wrapper.find('.ak-modal').exists()).toBe(true)
  })

  it('rejects direct edits that further reduce lower capacity in an invalid layout', async () => {
    settings.system_keyboard = {
      upper: Array.from({ length: 6 }, (_, index) => ({
        label: `upper-${index}`,
        send: String(index),
        grow: 9,
      })),
      pages: [
        [
          { label: 'pin', send: 'p', grow: 5 },
          { label: 'pageable', send: 'x' },
        ],
      ],
      lower_enabled: true,
      upper_pinned: 0,
      lower_pinned: 1,
    }
    wrapper = mount(KeyboardTab)

    await wrapper.findAll('.system-editor-pin-control select')[1].setValue('2')

    expect(settings.system_keyboard.lower_pinned).toBe(1)
    expect(wrapper.text()).toContain('create page 6')
  })

  it('edits a system modifier as a locked icon key and records system send combinations', async () => {
    wrapper = mount(KeyboardTab)

    await wrapper
      .get('[data-system-region="upper"][data-system-index="0"] .ak-wyg-label')
      .trigger('click')
    await wrapper.get('[data-special-field="kind"]').setValue('special')
    await wrapper.get('[data-special-field="key"]').setValue('ctrl')
    expect(wrapper.find('[data-special-field="behavior"]').exists()).toBe(false)
    await wrapper.get('[data-special-field="hold"]').setValue(true)
    await wrapper.get('[data-special-field="display"]').setValue('icon')
    await wrapper.get('.ak-modal .settings-save').trigger('click')

    expect(settings.system_keyboard?.upper[0]).toMatchObject({
      kind: 'send',
      special: 'ctrl:lock',
      display: 'icon',
    })

    await wrapper
      .get('[data-system-region="upper"][data-system-index="1"] .ak-wyg-label')
      .trigger('click')
    await wrapper.get('[data-system-record]').trigger('click')
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, bubbles: true })
    )
    await wrapper.vm.$nextTick()
    expect((wrapper.get('.system-send-textarea').element as HTMLTextAreaElement).value).toBe('^C')
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

  it('uses an Auto-width checkbox and only exposes drag resize for fixed-width keys', async () => {
    wrapper = mount(KeyboardTab)

    await wrapper
      .get('[data-system-region="upper"][data-system-index="0"] .ak-wyg-label')
      .trigger('click')
    const autoWidth = wrapper.get('[data-system-auto-width]')
    expect((autoWidth.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('[data-system-width]').exists()).toBe(false)
    await autoWidth.setValue(false)
    await wrapper.get('.ak-modal .settings-save').trigger('click')

    expect(settings.system_keyboard?.upper[0].grow).toBe(2)
    expect(
      wrapper.find('[data-system-region="upper"][data-system-index="0"] .ak-key-resize').exists()
    ).toBe(true)

    await wrapper
      .get('[data-system-region="upper"][data-system-index="0"] .ak-wyg-label')
      .trigger('click')
    await wrapper.get('[data-system-auto-width]').setValue(true)
    await wrapper.get('.ak-modal .settings-save').trigger('click')

    expect(settings.system_keyboard?.upper[0].grow).toBeUndefined()
    expect(
      wrapper.find('[data-system-region="upper"][data-system-index="0"] .ak-key-resize').exists()
    ).toBe(false)
  })

  it('saves and restores a synchronized system-toolbar default independently of factory reset', async () => {
    wrapper = mount(KeyboardTab)

    await wrapper.get('[data-system-action="save-default"]').trigger('click')
    expect(settings.system_keyboard_user_default?.upper).toEqual(settings.system_keyboard?.upper)
    expect(settings.system_keyboard_user_default?.pages.flat().map((key) => key.label)).toEqual([
      'p1',
      'p2',
    ])
    expect(settings.system_keyboard_user_default).toMatchObject({
      lower_enabled: true,
      upper_pinned: 0,
      lower_pinned: 0,
    })

    settings.system_keyboard!.upper[0].label = 'changed-after-snapshot'
    await wrapper.get('[data-system-action="restore-default"]').trigger('click')
    expect(settings.system_keyboard?.upper[0].label).toBe('upper-a')

    await wrapper.get('[data-system-action="reset"]').trigger('click')
    expect(settings.system_keyboard).toBeNull()
    expect(settings.system_keyboard_user_default?.upper[0].label).toBe('upper-a')
  })
})

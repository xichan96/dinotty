import { describe, it, expect, beforeEach } from 'vitest'
import { useI18n } from '../composables/useI18n'
import { settings } from '../composables/useSettings'

// Behavioral tests for the new confirm-before-close-tab i18n strings.
// These keys are added by Task 3 in openspec change `confirm-before-close-tab`.
// Spec: openspec/changes/confirm-before-close-tab/specs/tab-close-confirmation/spec.md

// Required keys: 3 settings.* keys (General tab toggle row) + 4 confirm.* keys (modal)
// Renamed from EN_KEYS to TASK3_KEYS (M1: name was misleading — used in both locales)
const TASK3_KEYS = [
  'settings.confirmBeforeCloseTab',
  'settings.confirmBeforeCloseTabHint',
  'settings.behavior',
  'confirm.closeTabTitle',
  'confirm.closeTabMessage',
  'confirm.closeTabConfirm',
  'confirm.closeTabCancel',
] as const

const QKB1_KEYS = [
  'keybinding.term.newline',
  'keybinding.term.lineStart',
  'keybinding.term.lineEnd',
  'keybinding.term.deleteToLineStart',
  'mobileKb.pasteTerminal',
  'mobileKb.findTerminal',
  'mobileKb.clipboardEmpty',
  'mobileKb.pasteFailed',
  'mobileKb.confirmMultiline',
  'search.placeholder',
  'search.resultCount',
  'search.noResults',
  'search.previous',
  'search.next',
  'search.close',
] as const

describe('useI18n - confirm-before-close-tab strings', () => {
  describe('English locale', () => {
    beforeEach(() => {
      // Force English locale for these tests
      settings.locale = 'en'
    })

    it.each(TASK3_KEYS)('t(%s) returns a non-empty string (key exists in messages.en)', (key) => {
      const { t } = useI18n()
      const value = t(key)
      // If key is missing, t() returns the key itself. We assert it's different
      // from the key AND is a non-empty trimmed string.
      expect(value).not.toBe(key)
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  })

  describe('Chinese locale', () => {
    beforeEach(() => {
      settings.locale = 'zh'
    })

    it.each(TASK3_KEYS)('t(%s) returns a non-empty string (key exists in messages.zh)', (key) => {
      const { t } = useI18n()
      const value = t(key)
      expect(value).not.toBe(key)
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  })

  describe('parity', () => {
    it('en and zh both define the same 7 new keys (no missing translation)', () => {
      // Dynamic import to peek at the messages table via the actual `t` behavior
      // across both locales for the same key set.
      const enResults: Record<string, string> = {}
      const zhResults: Record<string, string> = {}
      // en pass
      settings.locale = 'en'
      const enT = useI18n().t
      for (const k of TASK3_KEYS) enResults[k] = enT(k)
      // zh pass
      settings.locale = 'zh'
      const zhT = useI18n().t
      for (const k of TASK3_KEYS) zhResults[k] = zhT(k)

      for (const k of TASK3_KEYS) {
        // In both locales, t() must NOT fall back to the key itself
        expect(enResults[k], `en missing translation for ${k}`).not.toBe(k)
        expect(zhResults[k], `zh missing translation for ${k}`).not.toBe(k)
      }
    })

    it('en and zh values differ (sanity: not the same hard-coded string)', () => {
      // Each `useI18n()` instance creates a `computed` that snapshots the
      // current `settings.locale` on first access. Set locale first, then
      // grab a fresh `t` for that locale, then switch.
      settings.locale = 'en'
      const enConfirmTitle = useI18n().t('confirm.closeTabTitle')

      settings.locale = 'zh'
      const zhConfirmTitle = useI18n().t('confirm.closeTabTitle')

      // At least the values for the new keys should not be identical
      // between locales — Chinese strings should differ from English.
      expect(enConfirmTitle).not.toBe(zhConfirmTitle)
      expect(enConfirmTitle.trim().length).toBeGreaterThan(0)
      expect(zhConfirmTitle.trim().length).toBeGreaterThan(0)
    })
  })

  // I2: Positive assertions — lock down the exact value of each new key.
  // These catch silent regressions (e.g. typo, accidental edits, value drift)
  // that the non-empty assertion above cannot.
  //
  // `confirm.closeTabMessage` is intentionally a *prefix* sentence: the
  // caller (Task 5 App.vue) appends the tab title before the closing
  // punctuation, e.g. `t('confirm.closeTabMessage') + ' "' + title + '"?'`
  // and the resulting sentence must read naturally in each locale.
  describe('exact values (positive assertions)', () => {
    it.each([
      ['en', 'settings.confirmBeforeCloseTab', 'Confirm before closing terminal tab'],
      [
        'en',
        'settings.confirmBeforeCloseTabHint',
        'Show a confirmation dialog before closing a terminal tab',
      ],
      ['en', 'settings.behavior', 'Behavior'],
      ['en', 'confirm.closeTabTitle', 'Close session?'],
      [
        'en',
        'confirm.closeTabMessage',
        'Closing this session will terminate all running processes. Close',
      ],
      ['en', 'confirm.closeTabConfirm', 'Close'],
      ['en', 'confirm.closeTabCancel', 'Cancel'],
      ['zh', 'settings.confirmBeforeCloseTab', '关闭终端 tab 前显示确认'],
      ['zh', 'settings.confirmBeforeCloseTabHint', '关闭终端 tab 前弹出确认对话框'],
      ['zh', 'settings.behavior', '行为'],
      ['zh', 'confirm.closeTabTitle', '关闭会话？'],
      ['zh', 'confirm.closeTabMessage', '关闭此会话将终止所有正在运行的进程。仍要关闭'],
      ['zh', 'confirm.closeTabConfirm', '关闭'],
      ['zh', 'confirm.closeTabCancel', '取消'],
    ] as const)('t(%j) in %s locale returns the exact expected value', (locale, key, expected) => {
      settings.locale = locale
      const { t } = useI18n()
      expect(t(key)).toBe(expected)
    })
  })
})

describe('useI18n - QKB1 strings', () => {
  it.each(['en', 'zh'] as const)('defines every QKB1 key in %s', (locale) => {
    settings.locale = locale
    const { t } = useI18n()
    for (const key of QKB1_KEYS) expect(t(key), `${locale} missing ${key}`).not.toBe(key)
  })

  it('uses the audited exact mobile shortcut strings', () => {
    settings.locale = 'en'
    expect(useI18n().t('mobileKb.confirmMultiline', { n: 4 })).toBe(
      'Clipboard has 4 lines — tap again to paste'
    )
    settings.locale = 'zh'
    expect(useI18n().t('mobileKb.confirmMultiline', { n: 4 })).toBe(
      '剪贴板含 4 行，再点一次粘贴'
    )
  })
})

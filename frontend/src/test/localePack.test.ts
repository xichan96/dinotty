import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  parseLocalePack,
  isValidTag,
  sanitizeMessages,
  MAX_VALUE_LENGTH,
} from '../composables/i18n/localePack'
import { referenceKeys, setInstalledPacks, tables } from '../composables/i18n/tables'
import { settings } from '../composables/useSettings'
import { t } from '../composables/useI18n'

const VALID = JSON.stringify({
  tag: 'ja',
  name: '日本語',
  version: '1.0.0',
  messages: { 'app.settings': '設定', 'app.reload': '再読み込み' },
})

afterEach(() => {
  setInstalledPacks({})
})

describe('isValidTag', () => {
  it.each(['en', 'zh', 'ja', 'zh-Hant-TW', 'pt-BR', 'es-419'])('accepts %s', (tag) => {
    expect(isValidTag(tag)).toBe(true)
  })

  // The tag becomes a filename on the Rust side, so traversal has to be
  // unrepresentable rather than merely discouraged.
  it.each([
    ['', 'empty'],
    ['a', 'too short'],
    ['en-', 'trailing dash'],
    ['-en', 'leading dash'],
    ['en--US', 'double dash'],
    ['../etc/passwd', 'traversal'],
    ['en/US', 'path separator'],
    ['en\\US', 'backslash'],
    ['en_US', 'underscore'],
    ['../..', 'bare traversal'],
    ['x'.repeat(36), 'too long'],
  ])('rejects %s (%s)', (tag) => {
    expect(isValidTag(tag)).toBe(false)
  })
})

describe('sanitizeMessages', () => {
  it('keeps string values and reports non-strings as dropped', () => {
    const { messages, dropped } = sanitizeMessages({
      'a.b': 'ok',
      'a.c': 42,
      'a.d': null,
      'a.e': { nested: 'no' },
      'a.f': ['no'],
      'a.g': true,
    })
    expect(messages).toEqual({ 'a.b': 'ok' })
    expect(dropped).toBe(5)
  })

  it('drops values longer than the cap', () => {
    const { messages, dropped } = sanitizeMessages({ 'a.b': 'x'.repeat(MAX_VALUE_LENGTH + 1) })
    expect(messages).toEqual({})
    expect(dropped).toBe(1)
  })

  it('rejects a non-object structurally', () => {
    expect(sanitizeMessages(null).error).toBeDefined()
    expect(sanitizeMessages([]).error).toBeDefined()
    expect(sanitizeMessages('nope').error).toBeDefined()
  })

  // Dropping is per-entry and must not reject the pack: one bad value should
  // not cost the translator every other key.
  it('reports a dropped entry as a warning, not an error', () => {
    const result = sanitizeMessages({ 'a.b': 'ok', 'a.c': 42 })
    expect(result.error).toBeUndefined()
    expect(result.warnings).toEqual([])
    expect(result.messages).toEqual({ 'a.b': 'ok' })
  })

  // The table is null-prototyped so that a key which somehow escapes the
  // forbidden set still cannot reach Object.prototype.
  it('returns a null-prototype table', () => {
    const { messages } = sanitizeMessages({ 'a.b': 'ok' })
    expect(Object.getPrototypeOf(messages)).toBeNull()
  })
})

describe('prototype pollution', () => {
  // Built as a raw string on purpose: an object literal `{ __proto__: x }`
  // *assigns the prototype* rather than creating an own property, so
  // `JSON.stringify` would emit `{}` and the test would prove nothing.
  // `JSON.parse` is what creates the own `__proto__` property the attack needs.
  it('does not let a __proto__ key reach Object.prototype', () => {
    const text =
      '{"tag":"en","messages":{"__proto__":{"polluted":"yes"},"app.settings":"Preferences"}}'
    const result = parseLocalePack(text)

    expect(result.ok).toBe(true)
    // The real assertion: a fresh object cannot see the injected property.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(result.pack!.messages['app.settings']).toBe('Preferences')
    expect(Object.keys(result.pack!.messages)).not.toContain('__proto__')
  })

  // Reserved keys are dropped and reported as warnings, not errors: a pack that
  // handles them is still perfectly usable for every other key.
  it.each(['constructor', 'prototype', '__proto__'])('drops the reserved key %s', (key) => {
    const text = `{"tag":"en","messages":{"${key}":"x","app.settings":"Preferences"}}`
    const result = parseLocalePack(text)
    expect(result.ok).toBe(true)
    expect(Object.keys(result.pack!.messages)).not.toContain(key)
    expect(result.warnings.join(' ')).toContain('reserved key')
    // The pack still delivers the keys that were fine.
    expect(result.pack!.messages['app.settings']).toBe('Preferences')
  })
})

describe('parseLocalePack', () => {
  it('parses a valid pack', () => {
    const result = parseLocalePack(VALID)
    expect(result.ok).toBe(true)
    expect(result.tag).toBe('ja')
    expect(result.pack).toMatchObject({
      name: '日本語',
      version: '1.0.0',
      extends: 'en',
    })
    expect(result.pack!.messages['app.settings']).toBe('設定')
    expect(result.stats).toEqual({ translated: 2, dropped: 0 })
  })

  it('defaults name to the tag and extends to en', () => {
    const result = parseLocalePack(JSON.stringify({ tag: 'ja', messages: { 'a.b': 'x' } }))
    expect(result.pack!.name).toBe('ja')
    expect(result.pack!.extends).toBe('en')
    expect(result.pack!.version).toBeUndefined()
  })

  it('falls back to the filename stem when the manifest omits tag', () => {
    const result = parseLocalePack(JSON.stringify({ messages: { 'a.b': 'x' } }), 'ja')
    expect(result.ok).toBe(true)
    expect(result.tag).toBe('ja')
  })

  it('lets the manifest tag win over the filename', () => {
    const result = parseLocalePack(JSON.stringify({ tag: 'ko', messages: { 'a.b': 'x' } }), 'ja')
    expect(result.tag).toBe('ko')
  })

  it.each([
    ['not json at all', 'invalid JSON'],
    ['[]', 'must be a JSON object'],
    ['"a string"', 'must be a JSON object'],
    ['null', 'must be a JSON object'],
  ])('rejects %s', (text, expected) => {
    const result = parseLocalePack(text)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain(expected)
  })

  it('rejects a pack with no tag and no filename fallback', () => {
    const result = parseLocalePack(JSON.stringify({ messages: { 'a.b': 'x' } }))
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('missing "tag"')
  })

  it('rejects a traversal tag from the filename fallback', () => {
    const result = parseLocalePack(JSON.stringify({ messages: { 'a.b': 'x' } }), '../../etc/passwd')
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('invalid locale tag')
  })

  it('rejects a pack with no usable messages', () => {
    const result = parseLocalePack(JSON.stringify({ tag: 'ja', messages: {} }))
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('no usable messages')
  })

  it('rejects an invalid extends tag', () => {
    const result = parseLocalePack(
      JSON.stringify({ tag: 'ja', extends: '../evil', messages: { 'a.b': 'x' } })
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('invalid "extends"')
  })

  it('accepts a pack that extends itself', () => {
    const result = parseLocalePack(
      JSON.stringify({ tag: 'ja', extends: 'ja', messages: { 'a.b': 'x' } })
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a pack above the size cap', () => {
    const result = parseLocalePack('x'.repeat(600 * 1024))
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('larger than')
  })
})

// The seam between validation and the loader: a validated pack has to actually
// render, and it has to sit *over* its base so upgraded keys still resolve.
// The shipped example pack is the executable form of the manifest format: if
// the shape changes, this fails rather than a translator discovering it from a
// pack that silently loads nothing.
describe('the example pack shipped in the repo', () => {
  const text = readFileSync(path.resolve(__dirname, 'fixtures', 'example-locale-pack.json'), 'utf8')

  it('is a valid pack', () => {
    const result = parseLocalePack(text)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.tag).toBe('ja')
    expect(result.pack!.name).toBe('日本語')
  })

  it('is not out of date against the current app version', () => {
    // The app version lives in the workspace Cargo.toml — `frontend/package.json`
    // is `0.1.0` and never bumped, so it cannot answer this.
    const cargo = readFileSync(path.resolve(__dirname, '..', '..', '..', 'Cargo.toml'), 'utf8')
    const appVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]
    expect(appVersion).toBeDefined()

    // Keeps `minAppVersion` in the example honest instead of aspirational.
    const floor = JSON.parse(text).minAppVersion as string
    expect(appVersionAtLeast(appVersion!, floor)).toBe(true)
  })

  it('names only keys the app actually has', () => {
    const result = parseLocalePack(text)
    const known = new Set(referenceKeys())
    const unknown = Object.keys(result.pack!.messages).filter((key) => !known.has(key))
    expect(unknown).toEqual([])
  })
})

/** `actual >= floor`, segment by segment. Mirrors `isNewer` in `useLocalePacks`. */
function appVersionAtLeast(actual: string, floor: string): boolean {
  const segments = (v: string) => v.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const [a, b] = [segments(actual), segments(floor)]
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [left, right] = [a[i] ?? 0, b[i] ?? 0]
    if (left !== right) return left >= right
  }
  return true
}

describe('a validated pack renders through t()', () => {
  it('translates the keys it carries and falls back to en for the rest', () => {
    const result = parseLocalePack(VALID)
    expect(result.ok).toBe(true)
    setInstalledPacks({ ja: result.pack! })

    settings.locale = 'ja'
    expect(t('app.settings')).toBe('設定')
    // Not in the pack -> comes from the base (en), not a raw key.
    expect(t('app.reload')).toBe('再読み込み')
    expect(t('cancel')).toBe('Cancel')
    expect(t('confirm.closeTabConfirm')).toBe('Close')
  })

  it('overrides a builtin while leaving unlisted keys intact', () => {
    const patch = parseLocalePack(
      JSON.stringify({ tag: 'en', name: 'Brand', messages: { 'app.settings': 'Preferences' } })
    )
    expect(patch.ok).toBe(true)
    setInstalledPacks({ en: patch.pack! })

    settings.locale = 'en'
    expect(t('app.settings')).toBe('Preferences')
    // Keys the patch does not mention must survive — this is why a pack is a
    // patch and never a replacement.
    expect(t('cancel')).toBe('Cancel')
    expect(t('app.reload')).toBe('Reload')
  })

  it('resolves a pack by primary subtag, so zh-CN finds a zh pack', () => {
    const patch = parseLocalePack(
      JSON.stringify({ tag: 'zh', extends: 'zh', messages: { 'app.settings': '設定-ZH' } })
    )
    expect(patch.ok).toBe(true)
    setInstalledPacks({ zh: patch.pack! })

    settings.locale = 'zh-CN'
    expect(t('app.settings')).toBe('設定-ZH')
  })

  it('removes the table again when the pack is uninstalled', () => {
    const result = parseLocalePack(VALID)
    setInstalledPacks({ ja: result.pack! })
    settings.locale = 'ja'
    expect(t('app.settings')).toBe('設定')

    setInstalledPacks({})
    expect(tables.ja).toBeUndefined()
    // Falls back to the en base rather than showing a raw key.
    expect(t('app.settings')).toBe('Settings')
  })
})

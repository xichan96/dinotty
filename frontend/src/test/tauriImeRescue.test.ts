import { describe, it, expect } from 'vitest'
import {
  isDuplicateOnData,
  isShiftSymbolChar,
  stripImeConfirmSpace,
} from '../composables/useTerminal'

const IME_SYM_PAIR_MS = 400

type Source = 'input' | 'onData'
type SymCredit = { data: string; src: 0 | 1; at: number }

class SymPairMirror {
  private _symCredits: SymCredit[] = []
  private _lastInputData = ''
  private _lastInputTime = 0
  emitted: Array<{ data: string; source: Source }> = []

  input(rawData: string, now: number) {
    const data = stripImeConfirmSpace(rawData)
    if (!isShiftSymbolChar(data)) return
    if (this._resolveSym(data, 0, now)) this._emitInput(data, 'input')
  }

  onData(rawData: string, now: number, tauri = true) {
    const data = tauri ? stripImeConfirmSpace(rawData) : rawData
    if (!data) return
    if (isDuplicateOnData(data, this._lastInputData, this._lastInputTime, now)) return
    this._lastInputData = data
    this._lastInputTime = now
    if (tauri && isShiftSymbolChar(data)) {
      if (!this._resolveSym(data, 1, now)) return
    }
    this._emitInput(data, 'onData')
  }

  private _resolveSym(data: string, src: 0 | 1, now: number): boolean {
    if (this._symCredits.length)
      this._symCredits = this._symCredits.filter((c) => now - c.at < IME_SYM_PAIR_MS)
    const i = this._symCredits.findIndex((c) => c.data === data && c.src !== src)
    if (i >= 0) {
      this._symCredits.splice(i, 1)
      return false
    }
    this._symCredits.push({ data, src, at: now })
    return true
  }

  private _emitInput(data: string, source: Source) {
    this.emitted.push({ data, source })
  }
}

describe('Tauri IME shift-symbol helpers', () => {
  it.each([
    '!',
    '/',
    ':',
    '@',
    '[',
    '`',
    '{',
    '~',
    '！',
    '／',
    '：',
    '＠',
    '［',
    '｀',
    '｛',
    '～',
    '——',
    '……',
    '“',
    '”',
    '‘',
    '’',
    '《',
    '》',
    '〈',
    '〉',
    '¥',
    '￥',
    '「',
    '」',
    '『',
    '』',
    '【',
    '】',
    '〔',
    '〕',
    '·',
    '、',
    '。',
  ] as const)('accepts punctuation range member %j', (data) => {
    expect(isShiftSymbolChar(data)).toBe(true)
  })

  it.each(['a', 'Z', '0', '9', ' ', '中', 'ab', '', '\t', '　', '０', 'Ａ'] as const)(
    'rejects non shift-symbol %j',
    (data) => {
      expect(isShiftSymbolChar(data)).toBe(false)
    }
  )

  it('strips only a two-character symbol plus trailing IME confirm whitespace', () => {
    expect(stripImeConfirmSpace('! ')).toBe('!')
    expect(stripImeConfirmSpace('!　')).toBe('!')
    expect(stripImeConfirmSpace('a ')).toBe('a ')
    expect(stripImeConfirmSpace('!!')).toBe('!!')
    expect(stripImeConfirmSpace('—— ')).toBe('——')
    expect(stripImeConfirmSpace('￥ ')).toBe('￥')
    expect(stripImeConfirmSpace('——')).toBe('——')
  })
})

describe('Tauri IME opposite-source pairing mirror', () => {
  it('emits a cold input-only symbol once from input', () => {
    const mirror = new SymPairMirror()
    mirror.input('!', 100)
    expect(mirror.emitted).toEqual([{ data: '!', source: 'input' }])
  })

  it('emits input-first warm symbols once and suppresses later onData', () => {
    const mirror = new SymPairMirror()
    mirror.input('!', 100)
    mirror.onData('!', 390)
    expect(mirror.emitted).toEqual([{ data: '!', source: 'input' }])
  })

  it('emits onData-first warm fullwidth symbols once and suppresses later input', () => {
    const mirror = new SymPairMirror()
    mirror.onData('；', 100)
    mirror.input('；', 150)
    expect(mirror.emitted).toEqual([{ data: '；', source: 'onData' }])
  })

  it('emits English/web onData-only symbols once from onData', () => {
    const mirror = new SymPairMirror()
    mirror.onData('!', 100, false)
    expect(mirror.emitted).toEqual([{ data: '!', source: 'onData' }])
  })

  it('preserves rapid same-symbol presses across cold and warm interleavings', () => {
    const mirror = new SymPairMirror()

    mirror.input('!', 0)
    mirror.input('!', 100)
    mirror.onData('!', 390)
    mirror.onData('!', 700)
    mirror.input('!', 750)

    expect(mirror.emitted).toEqual([
      { data: '!', source: 'input' },
      { data: '!', source: 'input' },
      { data: '!', source: 'onData' },
    ])
  })

  it('does not suppress same-source input-only repeats', () => {
    const mirror = new SymPairMirror()
    mirror.input('!', 100)
    mirror.input('!', 150)
    expect(mirror.emitted).toEqual([
      { data: '!', source: 'input' },
      { data: '!', source: 'input' },
    ])
  })

  it('keeps the existing onData duplicate window behavior separate', () => {
    expect(isDuplicateOnData('!', '!', 1000, 1001)).toBe(true)
    expect(isDuplicateOnData('!', '!', 1000, 1010)).toBe(false)
    expect(isDuplicateOnData('@', '!', 1000, 1001)).toBe(false)
  })
})

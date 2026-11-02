import { describe, expect, it } from 'vitest'
import { findTerminalFileLinks } from '../utils/terminalFileLink'

function links(line: string) {
  return findTerminalFileLinks(line).map(({ path, line: ln, column, raw, start, end }) => ({
    path,
    line: ln,
    column,
    raw,
    start,
    end,
  }))
}

describe('findTerminalFileLinks', () => {
  it('matches absolute and explicit relative paths', () => {
    expect(links('/var/log/system.log').map((l) => l.path)).toEqual(['/var/log/system.log'])
    expect(links('see ./src/a.ts').map((l) => l.path)).toEqual(['./src/a.ts'])
    expect(links('see ../src/a.ts').map((l) => l.path)).toEqual(['../src/a.ts'])
    expect(links('see ~/notes.md').map((l) => l.path)).toEqual(['~/notes.md'])
  })

  it('matches bare relative paths with known extensions', () => {
    expect(links('at src/foo.ts').map((l) => l.path)).toEqual(['src/foo.ts'])
    expect(links('README.md').map((l) => l.path)).toEqual(['README.md'])
    expect(links('edit .env').map((l) => l.path)).toEqual(['.env'])
  })

  it('parses :line and :line:col suffixes', () => {
    expect(links('src/foo.ts:42')).toEqual([
      { path: 'src/foo.ts', line: 42, column: undefined, raw: 'src/foo.ts:42', start: 0, end: 13 },
    ])
    expect(links('src/foo.ts:42:7')).toEqual([
      {
        path: 'src/foo.ts',
        line: 42,
        column: 7,
        raw: 'src/foo.ts:42:7',
        start: 0,
        end: 15,
      },
    ])
  })

  it('matches paths wrapped in punctuation', () => {
    expect(links('Update(src/foo.ts)').map((l) => l.path)).toEqual(['src/foo.ts'])
    expect(links('`src/foo.ts:3`').map((l) => l.line)).toEqual([3])
    expect(links('"src/foo.ts"').map((l) => l.path)).toEqual(['src/foo.ts'])
    expect(links("[src/foo.ts]").map((l) => l.path)).toEqual(['src/foo.ts'])
  })

  it('handles --flag=path arguments', () => {
    expect(links('run --config=src/app.ts').map((l) => l.path)).toEqual(['src/app.ts'])
  })

  it('handles CJK punctuation around paths', () => {
    expect(links('见（src/foo.ts）').map((l) => l.path)).toEqual(['src/foo.ts'])
    expect(links('打开「src/foo.ts」。').map((l) => l.path)).toEqual(['src/foo.ts'])
  })

  it('does not link a bare path separator', () => {
    expect(links('cd /')).toEqual([])
    expect(links('cd ./')).toEqual([])
  })

  it('strips sentence punctuation', () => {
    expect(links('look at src/foo.ts.').map((l) => l.path)).toEqual(['src/foo.ts'])
    expect(links('run ./scripts/build.sh:').map((l) => l.path)).toEqual(['./scripts/build.sh'])
  })

  it('finds multiple paths on one line', () => {
    const found = links('compare src/a.ts:2:3 with ./src/b.ts')
    expect(found.map((l) => l.path)).toEqual(['src/a.ts', './src/b.ts'])
    expect(found[0].line).toBe(2)
    expect(found[0].column).toBe(3)
  })

  it('rejects URLs so the URL link provider keeps them', () => {
    expect(links('https://example.com/src/a.ts')).toEqual([])
    expect(links('file:///tmp/a.ts')).toEqual([])
  })

  it('rejects prose, version strings, and flags', () => {
    expect(links('use and/or carefully')).toEqual([])
    expect(links('locale en/zh')).toEqual([])
    expect(links('version 1.2.3')).toEqual([])
    expect(links('--verbose')).toEqual([])
  })

  it('does not treat zero positions as line suffixes', () => {
    expect(links('src/foo.ts:0')).toEqual([])
    expect(links('src/foo.ts:0:3')).toEqual([])
  })

  it('returns offsets that span the underlined raw text', () => {
    const line = 'error at src/foo.ts:42:7: bad'
    const [found] = links(line)
    expect(line.slice(found.start, found.end)).toBe('src/foo.ts:42:7')
  })
})

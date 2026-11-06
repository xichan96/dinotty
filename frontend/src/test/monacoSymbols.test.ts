import { describe, expect, it } from 'vitest'
import {
  collectTypeScriptSymbols,
  navigationTreeToOutline,
  type MonacoSymbolModel,
  type MonacoSymbolsApi,
  type NavigationTree,
  type TypeScriptLanguageApi,
} from '../utils/monacoSymbols'

function makeModel(source: string, language = 'typescript'): MonacoSymbolModel {
  return {
    getPositionAt(offset: number) {
      const safe = Math.max(0, Math.min(offset, source.length))
      return { lineNumber: source.slice(0, safe).split('\n').length }
    },
    getLanguageId: () => language,
    getVersionId: () => 1,
    uri: { toString: () => 'file:///project/src/test.ts' },
  }
}

const SOURCE = [
  'class Foo {',
  '  bar() {',
  '    x = 1',
  '  }',
  '}',
  'interface Baz {}',
].join('\n')

const at = (needle: string): number => SOURCE.indexOf(needle)

describe('navigationTreeToOutline', () => {
  it('maps nesting, kinds, line numbers and unwraps the script root', () => {
    const tree: NavigationTree = {
      text: 'test.ts',
      kind: 'script',
      spans: [{ start: 0 }],
      childItems: [
        {
          text: 'Foo',
          kind: 'class',
          spans: [{ start: at('Foo') }],
          childItems: [
            {
              text: 'bar',
              kind: 'method',
              spans: [{ start: at('bar') }],
              childItems: [
                { text: 'x', kind: 'property', spans: [{ start: at('x = 1') }] },
              ],
            },
          ],
        },
        { text: 'Baz', kind: 'interface', spans: [{ start: at('Baz') }] },
      ],
    }

    expect(navigationTreeToOutline(tree, makeModel(SOURCE), { language: 'typescript' })).toEqual([
      {
        id: 'typescript:Foo:1',
        label: 'Foo',
        kind: 'class',
        line: 1,
        children: [
          {
            id: 'typescript:bar:2',
            label: 'bar',
            kind: 'method',
            line: 2,
            children: [{ id: 'typescript:x:3', label: 'x', kind: 'property', line: 3 }],
          },
        ],
      },
      { id: 'typescript:Baz:6', label: 'Baz', kind: 'interface', line: 6 },
    ])
  })

  it('drops empty and <unknown> labels and maps unknown kinds to property', () => {
    const tree: NavigationTree = {
      kind: 'module',
      childItems: [
        { text: '', kind: 'function' },
        { text: '   ', kind: 'function' },
        { text: '<unknown>', kind: 'function' },
        { text: 'value', kind: 'getter' },
        { text: 'MAX', kind: 'const' },
        { text: 'Shape', kind: 'type' },
      ],
    }

    expect(navigationTreeToOutline(tree, makeModel(''), { language: 'javascript' })).toEqual([
      { id: 'javascript:value:1', label: 'value', kind: 'property', line: 1 },
      { id: 'javascript:MAX:1', label: 'MAX', kind: 'const', line: 1 },
      { id: 'javascript:Shape:1', label: 'Shape', kind: 'type', line: 1 },
    ])
  })

  it('maps a non-synthetic root as a regular item', () => {
    const tree: NavigationTree = { text: 'run', kind: 'function', spans: [{ start: at('bar') }] }
    expect(navigationTreeToOutline(tree, makeModel(SOURCE))).toEqual([
      { id: 'typescript:run:2', label: 'run', kind: 'function', line: 2 },
    ])
  })

  it('dedupes repeated ids stably', () => {
    const tree: NavigationTree = {
      kind: 'script',
      childItems: [
        { text: 'foo', kind: 'function', spans: [{ start: at('bar') }] },
        { text: 'foo', kind: 'function', spans: [{ start: at('bar') }] },
      ],
    }

    expect(navigationTreeToOutline(tree, makeModel(SOURCE)).map((item) => item.id)).toEqual([
      'typescript:foo:2',
      'typescript:foo:2#2',
    ])
  })

  it('caps depth and total item count', () => {
    let deepest: NavigationTree = { text: 'leaf', kind: 'property' }
    for (let i = 0; i < 6; i++) {
      deepest = { text: `level${i}`, kind: 'object', childItems: [deepest] }
    }
    const nested = navigationTreeToOutline(deepest, makeModel(''), { maxDepth: 3 })
    expect(nested).toHaveLength(1)
    expect(nested[0].label).toBe('level5')
    expect(nested[0].children?.[0].label).toBe('level4')
    expect(nested[0].children?.[0].children?.[0].label).toBe('level3')
    expect(nested[0].children?.[0].children?.[0].children).toBeUndefined()

    const wide: NavigationTree = {
      kind: 'script',
      childItems: Array.from({ length: 10 }, (_, i) => ({ text: `item${i}`, kind: 'const' })),
    }
    expect(navigationTreeToOutline(wide, makeModel(''), { maxItems: 3 })).toHaveLength(3)
  })

  it('returns no items for a missing tree', () => {
    expect(navigationTreeToOutline(undefined, makeModel(''))).toEqual([])
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const TREE: NavigationTree = {
  kind: 'script',
  childItems: [{ text: 'Foo', kind: 'class', spans: [{ start: 0 }] }],
}

function apiWith(getters: TypeScriptLanguageApi): MonacoSymbolsApi {
  return { languages: { typescript: getters } }
}

describe('collectTypeScriptSymbols', () => {
  it('returns mapped symbols on success', async () => {
    const api = apiWith({
      getTypeScriptWorker: async () => async () => ({
        getNavigationTree: async () => TREE,
      }),
    })

    await expect(
      collectTypeScriptSymbols(api, makeModel(''), { language: 'typescript' })
    ).resolves.toEqual([{ id: 'typescript:Foo:1', label: 'Foo', kind: 'class', line: 1 }])
  })

  it('uses the JavaScript worker for JavaScript models', async () => {
    let tsCalled = false
    const api = apiWith({
      getTypeScriptWorker: async () => {
        tsCalled = true
        return async () => ({ getNavigationTree: async () => TREE })
      },
      getJavaScriptWorker: async () => async () => ({
        getNavigationTree: async () => ({ ...TREE, childItems: [{ text: 'js', kind: 'const' }] }),
      }),
    })

    const items = await collectTypeScriptSymbols(api, makeModel('', 'javascript'), {
      language: 'javascript',
    })
    expect(tsCalled).toBe(false)
    expect(items).toEqual([{ id: 'javascript:js:1', label: 'js', kind: 'const', line: 1 }])
  })

  it('returns null when the worker hangs past the timeout', async () => {
    const never = new Promise<never>(() => {})
    const api = apiWith({ getTypeScriptWorker: () => never })

    await expect(
      collectTypeScriptSymbols(api, makeModel(''), { language: 'typescript', timeoutMs: 10 })
    ).resolves.toBeNull()
  })

  it('returns null on worker errors and missing APIs', async () => {
    const throwing = apiWith({
      getTypeScriptWorker: async () => {
        throw new Error('worker failed')
      },
    })
    await expect(
      collectTypeScriptSymbols(throwing, makeModel(''), { language: 'typescript' })
    ).resolves.toBeNull()

    await expect(collectTypeScriptSymbols(null, makeModel(''))).resolves.toBeNull()
    await expect(collectTypeScriptSymbols({}, makeModel(''))).resolves.toBeNull()
    await expect(collectTypeScriptSymbols(apiWith({}), makeModel(''))).resolves.toBeNull()
  })

  it('returns null when the worker yields no navigation tree', async () => {
    const api = apiWith({
      getTypeScriptWorker: async () => async () => ({ getNavigationTree: async () => undefined }),
    })
    await expect(
      collectTypeScriptSymbols(api, makeModel(''), { language: 'typescript' })
    ).resolves.toBeNull()
  })

  it('resolves late results instead of leaking the race', async () => {
    const gate = deferred<NavigationTree>()
    const api = apiWith({
      getTypeScriptWorker: async () => async () => ({ getNavigationTree: () => gate.promise }),
    })

    await expect(
      collectTypeScriptSymbols(api, makeModel(''), { language: 'typescript', timeoutMs: 5 })
    ).resolves.toBeNull()
    // A result arriving after the timeout must not produce an unhandled rejection.
    gate.resolve(TREE)
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
})

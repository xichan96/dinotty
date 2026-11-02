import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { useMonacoOutlineSymbols } from '../composables/useMonacoOutlineSymbols'
import { registerEditor, unregisterEditor } from '../composables/useEditorRegistry'
import type {
  MonacoSymbolModel,
  MonacoSymbolsApi,
  NavigationTree,
} from '../utils/monacoSymbols'

const LEAF = 'leaf-monaco-symbols-test'

const TREE: NavigationTree = {
  kind: 'script',
  childItems: [{ text: 'Foo', kind: 'class', spans: [{ start: 0 }] }],
}

function makeModel() {
  let version = 1
  const model: MonacoSymbolModel = {
    uri: { toString: () => 'file:///a.ts' },
    getPositionAt: () => ({ lineNumber: 1 }),
    getLanguageId: () => 'typescript',
    getVersionId: () => version,
  }
  return { model, bump: () => version++ }
}

function apiReturning(getNavigationTree: () => Promise<unknown>): MonacoSymbolsApi {
  return {
    languages: {
      typescript: {
        getTypeScriptWorker: async () => async () => ({ getNavigationTree }),
      },
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let scope: EffectScope | null = null

afterEach(() => {
  scope?.stop()
  scope = null
  unregisterEditor(LEAF)
})

function setup(api: MonacoSymbolsApi) {
  const { model, bump } = makeModel()
  registerEditor(LEAF, { getModel: () => model } as never)
  const enabled = ref(false)
  const language = ref<'typescript' | 'javascript' | null>('typescript')
  const filePath = ref<string | null>('a.ts')
  const revision = ref('v1')

  scope = effectScope()
  const state = scope.run(() =>
    useMonacoOutlineSymbols({
      leafId: LEAF,
      enabled,
      language,
      filePath,
      revision,
      debounceMs: 0,
      loadApi: async () => api,
    })
  )!
  return { ...state, enabled, language, filePath, revision, bump }
}

describe('useMonacoOutlineSymbols', () => {
  it('publishes symbols once the outline is enabled', async () => {
    const state = setup(apiReturning(async () => TREE))
    expect(state.symbols.value).toBeNull()

    state.enabled.value = true
    await flush()

    expect(state.symbols.value).toEqual([
      { id: 'typescript:Foo:1', label: 'Foo', kind: 'class', line: 1 },
    ])
  })

  it('discards a result whose model version changed mid-flight', async () => {
    const gate = deferred<NavigationTree>()
    const started = deferred<void>()
    const state = setup(
      apiReturning(() => {
        started.resolve()
        return gate.promise
      })
    )

    state.enabled.value = true
    await started.promise
    state.bump()
    gate.resolve(TREE)
    await flush()

    expect(state.symbols.value).toBeNull()
  })

  it('clears symbols when the file or language no longer qualifies', async () => {
    const state = setup(apiReturning(async () => TREE))
    state.enabled.value = true
    await flush()
    expect(state.symbols.value).not.toBeNull()

    // The clear is synchronous; the follow-up fetch is still debounced.
    state.filePath.value = 'b.ts'
    await nextTick()
    expect(state.symbols.value).toBeNull()

    state.language.value = null
    await flush()
    expect(state.symbols.value).toBeNull()
  })

  it('drops results for a file that changed while the worker was busy', async () => {
    const gate = deferred<NavigationTree>()
    const started = deferred<void>()
    let calls = 0
    const state = setup(
      apiReturning(() => {
        calls++
        if (calls === 1) {
          started.resolve()
          return gate.promise
        }
        return new Promise<NavigationTree>(() => {})
      })
    )

    state.enabled.value = true
    await started.promise
    state.filePath.value = 'b.ts'
    gate.resolve(TREE)
    await flush()

    expect(state.symbols.value).toBeNull()
  })
})

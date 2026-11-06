import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'
import { useFileOutline } from '../composables/useFileOutline'
import type { OutlineItem, OutlineSource } from '../types/outline'
import type { OutlineWorkerRequest } from '../utils/outlineBuild'

async function flush(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 5))
  await nextTick()
}

function setup(options: {
  kind?: string | null
  language?: string | null
  text?: string
  tokens?: OutlineItem[] | null
  tokensSource?: string
  createWorker?: () => Worker | null
  codeSymbols?: Ref<OutlineItem[] | null>
}) {
  const kind = ref<string | null>(options.kind ?? 'text')
  const language = ref<string | null>(options.language ?? 'typescript')
  const text = ref(options.text ?? '')
  const tokens = ref<OutlineItem[] | null>(options.tokens ?? null)
  const tokensSource = ref(options.tokensSource ?? '')
  const outline = useFileOutline({
    kind,
    language,
    text,
    markdownTokens: tokens,
    markdownTokensSource: tokensSource,
    codeSymbols: options.codeSymbols,
    debounceMs: 0,
    ...(options.createWorker ? { createWorker: options.createWorker } : {}),
  })
  return { kind, language, text, tokens, tokensSource, ...outline }
}

function makeFakeWorker() {
  const sent: OutlineWorkerRequest[] = []
  return {
    sent,
    terminated: false,
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    postMessage(message: OutlineWorkerRequest) {
      sent.push(message)
    },
    terminate() {
      this.terminated = true
    },
    reply(index: number, source: OutlineSource) {
      const request = sent[index]
      if (!request) throw new Error(`No worker request at ${index}`)
      this.onmessage?.({ data: { id: request.id, source } } as MessageEvent)
    },
  }
}

function labels(source: OutlineSource): string[] {
  return source.items.map((item) => item.label)
}

describe('useFileOutline', () => {
  it('scans supported code with the regex provider', async () => {
    const outline = setup({ text: 'export function run() {}\n' })
    await flush()
    expect(outline.source.value).toMatchObject({
      mode: 'code',
      status: 'ok',
      loading: false,
      provider: 'regex',
      language: 'typescript',
    })
    expect(outline.source.value.items.map((item) => item.label)).toEqual(['run()'])
  })

  it('reports an empty state for a supported file with no symbols', async () => {
    const outline = setup({ text: '// nothing here\n' })
    await flush()
    expect(outline.source.value.status).toBe('empty')
    expect(outline.source.value.items).toEqual([])
  })

  it('returns mode none for unsupported languages', async () => {
    const outline = setup({ language: 'css', text: 'a { color: red }' })
    await flush()
    expect(outline.source.value.mode).toBe('none')
  })

  it('builds JSON outlines and surfaces parse errors with a line', async () => {
    const valid = setup({ language: 'json', text: '{"a": 1}' })
    await flush()
    expect(valid.source.value).toMatchObject({ mode: 'json', status: 'ok', provider: 'json' })
    expect(valid.source.value.items[0].label).toBe('a')

    const invalid = setup({ language: 'json', text: '{\n  "a": 1,\n  "b"\n}' })
    await flush()
    expect(invalid.source.value.status).toBe('error')
    expect(invalid.source.value.errorLine).toBe(4)
    expect(invalid.source.value.message).toBeTruthy()
  })

  it('reports a JSON scalar as empty rather than an error', async () => {
    const outline = setup({ language: 'json', text: '42' })
    await flush()
    expect(outline.source.value.status).toBe('empty')
    expect(outline.source.value.items).toEqual([])
  })

  it('detects YAML and TOML as structured modes', async () => {
    const yaml = setup({ language: 'yml', text: 'a: 1\nb:\n  - x\n' })
    await flush()
    expect(yaml.source.value).toMatchObject({
      mode: 'yaml',
      status: 'ok',
      provider: 'structured',
    })
    expect(yaml.source.value.items.map((item) => item.label)).toEqual(['a', 'b'])
    expect(yaml.source.value.items[1].children?.[0]).toMatchObject({
      id: '$.b[0]',
      label: '[0]',
      value: '"x"',
    })

    const toml = setup({ language: 'toml', text: '[server]\nhost = "x"\n' })
    await flush()
    expect(toml.source.value).toMatchObject({
      mode: 'toml',
      status: 'ok',
      provider: 'structured',
    })
    expect(toml.source.value.items[0]).toMatchObject({ id: '$.server', kind: 'object' })
  })

  it('surfaces YAML/TOML errors with the source line', async () => {
    const yaml = setup({ language: 'yaml', text: 'a: 1\na: 2\n' })
    await flush()
    expect(yaml.source.value).toMatchObject({ mode: 'yaml', status: 'error', errorLine: 2 })

    const toml = setup({ language: 'toml', text: 'a = 1\nb = 2\nc =' })
    await flush()
    expect(toml.source.value).toMatchObject({ mode: 'toml', status: 'error', errorLine: 3 })
  })

  it('consumes Markdown tokens from the shared lexer pass', async () => {
    const tokens: OutlineItem[] = [
      {
        id: 'hello',
        label: 'Hello',
        kind: 'heading',
        level: 1,
        line: 1,
        anchor: 'hello',
      },
    ]
    const outline = setup({
      kind: 'markdown',
      language: 'markdown',
      text: '# Hello\n',
      tokens,
      tokensSource: '# Hello\n',
    })
    await nextTick()
    expect(outline.source.value).toMatchObject({
      mode: 'markdown',
      status: 'ok',
      loading: false,
      provider: 'lexer',
    })
    expect(outline.source.value.items).toEqual(tokens)
  })

  it('parses code in the worker and drops stale replies by request id', async () => {
    const worker = makeFakeWorker()
    const outline = setup({
      text: 'export function one() {}',
      createWorker: () => worker as unknown as Worker,
    })
    await flush()

    expect(worker.sent).toHaveLength(1)
    expect(outline.source.value).toMatchObject({ mode: 'code', loading: true })

    outline.text.value = 'export function two() {}'
    await flush()
    expect(worker.sent).toHaveLength(2)

    worker.reply(0, {
      mode: 'code',
      items: [{ id: 'old', label: 'one()', kind: 'function', line: 1 }],
      status: 'ok',
      loading: false,
      provider: 'regex',
    })
    expect(labels(outline.source.value)).not.toContain('one()')

    worker.reply(1, {
      mode: 'code',
      items: [{ id: 'new', label: 'two()', kind: 'function', line: 1 }],
      status: 'ok',
      loading: false,
      provider: 'regex',
    })
    expect(labels(outline.source.value)).toEqual(['two()'])
    expect(outline.source.value.loading).toBe(false)
  })

  it('parses JSON in the worker', async () => {
    const worker = makeFakeWorker()
    const outline = setup({
      language: 'json',
      text: '{"a": 1}',
      createWorker: () => worker as unknown as Worker,
    })
    await flush()

    expect(worker.sent).toHaveLength(1)
    expect(worker.sent[0]).toMatchObject({ mode: 'json', text: '{"a": 1}' })

    worker.reply(0, {
      mode: 'json',
      items: [{ id: '$', label: 'root', kind: 'object', line: 1 }],
      status: 'ok',
      loading: false,
      provider: 'json',
    })
    expect(labels(outline.source.value)).toEqual(['root'])
  })

  it('falls back synchronously when no worker can be created', async () => {
    const outline = setup({
      text: 'export function run() {}\n',
      createWorker: () => null,
    })
    await flush()
    expect(outline.source.value.loading).toBe(false)
    expect(labels(outline.source.value)).toEqual(['run()'])
  })

  it('falls back synchronously when worker creation throws', async () => {
    const outline = setup({
      text: 'export function run() {}\n',
      createWorker: () => {
        throw new Error('blocked by CSP')
      },
    })
    await flush()
    expect(labels(outline.source.value)).toEqual(['run()'])
  })

  it('falls back synchronously when the worker never replies', async () => {
    vi.useFakeTimers()
    try {
      const worker = makeFakeWorker()
      const outline = setup({
        text: 'export function run() {}\n',
        createWorker: () => worker as unknown as Worker,
      })
      await nextTick()
      vi.advanceTimersByTime(0)
      await nextTick()

      expect(worker.sent).toHaveLength(1)
      expect(outline.source.value.loading).toBe(true)

      vi.advanceTimersByTime(2000)
      expect(outline.source.value.loading).toBe(false)
      expect(labels(outline.source.value)).toEqual(['run()'])
      expect(worker.terminated).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back synchronously when posting to the worker throws', async () => {
    const worker = makeFakeWorker()
    worker.postMessage = () => {
      throw new Error('worker is gone')
    }
    const outline = setup({
      text: 'export function run() {}\n',
      createWorker: () => worker as unknown as Worker,
    })
    await flush()
    expect(labels(outline.source.value)).toEqual(['run()'])
    expect(worker.terminated).toBe(true)
  })

  it('does not use a worker for Markdown', async () => {
    const worker = makeFakeWorker()
    const tokens: OutlineItem[] = [
      { id: 'hello', label: 'Hello', kind: 'heading', level: 1, line: 1, anchor: 'hello' },
    ]
    const outline = setup({
      kind: 'markdown',
      language: 'markdown',
      text: '# Hello\n',
      tokens,
      tokensSource: '# Hello\n',
      createWorker: () => worker as unknown as Worker,
    })
    await nextTick()
    expect(worker.sent).toHaveLength(0)
    expect(outline.source.value.items).toEqual(tokens)
  })

  it('prefers Monaco symbols and falls back to regex when they are cleared', async () => {
    const symbols = ref<OutlineItem[] | null>([
      { id: 'typescript:Foo:1', label: 'Foo', kind: 'class', line: 1 },
    ])
    const outline = setup({ text: 'export function run() {}\n', codeSymbols: symbols })
    await flush()
    expect(outline.source.value).toMatchObject({
      mode: 'code',
      provider: 'monaco',
      status: 'ok',
      language: 'typescript',
    })
    expect(outline.source.value.items.map((item) => item.label)).toEqual(['Foo'])

    // Results can change without a text change; the cache must not win.
    symbols.value = [{ id: 'typescript:Bar:2', label: 'Bar', kind: 'interface', line: 2 }]
    await flush()
    expect(outline.source.value.items.map((item) => item.label)).toEqual(['Bar'])

    symbols.value = null
    await flush()
    expect(outline.source.value).toMatchObject({ provider: 'regex' })
    expect(outline.source.value.items.map((item) => item.label)).toEqual(['run()'])
  })

  it('reports an empty Monaco result instead of falling back', async () => {
    const symbols = ref<OutlineItem[] | null>([])
    const outline = setup({ text: 'export function run() {}\n', codeSymbols: symbols })
    await flush()
    expect(outline.source.value).toMatchObject({ provider: 'monaco', status: 'empty' })
    expect(outline.source.value.items).toEqual([])
  })

  it('leaves Markdown and JSON providers alone when Monaco symbols exist', async () => {
    const symbols = ref<OutlineItem[] | null>([
      { id: 'typescript:Foo:1', label: 'Foo', kind: 'class', line: 1 },
    ])
    const markdown = setup({
      kind: 'markdown',
      language: 'markdown',
      text: '# Hello\n',
      codeSymbols: symbols,
    })
    await nextTick()
    expect(markdown.source.value).toMatchObject({ mode: 'markdown', provider: 'lexer' })

    const json = setup({ kind: 'text', language: 'json', text: '{"a": 1}', codeSymbols: symbols })
    await flush()
    expect(json.source.value).toMatchObject({ mode: 'json', provider: 'json' })
  })

  it('marks the Markdown outline as loading while the token pass is pending or stale', async () => {
    const outline = setup({ kind: 'markdown', language: 'markdown', text: '# Hello\n' })
    await nextTick()
    expect(outline.source.value.loading).toBe(true)

    const tokens: OutlineItem[] = [
      { id: 'old', label: 'Old', kind: 'heading', level: 1, line: 1, anchor: 'old' },
    ]
    outline.tokens.value = tokens
    outline.tokensSource.value = '# Old\n'
    await nextTick()
    expect(outline.source.value.loading).toBe(true)
    expect(outline.source.value.items).toEqual(tokens)
  })
})

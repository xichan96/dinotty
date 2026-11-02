import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { useFileOutline } from '../composables/useFileOutline'
import type { OutlineItem } from '../types/outline'

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
    debounceMs: 0,
  })
  return { kind, language, text, tokens, tokensSource, ...outline }
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

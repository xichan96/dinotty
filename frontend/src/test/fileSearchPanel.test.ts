import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import FileSearchPanel from '../components/workspace/FileSearchPanel.vue'
import { authFetch } from '../composables/apiBase'
import type { WorkspaceSearchMatch } from '../composables/useWorkspaceSearch'

vi.mock('../composables/apiBase', () => ({
  getApiBase: vi.fn().mockResolvedValue(''),
  apiUrl: (path: string) => path,
  authFetch: vi.fn(),
}))

const fetchMock = vi.mocked(authFetch)

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function ok(matches: WorkspaceSearchMatch[], truncated = false): Response {
  return response({ matches, truncated })
}

function match(file_path: string, line: number, line_text = 'needle here'): WorkspaceSearchMatch {
  return { file_path, line, column: 0, line_text }
}

let wrapper: VueWrapper | null = null

function mountPanel(props: { paneId?: string; isSsh?: boolean } = {}) {
  if (wrapper) wrapper.unmount()
  wrapper = mount(FileSearchPanel, {
    props: { paneId: props.paneId ?? 'pane-1', isSsh: props.isSsh ?? false },
  })
  return wrapper
}

function input() {
  return wrapper!.find('input')
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0)
  await nextTick()
}

async function typeQuery(text: string) {
  await input().setValue(text)
  await vi.advanceTimersByTimeAsync(300)
  await nextTick()
}

async function toggle(index: 0 | 1 | 2) {
  await wrapper!.findAll('.search-toggle')[index].trigger('click')
  await flush()
}

function lastBody() {
  const calls = fetchMock.mock.calls
  const call = calls[calls.length - 1]
  return JSON.parse(String(call[1]?.body))
}

function lastOpenFile(): unknown[] {
  const emitted = wrapper!.emitted('open-file')!
  return emitted[emitted.length - 1]
}

function markTexts(): string[] {
  return wrapper!.findAll('mark').map((m) => m.text())
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(ok([]))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe('FileSearchPanel request wiring', () => {
  it('sends the pane id, query and option toggles', async () => {
    mountPanel({ paneId: 'pane-7' })

    await typeQuery('foo')
    expect(lastBody()).toEqual({
      pane_id: 'pane-7',
      path: '.',
      query: 'foo',
      regex: false,
      word: false,
      case_sensitive: false,
      max_results: 500,
    })

    await toggle(0) // Aa
    await toggle(1) // ab
    await toggle(2) // .*

    expect(lastBody()).toMatchObject({
      pane_id: 'pane-7',
      query: 'foo',
      case_sensitive: true,
      word: true,
      regex: true,
    })
    const toggles = wrapper!.findAll('.search-toggle')
    expect(toggles[0].classes()).toContain('on')
    expect(toggles[0].attributes('aria-pressed')).toBe('true')
    expect(toggles[1].classes()).toContain('on')
    expect(toggles[2].classes()).toContain('on')
  })

  it('debounces typing and only searches the latest query', async () => {
    mountPanel()

    await input().setValue('a')
    await input().setValue('ab')
    await vi.advanceTimersByTimeAsync(179)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2)
    await nextTick()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastBody().query).toBe('ab')
  })

  it('Enter searches immediately and cancels the pending debounce', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(ok([match('a.ts', 1, 'bar')]))

    await input().setValue('bar')
    await input().trigger('keydown', { key: 'Enter' })
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastBody().query).toBe('bar')
  })

  it('clicking an example searches immediately', async () => {
    mountPanel()
    const example = wrapper!.find('.search-example')
    expect(example.exists()).toBe(true)

    await example.trigger('click')
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastBody().query).toBe('function')
  })

  it('typing an empty query clears the results without a request', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(ok([match('a.ts', 1)]))
    await typeQuery('x')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper!.findAll('.search-file-group')).toHaveLength(1)

    await input().setValue('')
    await vi.advanceTimersByTimeAsync(300)
    await nextTick()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper!.findAll('.search-file-group')).toHaveLength(0)
    expect(wrapper!.find('.search-hint').exists()).toBe(true)
  })
})

describe('FileSearchPanel results rendering', () => {
  const matches = [
    match('src/a.ts', 3, 'const foo = 1'),
    match('src/a.ts', 9, 'foo()'),
    match('src/b.ts', 1, 'foo bar'),
  ]

  it('groups rows by file, shows the summary, and emits open-file', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(ok(matches))

    await typeQuery('foo')

    const groups = wrapper!.findAll('.search-file-group')
    expect(groups).toHaveLength(2)

    const firstFile = groups[0].find('.search-file')
    expect(firstFile.text()).toContain('a.ts')
    expect(firstFile.text()).toContain('src')
    expect(groups[0].findAll('.search-match')).toHaveLength(2)
    expect(groups[0].find('.sf-count').text()).toBe('2')
    expect(groups[1].find('.sf-count').text()).toBe('1')

    const summary = wrapper!.find('.search-summary').text()
    expect(summary).toContain('3 results')
    expect(summary).toContain('2 files')

    await groups[0].findAll('.search-match')[1].trigger('click')
    expect(lastOpenFile()).toEqual(['src/a.ts', 9])

    await groups[0].find('.search-file').trigger('click')
    expect(lastOpenFile()).toEqual(['src/a.ts', 3])
  })

  it('caps each file at 6 visible rows and reports the remainder', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(
      ok(Array.from({ length: 8 }, (_, i) => match('src/big.ts', i + 1)))
    )

    await typeQuery('foo')

    expect(wrapper!.findAll('.search-match')).toHaveLength(6)
    expect(wrapper!.find('.search-more').text()).toContain('2 more matches')
  })

  it('shows the cap hint when the backend returns 500 matches', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(
      ok(Array.from({ length: 500 }, (_, i) => match('src/big.ts', i + 1)), true)
    )

    await typeQuery('foo')

    expect(wrapper!.find('.search-summary').text()).toContain('(first 500)')
  })

  it('shows a no-results state for an empty match list', async () => {
    mountPanel()

    await typeQuery('nothing')

    expect(wrapper!.find('.search-summary').text()).toContain('No results.')
    expect(wrapper!.find('.search-state').text()).toContain('No results.')
  })
})

describe('FileSearchPanel highlighting', () => {
  it('highlights case-insensitively by default', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(ok([match('a.ts', 1, 'Foo foo FOO')]))

    await typeQuery('foo')

    expect(markTexts()).toEqual(['Foo', 'foo', 'FOO'])
  })

  it('workspace "Match Case" only marks exact case', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(ok([match('a.ts', 1, 'Foo foo')]))
    await toggle(0)

    await typeQuery('Foo')

    expect(markTexts()).toEqual(['Foo'])
  })

  it('whole-word mode does not highlight inside larger words', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(ok([match('a.ts', 1, 'food foo')]))
    await toggle(1)

    await typeQuery('foo')

    expect(markTexts()).toEqual(['foo'])
  })

  it('regex mode highlights every pattern match', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(ok([match('a.ts', 1, 'foo fxo')]))
    await toggle(2)

    await typeQuery('f.o')

    expect(markTexts()).toEqual(['foo', 'fxo'])
  })
})

describe('FileSearchPanel errors', () => {
  it('shows the ripgrep-missing message on 502', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(response({ error: 'ripgrep not installed' }, 502))

    await typeQuery('foo')

    expect(wrapper!.find('.search-state.error').text()).toContain('ripgrep')
    expect(wrapper!.find('.search-summary').text()).toContain('ripgrep')
  })

  it('shows the invalid-regex message on 400 in regex mode', async () => {
    mountPanel()
    fetchMock.mockResolvedValue(response({ error: 'regex parse error' }, 400))
    await toggle(2)

    await typeQuery('[')

    expect(wrapper!.find('.search-state.error').text()).toContain(
      'Invalid regular expression.'
    )
  })

  it('shows the network message when the request rejects', async () => {
    mountPanel()
    fetchMock.mockRejectedValue(new Error('offline'))

    await typeQuery('foo')

    expect(wrapper!.find('.search-state.error').text()).toContain('network error')
  })

  it('refuses SSH sessions without calling the backend', async () => {
    mountPanel({ isSsh: true })

    await typeQuery('foo')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper!.find('.search-state.error').text()).toContain(
      'not available for SSH sessions'
    )
  })
})

describe('FileSearchPanel lifecycle', () => {
  it('does not issue a debounced request after unmount', async () => {
    mountPanel()
    await input().setValue('abc')

    wrapper!.unmount()
    wrapper = null
    await vi.advanceTimersByTimeAsync(300)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('FileSearchPanel keyboard', () => {
  it('Escape emits close', async () => {
    mountPanel()

    await input().trigger('keydown', { key: 'Escape' })

    expect(wrapper!.emitted('close')).toHaveLength(1)
  })
})

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(async (_text: string) => {}),
}))

vi.mock('../utils/clipboard', () => ({
  copyToClipboard: clipboardMocks.copyToClipboard,
}))

vi.mock('../components/workspace/MonacoEditor.vue', () => ({
  __esModule: true,
  default: {
    name: 'MonacoEditor',
    props: ['modelValue', 'language', 'readonly', 'filePath', 'paneId', 'leafId'],
    template:
      '<div class="monaco-stub" :data-language="language" :data-readonly="String(readonly)"></div>',
  },
}))

import StructuredPreview from '../components/workspace/StructuredPreview.vue'
import StructuredTree from '../components/workspace/StructuredTree.vue'
import {
  parseStructuredOutline,
  STRUCTURED_MAX_NODES,
  structuredFormatForPath,
  type StructuredFormat,
} from '../utils/structuredOutline'

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
}

function mountTree(text: string, format: StructuredFormat = 'json') {
  const { items } = parseStructuredOutline(text, format)
  return mount(StructuredTree, { props: { items } })
}

function rowLabels(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('[role="treeitem"]')
    .map((row) => row.find('.structured-tree-label').text())
}

function mountPreview(
  overrides: Record<string, unknown> = {},
  options: Record<string, unknown> = {}
) {
  return mount(StructuredPreview, {
    props: {
      content: '{"a": 1}',
      filePath: 'config.json',
      format: 'json',
      ...overrides,
    },
    ...options,
  })
}

beforeEach(() => {
  clipboardMocks.copyToClipboard.mockClear()
})

describe('structuredFormatForPath', () => {
  it('maps structured extensions case-insensitively', () => {
    expect(structuredFormatForPath('config.json')).toBe('json')
    expect(structuredFormatForPath('dir/CONFIG.JSON')).toBe('json')
    expect(structuredFormatForPath('app.yaml')).toBe('yaml')
    expect(structuredFormatForPath('app.yml')).toBe('yaml')
    expect(structuredFormatForPath('Cargo.Toml')).toBe('toml')
  })

  it('ignores query strings and fragments', () => {
    expect(structuredFormatForPath('config.json?v=1')).toBe('json')
    expect(structuredFormatForPath('app.yaml#main')).toBe('yaml')
  })

  it('returns null for other files and missing paths', () => {
    expect(structuredFormatForPath('notes.jsonc')).toBeNull()
    expect(structuredFormatForPath('script.ts')).toBeNull()
    expect(structuredFormatForPath('')).toBeNull()
    expect(structuredFormatForPath(null)).toBeNull()
    expect(structuredFormatForPath(undefined)).toBeNull()
  })
})

describe('StructuredTree', () => {
  const SOURCE = '{"a":{"b":{"c":1}},"list":[1,2],"empty":{}}'

  it('renders an accessible tree with default depth and collapsed arrays', () => {
    const wrapper = mountTree(SOURCE)
    expect(wrapper.find('[role="tree"]').exists()).toBe(true)

    // Two levels below the roots are expanded; arrays stay collapsed.
    expect(rowLabels(wrapper)).toEqual(['a', 'b', 'c', 'list', 'empty'])

    const rows = wrapper.findAll('[role="treeitem"]')
    expect(rows[0].attributes('aria-level')).toBe('1')
    expect(rows[0].attributes('aria-expanded')).toBe('true')
    const list = wrapper.find('[data-path="$.list"]')
    expect(list.attributes('aria-expanded')).toBe('false')
    expect(list.find('.structured-tree-value').text()).toBe('[2]')
    expect(wrapper.find('[data-path="$.a.b.c"] .structured-tree-line').text()).toBe('1')
    wrapper.unmount()
  })

  it('expands and collapses arrays on demand', async () => {
    const wrapper = mountTree(SOURCE)

    await wrapper.find('[data-path="$.list"] .structured-tree-chevron').trigger('click')
    expect(rowLabels(wrapper)).toContain('[0]')
    expect(rowLabels(wrapper)).toContain('[1]')

    await wrapper.find('[data-testid="structured-collapse-all"]').trigger('click')
    expect(rowLabels(wrapper)).toEqual(['a', 'list', 'empty'])

    await wrapper.find('[data-testid="structured-expand-all"]').trigger('click')
    expect(rowLabels(wrapper)).toEqual(['a', 'b', 'c', 'list', '[0]', '[1]', 'empty'])
    wrapper.unmount()
  })

  it('toggles from the keyboard', async () => {
    const wrapper = mountTree(SOURCE)
    const row = wrapper.find('[data-path="$.a"]')

    await row.trigger('keydown', { key: 'Enter' })
    expect(rowLabels(wrapper)).not.toContain('b')

    await row.trigger('keydown', { key: ' ' })
    expect(rowLabels(wrapper)).toContain('b')
    wrapper.unmount()
  })

  it('copies the JSON path and shows success feedback', async () => {
    const wrapper = mountTree(SOURCE)
    const row = wrapper.find('[data-path="$.a.b"]')

    await row.find('.structured-tree-copy').trigger('click')
    await settle()

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith('$.a.b')
    expect(row.find('.structured-tree-copy').classes()).toContain('copied')
    expect(row.find('.structured-tree-copy').text()).toContain('Copied')
    wrapper.unmount()
  })
})

describe('StructuredPreview', () => {
  it('opens on the tree tab', () => {
    const wrapper = mountPreview()
    expect(wrapper.find('[data-testid="structured-tree-tab"]').classes()).toContain('active')
    expect(rowLabels(wrapper)).toEqual(['a'])
    wrapper.unmount()
  })

  it('switches to a readonly Monaco source when truncated', async () => {
    const wrapper = mountPreview({ content: '{"a": 1}', truncated: true })

    expect(wrapper.find('.structured-banner').text()).toContain('Only the first 512 KB is shown')

    await wrapper.find('[data-testid="structured-source-tab"]').trigger('click')
    await settle()

    const monaco = wrapper.find('.monaco-stub')
    expect(monaco.exists()).toBe(true)
    expect(monaco.attributes('data-language')).toBe('json')
    expect(monaco.attributes('data-readonly')).toBe('true')
    wrapper.unmount()
  })

  it('shows the parse error line and re-parses on retry', async () => {
    const wrapper = mountPreview({ content: 'a: 1\na: 2\n', filePath: 'app.yaml', format: 'yaml' })

    const state = wrapper.find('.structured-state.error')
    expect(state.exists()).toBe(true)
    expect(state.text()).toContain('Could not parse this file')
    expect(state.text()).toContain('Line 2')

    await wrapper.find('[data-testid="structured-retry"]').trigger('click')
    expect(wrapper.find('.structured-state.error').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the empty state when there are no keys', () => {
    const wrapper = mountPreview({ content: '{}' })
    expect(wrapper.text()).toContain('No keys found')
    wrapper.unmount()
  })

  it('renders a notice at the parser node cap', () => {
    const atCap = `[${Array.from({ length: STRUCTURED_MAX_NODES }, (_, i) => i).join(',')}]`
    const large = mountPreview({ content: atCap }, { stubs: { StructuredTree: true } })
    expect(large.find('.structured-notice').exists()).toBe(true)
    large.unmount()

    const small = mountPreview({ content: '[1,2,3]' })
    expect(small.find('.structured-notice').exists()).toBe(false)
    small.unmount()
  })

  it('resets to the tree tab when the file changes', async () => {
    const wrapper = mountPreview()
    await wrapper.find('[data-testid="structured-source-tab"]').trigger('click')
    expect(wrapper.find('[data-testid="structured-source-tab"]').classes()).toContain('active')

    await wrapper.setProps({ filePath: 'other.json' })
    expect(wrapper.find('[data-testid="structured-tree-tab"]').classes()).toContain('active')
    wrapper.unmount()
  })

  it('emits the outline toggle and mirrors its pressed state', async () => {
    const wrapper = mountPreview({
      outlineAvailable: true,
      outlineOpen: true,
      outlinePanelId: 'outline-panel-1',
    })
    const button = wrapper.find('.structured-outline')
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(button.attributes('aria-controls')).toBe('outline-panel-1')

    await button.trigger('click')
    expect(wrapper.emitted('toggle-outline')).toHaveLength(1)
    wrapper.unmount()
  })
})

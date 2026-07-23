import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SearchBar from '../components/terminal/SearchBar.vue'
import { settings } from '../composables/useSettings'

const source = readFileSync(
  resolve(process.cwd(), 'src/components/terminal/SearchBar.vue'),
  'utf8'
)

function mountSearch(locale: 'en' | 'zh') {
  settings.locale = locale
  return mount(SearchBar, {
    props: {
      terminal: {
        searchAddon: {
          clearDecorations() {},
          findNext() {},
          findPrevious() {},
        },
      } as any,
    },
  })
}

describe('SearchBar mobile localization', () => {
  it('renders localized placeholder and accessible controls in English and Chinese', () => {
    const en = mountSearch('en')
    expect(en.get('input').attributes('placeholder')).toBe('Search…')
    expect(en.findAll('button').map((button) => button.attributes('title'))).toEqual([
      'Previous (Shift+Enter)',
      'Next (Enter)',
      'Close (Escape)',
    ])
    expect(en.findAll('button').every((button) => button.attributes('aria-label') === button.attributes('title'))).toBe(true)
    en.unmount()

    const zh = mountSearch('zh')
    expect(zh.get('input').attributes('placeholder')).toBe('搜索…')
    expect(zh.findAll('button').map((button) => button.attributes('title'))).toEqual([
      '上一个（Shift+Enter）',
      '下一个（Enter）',
      '关闭（Escape）',
    ])
    zh.unmount()
  })

  it('bounds and shrinks the search input at phone width', () => {
    expect(source).toMatch(/@media \(max-width: 480px\)/)
    expect(source).toMatch(/\.search-bar\s*{[^}]*left:\s*4px;[^}]*right:\s*4px;/s)
    expect(source).toMatch(/\.search-bar-input-wrap\s*{[^}]*min-width:\s*0;/s)
    expect(source).toMatch(/\.search-bar-input\s*{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s)
  })
})

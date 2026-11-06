import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { folderIconKey, folderIconUrl } from '../components/workspace/folderIcons'
import { treeFolderIcon } from '../components/workspace/TreeRows'

describe('folderIconKey', () => {
  it('maps common folder names case-insensitively', () => {
    expect(folderIconKey('src')).toBe('src')
    expect(folderIconKey('SRC')).toBe('src')
    expect(folderIconKey('tests')).toBe('test')
    expect(folderIconKey('.venv')).toBe('python')
    expect(folderIconKey('.pytest_cache')).toBe('pytest')
    expect(folderIconKey('.claude')).toBe('claude')
  })

  it('groups alternate names under one icon', () => {
    expect(folderIconKey('build')).toBe('dist')
    expect(folderIconKey('out')).toBe('dist')
    expect(folderIconKey('plugins')).toBe('plugin')
    expect(folderIconKey('scripts')).toBe('script')
    expect(folderIconKey('node_modules')).toBe('node')
  })

  it('falls back to the plain folder glyph', () => {
    expect(folderIconKey('deploy')).toBe('default_folder')
    expect(folderIconKey('sdk')).toBe('default_folder')
    expect(folderIconKey('')).toBe('default_folder')
  })
})

describe('folderIconUrl', () => {
  it('uses the open-tab variant when the folder is expanded', () => {
    const closed = folderIconUrl('src', false)
    const opened = folderIconUrl('src', true)
    expect(closed).not.toBe(opened)
    expect(closed).toContain('src.svg')
    expect(opened).toContain('src_opened.svg')
  })

  it('resolves unknown folders to the default glyph', () => {
    expect(folderIconUrl('deploy', false)).toContain('default_folder.svg')
    expect(folderIconUrl('deploy', true)).toContain('default_folder_opened.svg')
  })
})

describe('treeFolderIcon', () => {
  it('renders the mapped folder image for a named directory', () => {
    const wrapper = mount({ render: () => treeFolderIcon(false, 'src') })
    const img = wrapper.find('img.tree-kind-icon')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe(folderIconUrl('src', false))
    expect(img.attributes('draggable')).toBe('false')
  })
})

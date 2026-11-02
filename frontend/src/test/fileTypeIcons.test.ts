import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { fileTypeGlyph } from '../components/workspace/fileTypeIcons'
import { treeFileIcon } from '../components/workspace/TreeRows'

const DEFAULT_CHAR = '\uE023'

describe('fileTypeGlyph', () => {
  it('prefers exact file names over extensions', () => {
    expect(fileTypeGlyph('README.md').char).toBe('\uE04D')
    expect(fileTypeGlyph('docs/readme.md').char).toBe('\uE04D')
    expect(fileTypeGlyph('LICENSE').char).toBe('\uE05A')
    expect(fileTypeGlyph('yarn.lock').char).toBe('\uE0A6')
  })

  it('matches extensions case-insensitively', () => {
    expect(fileTypeGlyph('main.GO').char).toBe('\uE03A')
    expect(fileTypeGlyph('App.Tsx').char).toBe('\uE099')
    expect(fileTypeGlyph('styles.CSS').char).toBe('\uE01D')
  })

  it('resolves names in nested and Windows-style paths', () => {
    expect(fileTypeGlyph('test/camera-device/camera_test.py').char).toBe('\uE07B')
    expect(fileTypeGlyph('test\\camera-device\\main.go').char).toBe('\uE03A')
  })

  it('falls back to the plain document glyph', () => {
    expect(fileTypeGlyph('Makefile.bak').char).toBe(DEFAULT_CHAR)
    expect(fileTypeGlyph('no-extension').char).toBe(DEFAULT_CHAR)
    expect(fileTypeGlyph('').char).toBe(DEFAULT_CHAR)
  })

  it('does not treat dotfiles as extensions', () => {
    expect(fileTypeGlyph('.nvmrc').char).toBe(DEFAULT_CHAR)
    expect(fileTypeGlyph('.gitignore').char).toBe('\uE034')
  })
})

describe('treeFileIcon', () => {
  it('renders the mapped Seti glyph with its type colour', () => {
    const wrapper = mount({ render: () => treeFileIcon('main.go') })
    const icon = wrapper.find('.tree-file-glyph')
    expect(icon.exists()).toBe(true)
    expect(icon.text()).toBe('\uE03A')
    expect(icon.classes()).toContain('tree-kind-icon-file')
    expect((icon.element as HTMLElement).style.color).toBe('#519aba')
  })
})

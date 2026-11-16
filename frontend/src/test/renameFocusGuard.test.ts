import { describe, expect, it } from 'vitest'
import { isRenamingTabTitle, TAB_TITLE_INPUT_CLASS } from '../utils/renameFocusGuard'

function el(className: string): HTMLElement {
  const node = document.createElement('div')
  node.className = className
  return node
}

describe('isRenamingTabTitle', function isRenamingTabTitleSuite() {
  it('应识别重命名输入框', function detectsRenameInput() {
    expect(isRenamingTabTitle(el(TAB_TITLE_INPUT_CLASS))).toBe(true)
    expect(isRenamingTabTitle(el(`foo ${TAB_TITLE_INPUT_CLASS} bar`))).toBe(true)
  })

  it('其他焦点目标不应拦截终端聚焦', function ignoresOtherTargets() {
    expect(isRenamingTabTitle(el('tab-title'))).toBe(false)
    expect(isRenamingTabTitle(el('tab-title-input-other'))).toBe(false)
    expect(isRenamingTabTitle(el('xterm-helper-textarea'))).toBe(false)
  })

  it('缺少焦点元素时应返回 false', function handlesNull() {
    expect(isRenamingTabTitle(null)).toBe(false)
    expect(isRenamingTabTitle(undefined)).toBe(false)
  })
})

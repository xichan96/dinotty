import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Component } from 'vue'
import { actionKeyToKeyDef } from '../utils/actionKeyDef'
import {
  KEYBOARD_SPECIAL_KEYS,
  parseKeyboardSpecial,
  serializeKeyboardSpecial,
} from '../utils/keyboardSpecialKeys'

describe('keyboard special key catalog', () => {
  it('contains every accepted key and round-trips once and persistent modifier modes', () => {
    expect(KEYBOARD_SPECIAL_KEYS.map((item) => item.id)).toEqual([
      'ctrl',
      'shift',
      'alt',
      'opt',
      'cmd',
      'win',
      'tab',
      'esc',
    ])
    expect(parseKeyboardSpecial('ctrl')).toMatchObject({ id: 'ctrl', behavior: 'once' })
    expect(parseKeyboardSpecial('ctrl:lock')).toMatchObject({ id: 'ctrl', behavior: 'lock' })
    expect(serializeKeyboardSpecial('cmd', 'lock')).toBe('cmd:lock')
    expect(serializeKeyboardSpecial('cmd', 'once')).toBe('cmd')
    expect(serializeKeyboardSpecial('tab', 'lock')).toBe('tab')
    expect(parseKeyboardSpecial('future-special')).toBeNull()
  })

  it('renders every special key as icon or text without turning Tab/Esc into modifier events', () => {
    const iconCtrl = actionKeyToKeyDef({
      label: 'Ctrl',
      kind: 'send',
      special: 'ctrl:lock',
      display: 'icon',
    })
    expect(iconCtrl).toMatchObject({ l: '', sp: 'ctrl:lock', aria: 'Ctrl' })
    const ctrlIcon = mount(iconCtrl.icon as Component, { props: { size: 18 } })
    expect(ctrlIcon.get('svg').attributes('data-key-symbol')).toBe('ctrl')
    expect(ctrlIcon.get('svg').attributes('width')).toBe('18')

    const iconWin = actionKeyToKeyDef({
      label: 'Win',
      kind: 'send',
      special: 'win:lock',
      display: 'icon',
    })
    const winIcon = mount(iconWin.icon as Component, { props: { size: 20 } })
    expect(winIcon.get('svg').attributes('data-key-symbol')).toBe('win')
    expect(winIcon.findAll('path')).toHaveLength(4)

    const iconTab = actionKeyToKeyDef({
      label: 'Tab',
      kind: 'send',
      special: 'tab',
      display: 'icon',
    })
    const tabIcon = mount(iconTab.icon as Component, { props: { size: 18 } })
    expect(tabIcon.get('svg').classes()).toContain('lucide-arrow-right-to-line')
    expect(tabIcon.get('svg').classes()).not.toContain('lucide-corner-down-left')

    const textCmd = actionKeyToKeyDef({
      label: 'Cmd',
      kind: 'send',
      special: 'cmd',
      display: 'text',
    })
    expect(textCmd).toMatchObject({ l: 'Cmd', sp: 'cmd' })
    expect(textCmd.icon).toBeUndefined()

    const tab = actionKeyToKeyDef({ label: 'Tab', kind: 'send', special: 'tab', repeat: true })
    const esc = actionKeyToKeyDef({ label: 'Esc', kind: 'send', special: 'esc' })
    expect(tab).toMatchObject({ s: '\t', repeat: true })
    expect(tab.sp).toBeUndefined()
    expect(esc).toMatchObject({ s: '\x1b' })
    expect(esc.sp).toBeUndefined()
  })
})

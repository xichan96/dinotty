import { computed, type ComputedRef, type Ref } from 'vue'
import {
  DEFAULT_ACTION_BOTTOM,
  effectiveActionKeyboard,
  type ActionBottomCluster,
  type ActionKey,
  type SettingsData,
} from './useSettings'
import { actionKeyToKeyDef, mapActionKeys } from '../utils/actionKeyDef'
import { Keyboard, SquareTerminal } from 'lucide-vue-next'
import type { KeyDef } from '../components/keyboard/mkbTypes'

export interface KeyboardLayoutOptions {
  kbMode: Ref<'default' | 'action'>
  settings: SettingsData
}

export interface KeyboardLayoutState {
  row1: KeyDef[]
  row2: KeyDef[]
  row3: ComputedRef<KeyDef[]>
  row4zxcv: KeyDef[]
  arrowUp: KeyDef
  arrowDown: KeyDef
  arrowLeft: KeyDef
  arrowRight: KeyDef
  row5bottom: KeyDef[]
  kbswitchAction: ComputedRef<KeyDef>
  actionFirstRow: ComputedRef<KeyDef[]>
  actionFollowingRows: ComputedRef<KeyDef[][]>
  actionBottom: ComputedRef<ActionBottomCluster>
  actionBottomRows: ComputedRef<KeyDef[][]>
  actionEnter: ComputedRef<KeyDef>
  pasteSupported: ComputedRef<boolean>
  toolbarQuickKeyDefs: ComputedRef<KeyDef[]>
  withActionFooterClass: (def: KeyDef, cls: string) => KeyDef
  mapActionFooterRow: (row: ActionKey[]) => KeyDef[]
}

export function useKeyboardLayout(opts: KeyboardLayoutOptions): KeyboardLayoutState {
  const { kbMode, settings } = opts

  const row1: KeyDef[] = [
    { l: '`', sl: '~', s: '`' },
    { l: '1', sl: '!', s: '1' },
    { l: '2', sl: '@', s: '2' },
    { l: '3', sl: '#', s: '3' },
    { l: '4', sl: '$', s: '4' },
    { l: '5', sl: '%', s: '5' },
    { l: '6', sl: '^', s: '6' },
    { l: '7', sl: '&', s: '7' },
    { l: '8', sl: '*', s: '8' },
    { l: '9', sl: '(', s: '9' },
    { l: '0', sl: ')', s: '0' },
    { l: '-', sl: '_', s: '-' },
    { l: '=', sl: '+', s: '=' },
    { l: '⌫', s: '\x7f', g: 1.5, cls: 'mkb-mod', repeat: true },
  ]

  const row2: KeyDef[] = [
    { l: 'tab', s: '\x09', g: 1.5, cls: 'mkb-mod' },
    { l: 'q', s: 'q' },
    { l: 'w', s: 'w' },
    { l: 'e', s: 'e' },
    { l: 'r', s: 'r' },
    { l: 't', s: 't' },
    { l: 'y', s: 'y' },
    { l: 'u', s: 'u' },
    { l: 'i', s: 'i' },
    { l: 'o', s: 'o' },
    { l: 'p', s: 'p' },
    { l: '[', sl: '{', s: '[' },
    { l: ']', sl: '}', s: ']' },
    { l: '\\', sl: '|', s: '\\', g: 1.5, cls: 'mkb-mod' },
  ]

  const row3 = computed<KeyDef[]>(() => [
    {
      l: '',
      icon: kbMode.value === 'default' ? SquareTerminal : Keyboard,
      sp: 'kbswitch',
      g: 1.7,
      cls: 'mkb-mod',
      id: 'mkb-kbswitch',
    },
    { l: 'a', s: 'a' },
    { l: 's', s: 's' },
    { l: 'd', s: 'd' },
    { l: 'f', s: 'f' },
    { l: 'g', s: 'g' },
    { l: 'h', s: 'h' },
    { l: 'j', s: 'j' },
    { l: 'k', s: 'k' },
    { l: 'l', s: 'l' },
    { l: ';', sl: ':', s: ';' },
    { l: "'", sl: '"', s: "'" },
    { l: '↵', s: '\r', g: 1.5, cls: 'mkb-mod mkb-return' },
  ])

  const row4zxcv: KeyDef[] = [
    { l: '⇧', sp: 'shift', g: 2.2, cls: 'mkb-mod', id: 'mkb-shift' },
    { l: 'z', s: 'z' },
    { l: 'x', s: 'x' },
    { l: 'c', s: 'c' },
    { l: 'v', s: 'v' },
    { l: 'b', s: 'b' },
    { l: 'n', s: 'n' },
    { l: 'm', s: 'm' },
    { l: ',', sl: '<', s: ',', cls: 'mkb-alpha' },
    { l: '.', sl: '>', s: '.', cls: 'mkb-alpha' },
    { l: '/', sl: '?', s: '/', cls: 'mkb-alpha' },
  ]

  const arrowUp: KeyDef = { l: '↑', s: '\x1b[A', repeat: true, cls: 'mkb-arrow' }
  const arrowDown: KeyDef = { l: '↓', s: '\x1b[B', repeat: true, cls: 'mkb-arrow' }
  const arrowLeft: KeyDef = { l: '←', s: '\x1b[D', repeat: true, cls: 'mkb-arrow' }
  const arrowRight: KeyDef = { l: '→', s: '\x1b[C', repeat: true, cls: 'mkb-arrow' }

  const row5bottom: KeyDef[] = [
    { l: 'fn', sp: 'fn', g: 1.05, cls: 'mkb-mod' },
    { l: 'ctrl', sp: 'ctrl', g: 1.05, cls: 'mkb-mod', id: 'mkb-ctrl' },
    { l: 'opt', sp: 'alt', g: 1.05, cls: 'mkb-mod', id: 'mkb-alt' },
    { l: '⌘', sp: 'cmd', g: 1.05, cls: 'mkb-mod' },
    { l: '', s: ' ', g: 8, id: 'mkb-space' },
  ]

  const kbswitchAction = computed<KeyDef>(() => ({
    l: '',
    icon: Keyboard,
    sp: 'kbswitch',
    g: 1.2,
    cls: 'mkb-mod mkb-action-back',
    id: 'mkb-kbswitch2',
  }))

  const actionFirstRow = computed(() => {
    const rows = effectiveActionKeyboard().rows
    const first = rows[0] ?? []
    return [kbswitchAction.value, ...mapActionKeys(first, false)]
  })

  const actionFollowingRows = computed(() => {
    const rows = effectiveActionKeyboard().rows
    if (rows.length < 2) return []
    const tail = rows.slice(1)
    return tail.map((r, i) => mapActionKeys(r ?? [], i === tail.length - 1))
  })

  const actionBottom = computed<ActionBottomCluster>(
    () => effectiveActionKeyboard().bottom ?? DEFAULT_ACTION_BOTTOM
  )

  function withActionFooterClass(def: KeyDef, cls: string): KeyDef {
    return { ...def, cls: [def.cls, cls].filter(Boolean).join(' ') }
  }

  function mapActionFooterRow(row: ActionKey[]): KeyDef[] {
    return mapActionKeys(row, false).map((def, i) =>
      withActionFooterClass(def, row[i].shape === 'arrow' ? 'mkb-action-arrow' : 'mkb-action-btn')
    )
  }

  const actionBottomRows = computed(() => actionBottom.value.rows.map(mapActionFooterRow))
  const actionEnter = computed(() =>
    withActionFooterClass(
      actionKeyToKeyDef(actionBottom.value.enter),
      'mkb-action-enter mkb-return'
    )
  )

  const pasteSupported = computed(
    () => window.isSecureContext && typeof navigator.clipboard?.readText === 'function'
  )

  const toolbarQuickKeyDefs = computed(() =>
    (settings.toolbar_quick_keys ?? []).slice(0, 5).map((key) => actionKeyToKeyDef(key))
  )

  return {
    row1,
    row2,
    row3,
    row4zxcv,
    arrowUp,
    arrowDown,
    arrowLeft,
    arrowRight,
    row5bottom,
    kbswitchAction,
    actionFirstRow,
    actionFollowingRows,
    actionBottom,
    actionBottomRows,
    actionEnter,
    pasteSupported,
    toolbarQuickKeyDefs,
    withActionFooterClass,
    mapActionFooterRow,
  }
}

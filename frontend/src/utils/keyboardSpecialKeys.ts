import { ArrowBigUp, ArrowRightToLine, Command, Option, X } from 'lucide-vue-next'
import ControlGlyphIcon from '../components/icons/ControlGlyphIcon.vue'
import WindowsFourPaneIcon from '../components/icons/WindowsFourPaneIcon.vue'

export type KeyboardSpecialId = 'ctrl' | 'shift' | 'alt' | 'opt' | 'cmd' | 'win' | 'tab' | 'esc'
export type KeyboardSpecialBehavior = 'once' | 'lock'
export type KeyboardModifierFamily = 'ctrl' | 'shift' | 'alt' | 'meta'

export type KeyboardSpecialEntry = {
  id: KeyboardSpecialId
  label: string
  icon: object
  modifier?: KeyboardModifierFamily
  send?: string
}

export const KEYBOARD_SPECIAL_KEYS: readonly KeyboardSpecialEntry[] = [
  { id: 'ctrl', label: 'Ctrl', icon: ControlGlyphIcon, modifier: 'ctrl' },
  { id: 'shift', label: 'Shift', icon: ArrowBigUp, modifier: 'shift' },
  { id: 'alt', label: 'Alt', icon: Option, modifier: 'alt' },
  { id: 'opt', label: 'Opt', icon: Option, modifier: 'alt' },
  { id: 'cmd', label: 'Cmd', icon: Command, modifier: 'meta' },
  { id: 'win', label: 'Win', icon: WindowsFourPaneIcon, modifier: 'meta' },
  { id: 'tab', label: 'Tab', icon: ArrowRightToLine, send: '\t' },
  { id: 'esc', label: 'Esc', icon: X, send: '\x1b' },
]

const specialById = new Map(KEYBOARD_SPECIAL_KEYS.map((entry) => [entry.id, entry]))

export function keyboardSpecialEntry(id: string | undefined): KeyboardSpecialEntry | undefined {
  return id ? specialById.get(id as KeyboardSpecialId) : undefined
}

export function parseKeyboardSpecial(value: string | undefined): {
  id: KeyboardSpecialId
  behavior: KeyboardSpecialBehavior
  entry: KeyboardSpecialEntry
} | null {
  if (!value) return null
  const locked = value.endsWith(':lock')
  const id = (locked ? value.slice(0, -5) : value) as KeyboardSpecialId
  const entry = keyboardSpecialEntry(id)
  if (!entry) return null
  return { id, behavior: locked && entry.modifier ? 'lock' : 'once', entry }
}

export function serializeKeyboardSpecial(
  id: KeyboardSpecialId,
  behavior: KeyboardSpecialBehavior
): string {
  const entry = keyboardSpecialEntry(id)
  return behavior === 'lock' && entry?.modifier ? `${id}:lock` : id
}

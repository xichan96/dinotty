import {
  defs,
  keyBindingDefs,
  terminalKeyBindingDefs,
  appKeyBindingDefs,
  keyEventMatchesBinding,
  type KeyBinding,
  type KeyBindingDef,
} from '../utils/keybindingCatalog'
import { settings } from './useSettings'

export { defs, keyBindingDefs, terminalKeyBindingDefs, appKeyBindingDefs, keyEventMatchesBinding }
export type { KeyBinding, KeyBindingDef }

export function useKeybindings() {
  function getBinding(id: string): KeyBinding {
    const def = defs.find((d) => d.id === id)
    if (!def) return { key: '', shift: false }
    return settings.keybindings[id] ?? def.defaultBinding
  }

  function formatBinding(binding: KeyBinding, kind: 'app' | 'terminal' = 'app'): string[] {
    if (kind === 'app') {
      const parts: string[] = ['⌘']
      if (binding.shift) parts.push('⇧')
      parts.push(binding.key.toUpperCase())
      return parts
    }

    const parts: string[] = []
    if (binding.meta) parts.push('⌘')
    if (binding.ctrl) parts.push('⌃')
    if (binding.alt) parts.push('⌥')
    if (binding.shift) parts.push('⇧')
    const keyLabels: Record<string, string> = {
      enter: '⏎',
      arrowleft: '←',
      arrowright: '->',
      backspace: '⌫',
    }
    parts.push(keyLabels[binding.key.toLowerCase()] ?? binding.key.toUpperCase())
    return parts
  }

  function isReadOnly(id: string): boolean {
    return defs.find((d) => d.id === id)?.readonly === true
  }

  function getAllWithDisplay() {
    return defs.map((def) => {
      const binding = getBinding(def.id)
      return {
        ...def,
        binding,
        display: formatBinding(binding, def.kind ?? 'app'),
      }
    })
  }

  /** Returns true if the key event matches an app-level shortcut (digits 0-9 for tab switch, or any app keybinding). Designed to be called only when virtualMeta is active. */
  function isAppShortcut(e: KeyboardEvent): boolean {
    if (!e.shiftKey && e.key >= '0' && e.key <= '9') return true

    for (const def of appKeyBindingDefs) {
      if (keyEventMatchesBinding(e, getBinding(def.id))) return true
    }
    return false
  }

  return { defs, getBinding, formatBinding, getAllWithDisplay, isReadOnly, isAppShortcut }
}

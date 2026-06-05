import { settings } from './useSettings'

export interface KeyBinding {
  key: string
  shift: boolean
}

export interface KeyBindingDef {
  id: string
  defaultBinding: KeyBinding
  icon: string
  titleKey: string
}

const defs: KeyBindingDef[] = [
  { id: 'togglePalette', defaultBinding: { key: 'k', shift: false }, icon: '⌘K', titleKey: 'keybinding.togglePalette' },
  { id: 'openBookmarks', defaultBinding: { key: 'b', shift: true }, icon: '★', titleKey: 'keybinding.openBookmarks' },
  { id: 'newTab', defaultBinding: { key: 't', shift: false }, icon: '＋', titleKey: 'keybinding.newTab' },
  { id: 'closeTab', defaultBinding: { key: 'w', shift: false }, icon: '✕', titleKey: 'keybinding.closeTab' },
]

export function useKeybindings() {
  function getBinding(id: string): KeyBinding {
    const def = defs.find(d => d.id === id)
    if (!def) return { key: '', shift: false }
    return settings.keybindings[id] ?? def.defaultBinding
  }

  function formatBinding(binding: KeyBinding): string[] {
    const parts: string[] = ['⌘']
    if (binding.shift) parts.push('⇧')
    parts.push(binding.key.toUpperCase())
    return parts
  }

  function getAllWithDisplay() {
    return defs.map(def => {
      const binding = getBinding(def.id)
      return {
        ...def,
        binding,
        display: formatBinding(binding),
      }
    })
  }

  return { defs, getBinding, formatBinding, getAllWithDisplay }
}

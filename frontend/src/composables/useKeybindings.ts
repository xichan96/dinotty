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
  readonly?: boolean
}

const defs: KeyBindingDef[] = [
  {
    id: 'togglePalette',
    defaultBinding: { key: 'k', shift: false },
    icon: '⌘K',
    titleKey: 'keybinding.togglePalette',
  },
  {
    id: 'openBookmarks',
    defaultBinding: { key: 'b', shift: true },
    icon: '★',
    titleKey: 'keybinding.openBookmarks',
  },
  {
    id: 'newTab',
    defaultBinding: { key: 't', shift: false },
    icon: '＋',
    titleKey: 'keybinding.newTab',
  },
  {
    id: 'closeTab',
    defaultBinding: { key: 'w', shift: false },
    icon: '✕',
    titleKey: 'keybinding.closeTab',
  },
  {
    id: 'splitHorizontal',
    defaultBinding: { key: 'd', shift: false },
    icon: '⊞',
    titleKey: 'keybinding.splitHorizontal',
  },
  {
    id: 'splitVertical',
    defaultBinding: { key: 'd', shift: true },
    icon: '⊟',
    titleKey: 'keybinding.splitVertical',
  },
  {
    id: 'toggleBroadcast',
    defaultBinding: { key: 'i', shift: true },
    icon: '⬤',
    titleKey: 'keybinding.toggleBroadcast',
  },
  {
    id: 'toggleZoom',
    defaultBinding: { key: 'Enter', shift: true },
    icon: '⤢',
    titleKey: 'keybinding.toggleZoom',
  },
  {
    id: 'equalizePanes',
    defaultBinding: { key: '=', shift: false },
    icon: '⊞',
    titleKey: 'keybinding.equalizePanes',
  },
  {
    id: 'focusNextPane',
    defaultBinding: { key: ']', shift: false },
    icon: '→',
    titleKey: 'keybinding.focusNextPane',
  },
  {
    id: 'focusPrevPane',
    defaultBinding: { key: '[', shift: false },
    icon: '←',
    titleKey: 'keybinding.focusPrevPane',
  },
  {
    id: 'searchTerminal',
    defaultBinding: { key: 'f', shift: false },
    icon: '🔍',
    titleKey: 'keybinding.searchTerminal',
  },
  {
    id: 'switchTab',
    defaultBinding: { key: '1', shift: false },
    icon: '⌨',
    titleKey: 'keybinding.switchTab',
    readonly: true,
  },
  {
    id: 'missionControl',
    defaultBinding: { key: 'e', shift: true },
    icon: '⊞',
    titleKey: 'keybinding.missionControl',
  },
]

export function useKeybindings() {
  function getBinding(id: string): KeyBinding {
    const def = defs.find((d) => d.id === id)
    if (!def) return { key: '', shift: false }
    return settings.keybindings[id] ?? def.defaultBinding
  }

  function formatBinding(binding: KeyBinding): string[] {
    const parts: string[] = ['⌘']
    if (binding.shift) parts.push('⇧')
    parts.push(binding.key.toUpperCase())
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
        display: formatBinding(binding),
      }
    })
  }

  return { defs, getBinding, formatBinding, getAllWithDisplay, isReadOnly }
}

import { settings } from './useSettings'
import {
  Command,
  Star,
  Plus,
  X,
  Columns2,
  Columns3,
  Rows2,
  Radio,
  Maximize2,
  ChevronRight,
  ChevronLeft,
  Search,
  SquareStack,
  LayoutDashboard,
  Bell,
  Globe,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  CornerDownLeft,
  ArrowLeftToLine,
  ArrowRightToLine,
  Delete,
} from 'lucide-vue-next'

export interface KeyBinding {
  key: string
  shift: boolean
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
}

export interface KeyBindingDef {
  id: string
  defaultBinding: KeyBinding
  icon: object
  titleKey: string
  readonly?: boolean
  kind?: 'app' | 'terminal'
  sequence?: string
}

export const defs: KeyBindingDef[] = [
  {
    id: 'togglePalette',
    defaultBinding: { key: 'k', shift: false },
    icon: Command,
    titleKey: 'keybinding.togglePalette',
  },
  {
    id: 'openBookmarks',
    defaultBinding: { key: 'b', shift: true },
    icon: Star,
    titleKey: 'keybinding.openBookmarks',
  },
  {
    id: 'newTab',
    defaultBinding: { key: 't', shift: false },
    icon: Plus,
    titleKey: 'keybinding.newTab',
  },
  {
    id: 'closeTab',
    defaultBinding: { key: 'w', shift: false },
    icon: X,
    titleKey: 'keybinding.closeTab',
  },
  {
    id: 'splitHorizontal',
    defaultBinding: { key: 'd', shift: false },
    icon: Columns2,
    titleKey: 'keybinding.splitHorizontal',
  },
  {
    id: 'splitVertical',
    defaultBinding: { key: 'd', shift: true },
    icon: Rows2,
    titleKey: 'keybinding.splitVertical',
  },
  {
    id: 'toggleBroadcast',
    defaultBinding: { key: 'i', shift: true },
    icon: Radio,
    titleKey: 'keybinding.toggleBroadcast',
  },
  {
    id: 'toggleZoom',
    defaultBinding: { key: 'Enter', shift: true },
    icon: Maximize2,
    titleKey: 'keybinding.toggleZoom',
  },
  {
    id: 'equalizePanes',
    defaultBinding: { key: '=', shift: false },
    icon: Columns3,
    titleKey: 'keybinding.equalizePanes',
  },
  {
    id: 'focusNextPane',
    defaultBinding: { key: ']', shift: false },
    icon: ChevronRight,
    titleKey: 'keybinding.focusNextPane',
  },
  {
    id: 'focusPrevPane',
    defaultBinding: { key: '[', shift: false },
    icon: ChevronLeft,
    titleKey: 'keybinding.focusPrevPane',
  },
  {
    id: 'searchTerminal',
    defaultBinding: { key: 'f', shift: false },
    icon: Search,
    titleKey: 'keybinding.searchTerminal',
  },
  {
    id: 'switchTab',
    defaultBinding: { key: '1', shift: false },
    icon: SquareStack,
    titleKey: 'keybinding.switchTab',
    readonly: true,
  },
  {
    id: 'missionControl',
    defaultBinding: { key: 'm', shift: true },
    icon: LayoutDashboard,
    titleKey: 'keybinding.missionControl',
  },
  {
    id: 'superviseTabs',
    defaultBinding: { key: '`', shift: false },
    icon: Bell,
    titleKey: 'keybinding.superviseTabs',
  },
  {
    id: 'sshConnect',
    defaultBinding: { key: 'n', shift: true },
    icon: Globe,
    titleKey: 'keybinding.sshConnect',
  },
  {
    id: 'fontSizeUp',
    defaultBinding: { key: '=', shift: true },
    icon: ArrowUp,
    titleKey: 'keybinding.fontSizeUp',
  },
  {
    id: 'fontSizeDown',
    defaultBinding: { key: '-', shift: false },
    icon: ArrowDown,
    titleKey: 'keybinding.fontSizeDown',
  },
  {
    id: 'fontSizeReset',
    defaultBinding: { key: '0', shift: false },
    icon: RotateCcw,
    titleKey: 'keybinding.fontSizeReset',
  },
  {
    id: 'term.newline',
    defaultBinding: { key: 'enter', shift: true, meta: false },
    icon: CornerDownLeft,
    titleKey: 'keybinding.term.newline',
    kind: 'terminal',
    sequence: '\x1b\r',
  },
  {
    id: 'term.lineStart',
    defaultBinding: { key: 'arrowleft', shift: false, meta: true },
    icon: ArrowLeftToLine,
    titleKey: 'keybinding.term.lineStart',
    kind: 'terminal',
    sequence: '\x01',
  },
  {
    id: 'term.lineEnd',
    defaultBinding: { key: 'arrowright', shift: false, meta: true },
    icon: ArrowRightToLine,
    titleKey: 'keybinding.term.lineEnd',
    kind: 'terminal',
    sequence: '\x05',
  },
  {
    id: 'term.deleteToLineStart',
    defaultBinding: { key: 'backspace', shift: false, meta: true },
    icon: Delete,
    titleKey: 'keybinding.term.deleteToLineStart',
    kind: 'terminal',
    sequence: '\x15',
  },
]

export const keyBindingDefs = defs
export const terminalKeyBindingDefs = defs.filter((def) => def.kind === 'terminal')
export const appKeyBindingDefs = defs.filter((def) => def.kind !== 'terminal')

export function keyEventMatchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  if (binding.key.length === 1) {
    // Single-char keys: prefer e.code (physical key) to handle Shift correctly.
    // e.key reports the produced char ('+' for Shift+=), but binding stores '='.
    const codeToKey: Record<string, string> = {
      Equal: '=', Minus: '-',
      BracketLeft: '[', BracketRight: ']', Backslash: '\\',
      Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
      Backquote: '`',
    }
    let physicalKey = ''
    if (e.code.startsWith('Key')) physicalKey = e.code.slice(3).toLowerCase()
    else if (e.code.startsWith('Digit')) physicalKey = e.code.slice(5)
    else physicalKey = codeToKey[e.code] ?? ''
    return physicalKey === binding.key.toLowerCase()
      ? e.shiftKey === binding.shift
      : e.key.toLowerCase() === binding.key.toLowerCase() && e.shiftKey === binding.shift
  }
  return e.key === binding.key && e.shiftKey === binding.shift
}

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

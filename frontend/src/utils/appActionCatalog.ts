import type { Component } from 'vue'
import {
  ClipboardPaste,
  FolderOpen,
  History,
  LayoutGrid,
  SquareTerminal,
  Upload,
} from 'lucide-vue-next'
import { defs, type KeyBindingDef } from '../composables/useKeybindings'

export interface AppActionDef {
  id: string
  labelKey: string
  icon: Component
}

type TerminalSequenceDef = KeyBindingDef & { kind: 'terminal'; sequence: string }

const terminalSequenceDefs = defs.filter(
  (def): def is TerminalSequenceDef => def.kind === 'terminal' && typeof def.sequence === 'string'
)

export const APP_ACTIONS: readonly AppActionDef[] = [
  ...defs
    .filter((def) => def.kind !== 'terminal' && def.readonly !== true)
    .map((def) => ({ id: def.id, labelKey: def.titleKey, icon: def.icon as Component })),
  { id: 'pasteTerminal', labelKey: 'mobileKb.pasteTerminal', icon: ClipboardPaste },
  { id: 'insertWorkspaceFile', labelKey: 'mobileKb.insertMacFile', icon: FolderOpen },
  { id: 'uploadMobileFile', labelKey: 'mobileKb.insertPhoneFile', icon: Upload },
  ...terminalSequenceDefs.map((def) => ({
    id: def.id,
    labelKey: def.titleKey,
    icon: def.icon as Component,
  })),
]

export const APP_ACTION_IDS: ReadonlySet<string> = new Set(APP_ACTIONS.map(({ id }) => id))
export const SYSTEM_KEYBOARD_ACTIONS: readonly AppActionDef[] = [
  { id: 'system.history', labelKey: 'systemKb.history', icon: History },
  { id: 'system.extended', labelKey: 'systemKb.terminalKeys', icon: LayoutGrid },
  { id: 'system.actions', labelKey: 'systemKb.actions', icon: SquareTerminal },
]
export const SYSTEM_KEYBOARD_ACTION_IDS: ReadonlySet<string> = new Set(
  SYSTEM_KEYBOARD_ACTIONS.map(({ id }) => id)
)
export const TOOLBAR_CONTEXT_ACTION_IDS: ReadonlySet<string> = new Set([
  'insertWorkspaceFile',
  'uploadMobileFile',
])

export function isDispatchableAppAction(id: string): boolean {
  return APP_ACTION_IDS.has(id)
}

export function getAppAction(id: string): AppActionDef | undefined {
  return (
    APP_ACTIONS.find((action) => action.id === id) ??
    SYSTEM_KEYBOARD_ACTIONS.find((action) => action.id === id)
  )
}

export function getTerminalSequenceAppAction(id: string): TerminalSequenceDef | undefined {
  return terminalSequenceDefs.find((def) => def.id === id)
}

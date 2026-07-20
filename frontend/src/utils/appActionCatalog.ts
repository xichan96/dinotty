import type { Component } from 'vue'
import { defs } from '../composables/useKeybindings'

export interface AppActionDef {
  id: string
  labelKey: string
  icon: Component
}

export const APP_ACTIONS: readonly AppActionDef[] = defs
  .filter((def) => def.kind !== 'terminal' && def.readonly !== true)
  .map((def) => ({ id: def.id, labelKey: def.titleKey, icon: def.icon as Component }))

export const APP_ACTION_IDS: ReadonlySet<string> = new Set(APP_ACTIONS.map(({ id }) => id))

export function getAppAction(id: string): AppActionDef | undefined {
  return APP_ACTIONS.find((action) => action.id === id)
}

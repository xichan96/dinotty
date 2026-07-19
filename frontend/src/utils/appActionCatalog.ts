import type { Component } from 'vue'
import { Columns2, Command, Grid2x2, Plus, Radar, Rows2, Server, X } from 'lucide-vue-next'

export interface AppActionDef {
  id: string
  labelKey: string
  icon: Component
}

export const APP_ACTIONS: readonly AppActionDef[] = [
  { id: 'newTab', labelKey: 'actionKb.app.newTab', icon: Plus },
  { id: 'closeTab', labelKey: 'actionKb.app.closeTab', icon: X },
  { id: 'splitHorizontal', labelKey: 'actionKb.app.splitLeftRight', icon: Columns2 },
  { id: 'splitVertical', labelKey: 'actionKb.app.splitTopBottom', icon: Rows2 },
  { id: 'equalizePanes', labelKey: 'actionKb.app.equalizePanes', icon: Grid2x2 },
  { id: 'togglePalette', labelKey: 'actionKb.app.togglePalette', icon: Command },
  { id: 'superviseTabs', labelKey: 'actionKb.app.superviseTabs', icon: Radar },
  { id: 'sshConnect', labelKey: 'actionKb.app.sshConnect', icon: Server },
]

export const APP_ACTION_IDS: ReadonlySet<string> = new Set(APP_ACTIONS.map(({ id }) => id))

export function getAppAction(id: string): AppActionDef | undefined {
  return APP_ACTIONS.find((action) => action.id === id)
}

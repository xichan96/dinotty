export interface KeyDef {
  l: string // label
  s?: string // send character
  act?: string // app action id
  sl?: string // shift label
  sp?: string // special action
  g?: number // flex-grow
  cls?: string // extra CSS class
  id?: string // DOM id
  repeat?: boolean // key repeat
  icon?: object // lucide icon component
  aria?: string // accessible name
  disabled?: boolean // render as inert (unsupported action, etc.)
  autoEnter?: boolean // per-key option for app actions that support it
}

export interface AppActionOptions {
  autoEnter?: boolean
}

export interface ModState {
  shift: boolean
  ctrl: boolean
  alt: boolean
}

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
}

export interface ModState {
  shift: boolean
  ctrl: boolean
  alt: boolean
}

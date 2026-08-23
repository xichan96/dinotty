declare module '*builtin-keyboard/main.js' {
  import type { Component } from 'vue'
  import type { KeyboardContribution } from '../../../plugin-api/index'
  export function activate(): { keyboard: KeyboardContribution }
  export const MobileKeyboard: Component
}

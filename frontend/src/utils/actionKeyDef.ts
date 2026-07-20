import type { ActionKey } from '../composables/useSettings'
import type { KeyDef } from '../components/keyboard/mkbTypes'
import { Bookmark } from 'lucide-vue-next'
import { useI18n } from '../composables/useI18n'
import { getAppAction } from './appActionCatalog'

const { t } = useI18n()

export function normalizeCaretSend(send: string): string {
  if (send.length !== 2 || send[0] !== '^') return send
  const x = send[1]
  const u = x.toUpperCase()
  if (u >= 'A' && u <= 'Z') return String.fromCharCode(u.charCodeAt(0) - 64)
  if (x === '[') return '\x1b'
  if (x === '\\') return '\x1c'
  if (x === ']') return '\x1d'
  if (x === '^') return '\x1e'
  if (x === '_') return '\x1f'
  if (x === '?') return '\x7f'
  if (x === '@') return '\x00'
  return send
}

export function actionKeyToKeyDef(ak: ActionKey, opts?: { bottomIdx?: number }): KeyDef {
  const bottom = opts?.bottomIdx !== undefined
  const danger = ak.style === 'danger'
  const cls = danger ? 'mkb-mod mkb-action-danger' : 'mkb-mod'

  if (ak.kind === 'action') {
    const action = ak.action ? getAppAction(ak.action) : undefined
    const def: KeyDef = action
      ? ak.display === 'text'
        ? { l: ak.label || '', act: action.id, cls }
        : { l: '', act: action.id, cls, icon: action.icon, aria: t(action.labelKey) }
      : {
          l: ak.action ? `${t('actionKb.unsupported')}: ${ak.action}` : t('actionKb.unsupported'),
          cls: `${cls} mkb-disabled`,
        }
    if (ak.grow != null && ak.grow > 0) def.g = ak.grow
    return def
  }

  if (ak.special === 'space') {
    const def: KeyDef = {
      l: '',
      s: ' ',
      cls: 'mkb-mod',
      id: bottom ? 'mkb-space2' : undefined,
    }
    if (ak.grow != null && ak.grow > 0) def.g = ak.grow
    return def
  }

  if (ak.special === 'bookmarks') {
    return {
      l: '',
      sp: 'bookmarks',
      cls: 'mkb-mod',
      icon: Bookmark,
    }
  }

  const def: KeyDef = {
    l: ak.label || '',
    cls,
    repeat: ak.repeat,
    icon: ak.icon as any,
  }

  const sp = ak.special && ak.special !== 'space' ? ak.special : undefined
  if (sp) {
    def.sp = sp
    if (bottom) {
      if (sp === 'ctrl' && opts!.bottomIdx === 0) def.id = 'mkb-ctrl2'
      if (sp === 'alt' && opts!.bottomIdx === 1) def.id = 'mkb-alt2'
    }
    if (!ak.send) return def
  }

  let sendNorm = normalizeCaretSend(ak.send ?? '')
  const isControlChar = sendNorm.length === 1 && sendNorm.charCodeAt(0) < 32
  if (ak.auto_enter && sendNorm !== '' && !isControlChar) sendNorm += '\r'
  if (sendNorm !== '') {
    def.s = sendNorm
  }

  if (bottom && !def.id && def.l === '' && def.s === ' ') {
    def.id = 'mkb-space2'
  }

  if (ak.grow != null && ak.grow > 0) def.g = ak.grow

  return def
}

export function mapActionKeys(keys: ActionKey[], bottom: boolean): KeyDef[] {
  return keys.map((ak, i) => actionKeyToKeyDef(ak, bottom ? { bottomIdx: i } : undefined))
}

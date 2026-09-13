import { activeServerId } from './activeServer'

/**
 * Namespace a localStorage key by the active server, so that per-server state
 * (tabs, and anything added later) does not leak across a server switch.
 */
export function scopedKey(base: string): string {
  return `${base}@${activeServerId()}`
}

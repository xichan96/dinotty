/**
 * Reveal targets for files panes that are still being created.
 *
 * A newly inserted files pane boots from its `path` leaf field, but the leaf
 * schema (frontend + Rust) has no line/column. Terminal path clicks therefore
 * stash the position here and the pane consumes it once boot finishes.
 * Deliberately in-memory: a restored tab should not jump to a stale line.
 */
export interface PendingFileReveal {
  path: string
  line?: number
  column?: number
}

const pending = new Map<string, PendingFileReveal>()

export function setPendingFileReveal(paneId: string, reveal: PendingFileReveal): void {
  pending.set(paneId, reveal)
}

export function takePendingFileReveal(paneId: string): PendingFileReveal | null {
  const reveal = pending.get(paneId)
  if (!reveal) return null
  pending.delete(paneId)
  return reveal
}

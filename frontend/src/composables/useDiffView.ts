import { computed, ref, type ComputedRef } from 'vue'
import type { DiffTarget } from '../types/workspaceChanges'

/**
 * Per-editor-leaf diff targets, keyed by leaf id.
 *
 * The changes list sets a target when a row is opened; EditorPane renders the
 * diff for its own leaf when the target still matches the active tab. Keeping
 * this out of `EditorLeafPane` avoids persisting ephemeral view state and
 * avoids adding a diff variant to `EditorTab` (which is keyed on filePath in
 * drag, history and watcher code).
 */
const targets = ref<Record<string, DiffTarget | null>>({})
const epoch = ref(0)

export function setDiffTarget(leafId: string, target: DiffTarget | null): void {
  if (!target) {
    clearDiffTarget(leafId)
    return
  }
  targets.value = { ...targets.value, [leafId]: target }
}

export function clearDiffTarget(leafId: string): void {
  if (!(leafId in targets.value)) return
  const next = { ...targets.value }
  delete next[leafId]
  targets.value = next
}

/** Reactive target for one leaf; call inside a component setup. */
export function useDiffTarget(leafId: () => string): ComputedRef<DiffTarget | null> {
  return computed(() => targets.value[leafId()] ?? null)
}

/**
 * Bumped whenever the workspace refreshes its git view. The open diff viewer
 * watches this to re-fetch changed files without owning the tree watcher.
 */
export function bumpDiffEpoch(): void {
  epoch.value += 1
}

export function useDiffEpoch(): ComputedRef<number> {
  return computed(() => epoch.value)
}

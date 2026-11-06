import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { useEditorSplit } from './useEditorSplit'
import { bumpDiffEpoch, setDiffTarget } from './useDiffView'
import { useWorkspaceChanges } from './useWorkspaceChanges'
import { loadFileWorkspaceLeftView, type FileWorkspaceLeftView } from './useFileWorkspaceState'
import { countStagedChanges, groupChangesByDirectory } from '../utils/changeGroups'
import type { WorkspaceChangeFile } from '../types/workspaceChanges'

type Translate = (key: string, params?: Record<string, string | number>) => string

export interface UseChangesViewOptions {
  paneId: () => string
  editorSplit: ReturnType<typeof useEditorSplit>
  cwdLabel: Ref<string>
  t: Translate
  /** Opens a tab without touching nav history or recent files. */
  openFromChanges: (rel: string) => Promise<void> | void
  /** Search is a tree sub-view; opening it returns the pane to Files. */
  searchOpen: Ref<boolean>
  closeSearch: () => void
  /** Tree git badges drive the mode badge without an extra request. */
  gitStatusMap: Ref<Record<string, string>>
  /** Manual refresh in Files mode (the boot composable's reload). */
  reloadTree: () => Promise<void> | void
}

/**
 * State and actions for the files pane's "Changes" list.
 *
 * The list is deliberately read-only: opening a row creates a preview tab in
 * the active editor leaf and hands `useDiffView` a target for that leaf. All
 * fetching/polling lives in `useWorkspaceChanges`; this composable only owns
 * the view toggle, selection and the diff hand-off.
 */
export function useChangesView(opts: UseChangesViewOptions) {
  const leftView = ref<FileWorkspaceLeftView>('tree')
  const selectedPath = ref<string | null>(null)

  const changes = useWorkspaceChanges({
    paneId: opts.paneId,
    isActive: () => leftView.value === 'changes',
  })

  /** Header mode; the search panel replaces the segmented control. */
  const headerMode = computed<'tree' | 'changes' | 'search'>(() =>
    opts.searchOpen.value ? 'search' : leftView.value
  )
  const changeCount = computed(() => Object.keys(opts.gitStatusMap.value).length)

  const groups = computed(() => groupChangesByDirectory(changes.data.value?.files ?? []))
  const flatFiles = computed(() => groups.value.flatMap((group) => group.files))
  const stagedCount = computed(() => countStagedChanges(flatFiles.value))
  const selectedFile = computed(
    () => flatFiles.value.find((file) => file.path === selectedPath.value) ?? null
  )

  /** True when git reported a root different from the pane cwd, e.g. a repo
   *  opened from a subdirectory. */
  const rootHint = computed(() => {
    const root = changes.data.value?.repo_root
    const cwd = opts.cwdLabel.value
    if (!root || !cwd) return null
    const norm = (p: string) => p.replace(/[/\\]+$/, '')
    if (norm(root) === norm(cwd)) return null
    return opts.t('workspaceChanges.rootHint', { cwd, root })
  })

  function setView(view: FileWorkspaceLeftView): void {
    if (leftView.value === view) return
    leftView.value = view
    // Entering Changes always revalidates: a tree-mode refresh intentionally
    // skips the (inactive) changes request, so the cached list could be stale.
    if (view === 'changes') void changes.load()
  }

  function switchToFiles(): void {
    opts.closeSearch()
    setView('tree')
  }

  function switchToChanges(): void {
    opts.closeSearch()
    setView('changes')
  }

  /** Manual refresh: the tree, the changes list and open diffs all restamp. */
  async function manualReloadAll(): Promise<void> {
    await opts.reloadTree()
    bumpDiffEpoch()
    changes.scheduleRefresh(0)
  }

  function onHeaderRefresh(): void {
    if (leftView.value === 'changes') refresh()
    else void manualReloadAll()
  }

  /** Re-read the pane's persisted view. Called after boot restores it. */
  function restore(): void {
    changes.reset()
    selectedPath.value = null
    leftView.value = loadFileWorkspaceLeftView(opts.paneId())
    if (leftView.value === 'changes') changes.ensureLoaded()
  }

  /** Manual refresh (header button): refetch and tell open diffs to reload. */
  function refresh(): void {
    bumpDiffEpoch()
    void changes.load()
  }

  /** Debounced refresh for watcher/focus sources. */
  function scheduleRefresh(delay?: number): void {
    changes.scheduleRefresh(delay)
  }

  async function openChange(file: WorkspaceChangeFile): Promise<void> {
    selectedPath.value = file.path
    await opts.openFromChanges(file.path)
    let leafId = opts.editorSplit.activeEditorLeafId.value
    if (!leafId) {
      await nextTick()
      leafId = opts.editorSplit.activeEditorLeafId.value
    }
    if (!leafId) return
    setDiffTarget(leafId, {
      path: file.path,
      origPath: file.orig_path,
      status: file.status,
      conflicted: file.conflicted,
      additions: file.additions,
      deletions: file.deletions,
    })
  }

  /** Arrow-key navigation; clamps at the ends instead of wrapping. */
  function moveSelection(delta: number): void {
    const files = flatFiles.value
    if (!files.length) return
    const current = files.findIndex((file) => file.path === selectedPath.value)
    const next = current < 0 ? (delta > 0 ? 0 : files.length - 1) : current + delta
    selectedPath.value = files[Math.min(files.length - 1, Math.max(0, next))].path
  }

  function openSelected(): void {
    if (selectedFile.value) void openChange(selectedFile.value)
  }

  // A refresh can delete the selected row; keep the highlight valid so Enter
  // never opens a stale entry.
  watch(flatFiles, (files) => {
    if (!selectedPath.value) return
    if (!files.some((file) => file.path === selectedPath.value)) selectedPath.value = null
  })

  // Any path that opens search (button or ⇧⌘F) is a Files sub-view.
  watch(
    () => opts.searchOpen.value,
    (open) => {
      if (open) setView('tree')
    }
  )

  return {
    // Expose the fetch refs alongside the view state so the pane can bind
    // `state`/`data`/`error`/`loading` directly.
    ...changes,
    leftView,
    headerMode,
    changeCount,
    changes,
    groups,
    flatFiles,
    stagedCount,
    selectedPath,
    selectedFile,
    rootHint,
    setView,
    restore,
    refresh,
    scheduleRefresh,
    openChange,
    moveSelection,
    openSelected,
    switchToFiles,
    switchToChanges,
    onHeaderRefresh,
  }
}

import { nextTick, ref, type Ref } from 'vue'
import type FileSearchPanel from '../components/workspace/FileSearchPanel.vue'
import type { FileWorkspaceLayout } from './useFileWorkspaceLayout'

export interface UseFileWorkspaceSearchOptions {
  visible: () => boolean
  treeCollapsed: Ref<boolean>
  layout: FileWorkspaceLayout
  treeWrapRef: Ref<HTMLElement | null>
  bodyRef: Ref<HTMLElement | null>
  ensureParentsExpanded: (rel: string) => Promise<void>
  selectFile: (rel: string) => Promise<void>
  scrollSelectedIntoView: () => Promise<void>
}

/**
 * Search panel visibility, reveal target and the ⇧⌘F shortcut. Kept apart
 * from the explorer so the preview component only wires the panel.
 */
export function useFileWorkspaceSearch(opts: UseFileWorkspaceSearchOptions) {
  const searchOpen = ref(false)
  const searchPanelRef = ref<InstanceType<typeof FileSearchPanel> | null>(null)
  /** Search result target; a fresh object (and seq) re-triggers the reveal. */
  const searchReveal = ref<{ path: string; line: number; seq: number } | null>(null)
  let revealSeq = 0

  function openSearch(focus: boolean) {
    searchOpen.value = true
    if (opts.treeCollapsed.value) opts.treeCollapsed.value = false
    if (opts.layout.narrow.value && !opts.layout.drawerOpen.value) opts.layout.openDrawer()
    void nextTick(() => {
      // The tree may have been scrolled to reveal a row; the sticky header
      // would otherwise cover the search box that replaces it.
      if (opts.treeWrapRef.value) opts.treeWrapRef.value.scrollTop = 0
      if (focus) searchPanelRef.value?.focusInput()
    })
  }

  function closeSearch() {
    searchOpen.value = false
  }

  async function onSearchOpenFile(rel: string, line: number) {
    await opts.ensureParentsExpanded(rel)
    await opts.selectFile(rel)
    searchReveal.value = { path: rel, line, seq: ++revealSeq }
    void nextTick(() => opts.scrollSelectedIntoView())
  }

  function hasFocus(): boolean {
    const active = document.activeElement
    return !!active && !!opts.bodyRef.value?.contains(active)
  }

  function onKeydown(event: KeyboardEvent) {
    if (!opts.visible()) return
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
      if (!hasFocus()) return
      event.preventDefault()
      openSearch(true)
      return
    }
    if (event.key === 'Escape' && searchOpen.value) {
      event.preventDefault()
      closeSearch()
    }
  }

  return {
    searchOpen,
    searchPanelRef,
    searchReveal,
    openSearch,
    closeSearch,
    onSearchOpenFile,
    onWorkspaceSearchKeydown: onKeydown,
  }
}

import type { Ref } from 'vue'

/** One visible tree row, in DOM (flattened) order. */
export interface TreeRowInfo {
  rel: string
  isDir: boolean
}

export interface TreeKeyInput {
  key: string
  rows: readonly TreeRowInfo[]
  currentRel: string | null
  expanded: ReadonlySet<string>
  isMac: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

export type TreeKeyIntent =
  | { type: 'focus'; rel: string }
  | { type: 'toggle'; rel: string }
  | { type: 'open'; rel: string }
  | { type: 'rename'; rel: string; isDir: boolean }
  | { type: 'delete'; rel: string; isDir: boolean }
  | { type: 'menu'; rel: string; isDir: boolean }

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform || ''
  const ua = navigator.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(platform) || /mac os x|iphone|ipad/i.test(ua)
}

/** Keyboard hint shown next to the delete action. */
export function deleteShortcutLabel(isMac: boolean): string {
  return isMac ? '⌘⌫' : 'Del'
}

function parentRel(rel: string): string {
  const cut = rel.lastIndexOf('/')
  return cut < 0 ? '' : rel.slice(0, cut)
}

/**
 * Map a keydown on the tree to one intent. Pure so the mapping is testable
 * without a DOM; the caller resolves rows/focus and applies the intent.
 */
export function resolveTreeKey(input: TreeKeyInput): TreeKeyIntent | null {
  const { rows, expanded, key } = input
  // Ctrl/Alt combinations belong to the app or the OS, not to row navigation.
  // (Meta is included except where a shortcut explicitly uses it.)
  const modified = !!input.ctrlKey || !!input.metaKey || !!input.altKey
  const index = input.currentRel ? rows.findIndex((row) => row.rel === input.currentRel) : -1
  const row = index >= 0 ? rows[index] : null

  const focusAt = (i: number): TreeKeyIntent | null => {
    if (!rows.length) return null
    const clamped = Math.max(0, Math.min(i, rows.length - 1))
    return { type: 'focus', rel: rows[clamped].rel }
  }

  // Navigation works even before a row is focused: down/up start at the
  // first/last row respectively.
  switch (key) {
    case 'ArrowDown':
      if (modified) return null
      return focusAt(index < 0 ? 0 : index + 1)
    case 'ArrowUp':
      if (modified) return null
      return focusAt(index < 0 ? rows.length - 1 : index - 1)
    case 'Home':
      if (modified) return null
      return focusAt(0)
    case 'End':
      if (modified) return null
      return focusAt(rows.length - 1)
  }

  if (!row) return null

  switch (key) {
    case 'ArrowRight': {
      if (modified || !row.isDir) return null
      if (!expanded.has(row.rel)) return { type: 'toggle', rel: row.rel }
      const child = rows[index + 1]
      if (child && child.rel.startsWith(`${row.rel}/`)) return { type: 'focus', rel: child.rel }
      return null
    }
    case 'ArrowLeft': {
      if (modified) return null
      if (row.isDir && expanded.has(row.rel)) return { type: 'toggle', rel: row.rel }
      const parent = parentRel(row.rel)
      if (!parent || !rows.some((candidate) => candidate.rel === parent)) return null
      return { type: 'focus', rel: parent }
    }
    case 'Enter':
    case ' ':
    case 'Spacebar':
      if (modified) return null
      return row.isDir ? { type: 'toggle', rel: row.rel } : { type: 'open', rel: row.rel }
    case 'F2':
      if (modified) return null
      return { type: 'rename', rel: row.rel, isDir: row.isDir }
    case 'Delete':
      if (input.ctrlKey || input.altKey) return null
      return { type: 'delete', rel: row.rel, isDir: row.isDir }
    case 'Backspace':
      // macOS has no real Delete key on laptop keyboards: ⌘⌫ is the gesture.
      if (!(input.isMac && input.metaKey) || input.ctrlKey || input.altKey) return null
      return { type: 'delete', rel: row.rel, isDir: row.isDir }
    case 'ContextMenu':
      if (modified) return null
      return { type: 'menu', rel: row.rel, isDir: row.isDir }
    case 'F10':
      if (!input.shiftKey || modified) return null
      return { type: 'menu', rel: row.rel, isDir: row.isDir }
  }
  return null
}

export interface UseTreeKeyboardOptions {
  container: Ref<HTMLElement | null>
  expanded: Ref<Set<string>>
  selectedRel: Ref<string | null>
  onToggle: (rel: string) => void
  onOpen: (rel: string) => void
  onRename: (rel: string, isDir: boolean) => void
  onDelete: (rel: string, isDir: boolean) => void
  onMenu: (rel: string, isDir: boolean, x: number, y: number) => void
  isMac?: boolean
}

/**
 * Keyboard navigation for the file tree. All listeners attach to the tree
 * container; rows never handle keys themselves, and keys typed into inputs,
 * menus or buttons are left alone.
 */
export function useTreeKeyboard(opts: UseTreeKeyboardOptions) {
  const isMac = opts.isMac ?? isMacPlatform()

  function rowElements(): HTMLElement[] {
    const root = opts.container.value
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('.tree-row[data-rel]'))
  }

  function visibleRows(): TreeRowInfo[] {
    return rowElements().map((el) => ({
      rel: el.dataset.rel || '',
      isDir: el.classList.contains('dir'),
    }))
  }

  function rowElement(rel: string): HTMLElement | null {
    return rowElements().find((el) => el.dataset.rel === rel) ?? null
  }

  function focusRow(rel: string) {
    const el = rowElement(rel)
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'nearest' })
  }

  /** The row that owns the current focus (including focus on a twistie). */
  function currentRel(): string | null {
    const active = document.activeElement
    if (active instanceof HTMLElement) {
      const row = active.closest<HTMLElement>('.tree-row[data-rel]')
      if (row) return row.dataset.rel || null
    }
    return opts.selectedRel.value
  }

  function isTypingTarget(target: HTMLElement | null): boolean {
    if (!target) return false
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (target.isContentEditable) return true
    // Enter/Space/arrows on a row button keep their native button behaviour.
    return !!target.closest('button, [role="menu"], [role="menuitem"]')
  }

  function onTreeKeydown(ev: KeyboardEvent) {
    if (isTypingTarget(ev.target as HTMLElement | null)) return
    const intent = resolveTreeKey({
      key: ev.key,
      rows: visibleRows(),
      currentRel: currentRel(),
      expanded: opts.expanded.value,
      isMac,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      altKey: ev.altKey,
      shiftKey: ev.shiftKey,
    })
    if (!intent) return
    ev.preventDefault()
    ev.stopPropagation()
    switch (intent.type) {
      case 'focus':
        focusRow(intent.rel)
        break
      case 'toggle':
        opts.onToggle(intent.rel)
        break
      case 'open':
        opts.onOpen(intent.rel)
        break
      case 'rename':
        opts.onRename(intent.rel, intent.isDir)
        break
      case 'delete':
        opts.onDelete(intent.rel, intent.isDir)
        break
      case 'menu': {
        // Anchor the menu to the row's bottom edge, not the pointer.
        const rect = rowElement(intent.rel)?.getBoundingClientRect()
        opts.onMenu(intent.rel, intent.isDir, rect ? rect.left + 24 : 0, rect ? rect.bottom : 0)
        break
      }
    }
  }

  /** Pointer interaction moves focus onto the hit row so the next key acts
   *  on what was clicked. It does not preventDefault: twistie/swipe buttons
   *  must still receive their click. */
  function onTreePointerDown(ev: PointerEvent) {
    const row = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.tree-row[data-rel]')
    if (row) row.focus({ preventScroll: true })
  }

  /** Tab lands on the container; hand focus to the selected or first row. */
  function onTreeFocus(ev: FocusEvent) {
    const host = opts.container.value
    if (!host || ev.target !== host) return
    const rows = visibleRows()
    if (!rows.length) return
    const selected = opts.selectedRel.value
    const target = selected && rows.some((row) => row.rel === selected) ? selected : rows[0].rel
    focusRow(target)
  }

  return {
    focusRow,
    onTreeKeydown,
    onTreePointerDown,
    onTreeFocus,
  }
}

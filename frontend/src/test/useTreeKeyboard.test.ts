import { describe, expect, it } from 'vitest'
import {
  deleteShortcutLabel,
  resolveTreeKey,
  type TreeKeyInput,
  type TreeRowInfo,
} from '../composables/useTreeKeyboard'

// Flattened DOM order of an expanded `src/`:
//   src/
//     a.ts
//     comp/
//       b.ts
// README.md
const rows: TreeRowInfo[] = [
  { rel: 'src', isDir: true },
  { rel: 'src/a.ts', isDir: false },
  { rel: 'src/comp', isDir: true },
  { rel: 'src/comp/b.ts', isDir: false },
  { rel: 'README.md', isDir: false },
]
const allExpanded = new Set(['src', 'src/comp'])

function key(overrides: Partial<TreeKeyInput>): TreeKeyInput {
  return {
    key: '',
    rows,
    currentRel: null,
    expanded: allExpanded,
    isMac: false,
    ...overrides,
  }
}

describe('resolveTreeKey — row movement', () => {
  it('moves down and up through visible rows', () => {
    expect(resolveTreeKey(key({ key: 'ArrowDown', currentRel: 'src' }))).toEqual({
      type: 'focus',
      rel: 'src/a.ts',
    })
    expect(resolveTreeKey(key({ key: 'ArrowUp', currentRel: 'src/a.ts' }))).toEqual({
      type: 'focus',
      rel: 'src',
    })
  })

  it('clamps at both ends', () => {
    expect(resolveTreeKey(key({ key: 'ArrowDown', currentRel: 'README.md' }))).toEqual({
      type: 'focus',
      rel: 'README.md',
    })
    expect(resolveTreeKey(key({ key: 'ArrowUp', currentRel: 'src' }))).toEqual({
      type: 'focus',
      rel: 'src',
    })
  })

  it('enters from either end when no row has focus yet', () => {
    expect(resolveTreeKey(key({ key: 'ArrowDown' }))).toEqual({ type: 'focus', rel: 'src' })
    expect(resolveTreeKey(key({ key: 'ArrowUp' }))).toEqual({
      type: 'focus',
      rel: 'README.md',
    })
  })

  it('jumps to the first and last row', () => {
    expect(resolveTreeKey(key({ key: 'Home', currentRel: 'src/comp/b.ts' }))).toEqual({
      type: 'focus',
      rel: 'src',
    })
    expect(resolveTreeKey(key({ key: 'End', currentRel: 'src' }))).toEqual({
      type: 'focus',
      rel: 'README.md',
    })
  })

  it('ignores navigation modified by ctrl/meta/alt', () => {
    expect(resolveTreeKey(key({ key: 'ArrowDown', currentRel: 'src', metaKey: true }))).toBeNull()
    expect(resolveTreeKey(key({ key: 'Home', currentRel: 'src', ctrlKey: true }))).toBeNull()
    expect(resolveTreeKey(key({ key: 'End', currentRel: 'src', altKey: true }))).toBeNull()
  })
})

describe('resolveTreeKey — expand/collapse and hierarchy', () => {
  it('expands a collapsed directory with ArrowRight', () => {
    const collapsed = new Set(['src'])
    expect(
      resolveTreeKey(key({ key: 'ArrowRight', currentRel: 'src/comp', expanded: collapsed }))
    ).toEqual({ type: 'toggle', rel: 'src/comp' })
  })

  it('focuses the first child of an expanded directory', () => {
    expect(resolveTreeKey(key({ key: 'ArrowRight', currentRel: 'src' }))).toEqual({
      type: 'focus',
      rel: 'src/a.ts',
    })
    expect(resolveTreeKey(key({ key: 'ArrowRight', currentRel: 'src/comp' }))).toEqual({
      type: 'focus',
      rel: 'src/comp/b.ts',
    })
  })

  it('does nothing to expand a file or an empty directory', () => {
    expect(resolveTreeKey(key({ key: 'ArrowRight', currentRel: 'src/a.ts' }))).toBeNull()
    expect(
      resolveTreeKey(
        key({
          key: 'ArrowRight',
          rows: [{ rel: 'empty', isDir: true }],
          currentRel: 'empty',
          expanded: new Set(['empty']),
        })
      )
    ).toBeNull()
  })

  it('collapses an expanded directory with ArrowLeft', () => {
    expect(resolveTreeKey(key({ key: 'ArrowLeft', currentRel: 'src/comp' }))).toEqual({
      type: 'toggle',
      rel: 'src/comp',
    })
  })

  it('moves to the parent row from a collapsed directory or a file', () => {
    expect(
      resolveTreeKey(key({ key: 'ArrowLeft', currentRel: 'src/comp', expanded: new Set(['src']) }))
    ).toEqual({ type: 'focus', rel: 'src' })
    expect(resolveTreeKey(key({ key: 'ArrowLeft', currentRel: 'src/comp/b.ts' }))).toEqual({
      type: 'focus',
      rel: 'src/comp',
    })
    expect(resolveTreeKey(key({ key: 'ArrowLeft', currentRel: 'README.md' }))).toBeNull()
  })
})

describe('resolveTreeKey — activation', () => {
  it('toggles directories and opens files with Enter', () => {
    expect(resolveTreeKey(key({ key: 'Enter', currentRel: 'src' }))).toEqual({
      type: 'toggle',
      rel: 'src',
    })
    expect(resolveTreeKey(key({ key: 'Enter', currentRel: 'src/a.ts' }))).toEqual({
      type: 'open',
      rel: 'src/a.ts',
    })
  })

  it('opens files with Space', () => {
    expect(resolveTreeKey(key({ key: ' ', currentRel: 'README.md' }))).toEqual({
      type: 'open',
      rel: 'README.md',
    })
  })

  it('renames the current row with F2', () => {
    expect(resolveTreeKey(key({ key: 'F2', currentRel: 'src/comp' }))).toEqual({
      type: 'rename',
      rel: 'src/comp',
      isDir: true,
    })
    expect(resolveTreeKey(key({ key: 'F2', currentRel: 'src/a.ts' }))).toEqual({
      type: 'rename',
      rel: 'src/a.ts',
      isDir: false,
    })
  })

  it('deletes with Delete and with Cmd+Backspace on macOS', () => {
    expect(resolveTreeKey(key({ key: 'Delete', currentRel: 'src/a.ts' }))).toEqual({
      type: 'delete',
      rel: 'src/a.ts',
      isDir: false,
    })
    expect(
      resolveTreeKey(key({ key: 'Backspace', currentRel: 'src', isMac: true, metaKey: true }))
    ).toEqual({ type: 'delete', rel: 'src', isDir: true })
    // Plain Backspace and Cmd+Backspace on other platforms are not deletes.
    expect(resolveTreeKey(key({ key: 'Backspace', currentRel: 'src' }))).toBeNull()
    expect(
      resolveTreeKey(key({ key: 'Backspace', currentRel: 'src', isMac: false, metaKey: true }))
    ).toBeNull()
    expect(resolveTreeKey(key({ key: 'Delete', currentRel: 'src', ctrlKey: true }))).toBeNull()
  })

  it('opens the context menu from the ContextMenu key and Shift+F10', () => {
    expect(resolveTreeKey(key({ key: 'ContextMenu', currentRel: 'src/a.ts' }))).toEqual({
      type: 'menu',
      rel: 'src/a.ts',
      isDir: false,
    })
    expect(resolveTreeKey(key({ key: 'F10', currentRel: 'src', shiftKey: true }))).toEqual({
      type: 'menu',
      rel: 'src',
      isDir: true,
    })
    expect(resolveTreeKey(key({ key: 'F10', currentRel: 'src' }))).toBeNull()
  })

  it('needs a current row for row actions', () => {
    expect(resolveTreeKey(key({ key: 'Enter' }))).toBeNull()
    expect(resolveTreeKey(key({ key: 'F2', currentRel: 'missing' }))).toBeNull()
  })
})

describe('deleteShortcutLabel', () => {
  it('shows the platform-native delete hint', () => {
    expect(deleteShortcutLabel(true)).toBe('⌘⌫')
    expect(deleteShortcutLabel(false)).toBe('Del')
  })
})

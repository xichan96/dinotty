import { describe, expect, it } from 'vitest'
import {
  SIDE_BY_SIDE_MIN_WIDTH,
  buildDiffQuery,
  clampHunkIndex,
  hunkRevealLine,
  resolveDiffSpecialState,
  sameDiffContent,
  specialStateCanOpenInEditor,
  specialStateMessageKey,
  statusLetter,
  stepHunkIndex,
} from '../gitDiffHunks'

describe('statusLetter', () => {
  it('maps porcelain statuses to their short letter', () => {
    expect(statusLetter('modified')).toBe('M')
    expect(statusLetter('added')).toBe('A')
    expect(statusLetter('untracked')).toBe('A')
    expect(statusLetter('deleted')).toBe('D')
    expect(statusLetter('renamed')).toBe('R')
    expect(statusLetter('conflicted')).toBe('U')
    expect(statusLetter('typechange')).toBe('T')
  })
})

describe('resolveDiffSpecialState', () => {
  const flags = {
    binary: false,
    too_large: false,
    submodule: false,
    conflicted: false,
  }

  it('returns null for a plain text diff', () => {
    expect(resolveDiffSpecialState(flags)).toBeNull()
  })

  it('prefers binary over the other flags', () => {
    expect(resolveDiffSpecialState({ ...flags, binary: true, too_large: true })).toBe('binary')
  })

  it('falls through too-large, submodule and conflicted', () => {
    expect(resolveDiffSpecialState({ ...flags, too_large: true })).toBe('too_large')
    expect(resolveDiffSpecialState({ ...flags, submodule: true })).toBe('submodule')
    expect(resolveDiffSpecialState({ ...flags, conflicted: true })).toBe('conflicted')
  })

  it('returns null without response data', () => {
    expect(resolveDiffSpecialState(null)).toBeNull()
  })
})

describe('special state presentation', () => {
  it('maps each state to a workspaceChanges key', () => {
    expect(specialStateMessageKey('binary')).toBe('workspaceChanges.binary')
    expect(specialStateMessageKey('too_large')).toBe('workspaceChanges.tooLarge')
    expect(specialStateMessageKey('submodule')).toBe('workspaceChanges.submodule')
    expect(specialStateMessageKey('conflicted')).toBe('workspaceChanges.conflicted')
  })

  it('only offers open-in-editor for readable files', () => {
    expect(specialStateCanOpenInEditor('too_large')).toBe(true)
    expect(specialStateCanOpenInEditor('conflicted')).toBe(true)
    expect(specialStateCanOpenInEditor('binary')).toBe(false)
    expect(specialStateCanOpenInEditor('submodule')).toBe(false)
  })
})

describe('hunk navigation', () => {
  it('clamps indexes into the available range', () => {
    expect(clampHunkIndex(-5, 3)).toBe(0)
    expect(clampHunkIndex(1, 3)).toBe(1)
    expect(clampHunkIndex(9, 3)).toBe(2)
    expect(clampHunkIndex(1.9, 3)).toBe(1)
    expect(clampHunkIndex(Number.NaN, 3)).toBe(0)
  })

  it('returns -1 when there are no hunks', () => {
    expect(clampHunkIndex(0, 0)).toBe(-1)
    expect(stepHunkIndex(-1, 0, 1)).toBe(-1)
  })

  it('steps forward from nothing-selected to the first hunk', () => {
    expect(stepHunkIndex(-1, 3, 1)).toBe(0)
  })

  it('steps backward from nothing-selected to the last hunk', () => {
    expect(stepHunkIndex(-1, 3, -1)).toBe(2)
  })

  it('clamps at both ends instead of wrapping', () => {
    expect(stepHunkIndex(0, 3, -1)).toBe(0)
    expect(stepHunkIndex(2, 3, 1)).toBe(2)
    expect(stepHunkIndex(0, 3, 1)).toBe(1)
  })

  it('anchors deletions and invalid lines at line 1', () => {
    expect(hunkRevealLine({ modifiedStartLineNumber: 0 })).toBe(1)
    expect(hunkRevealLine({ modifiedStartLineNumber: -2 })).toBe(1)
    expect(hunkRevealLine({ modifiedStartLineNumber: 42 })).toBe(42)
  })
})

describe('sameDiffContent', () => {
  it('treats null as an empty string on either side', () => {
    expect(sameDiffContent(null, '')).toBe(true)
    expect(sameDiffContent('', null)).toBe(true)
    expect(sameDiffContent(null, 'x')).toBe(false)
    expect(sameDiffContent('x', 'x')).toBe(true)
  })
})

describe('buildDiffQuery', () => {
  it('serializes the head-base diff request', () => {
    const q = buildDiffQuery('pane-1', { path: 'src/a b.ts', origPath: null })
    expect(q.get('pane_id')).toBe('pane-1')
    expect(q.get('path')).toBe('src/a b.ts')
    expect(q.get('orig_path')).toBe('')
    expect(q.get('base')).toBe('head')
  })

  it('carries the previous path for renames', () => {
    const q = buildDiffQuery('pane-1', { path: 'new.ts', origPath: 'old.ts' })
    expect(q.get('orig_path')).toBe('old.ts')
  })

  it('keeps 900px as the side-by-side breakpoint', () => {
    expect(SIDE_BY_SIDE_MIN_WIDTH).toBe(900)
  })
})

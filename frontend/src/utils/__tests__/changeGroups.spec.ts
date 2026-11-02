import { describe, expect, it } from 'vitest'
import {
  changeStatusLetter,
  countStagedChanges,
  formatChangeCount,
  groupChangesByDirectory,
  isStagedChange,
} from '../changeGroups'
import type { WorkspaceChangeFile } from '../../types/workspaceChanges'

function file(path: string, over: Partial<WorkspaceChangeFile> = {}): WorkspaceChangeFile {
  return {
    path,
    orig_path: null,
    index_status: '',
    worktree_status: 'M',
    status: 'modified',
    additions: 1,
    deletions: 0,
    binary: false,
    conflicted: false,
    submodule: false,
    ...over,
  }
}

describe('groupChangesByDirectory', () => {
  it('groups by directory and collapses single-child chains', () => {
    const groups = groupChangesByDirectory([
      file('README.md'),
      file('lib/a.ts'),
      file('src/components/App.vue'),
      file('src/components/ui/Button.vue'),
    ])

    expect(groups.map((group) => group.dir)).toEqual([
      '',
      'lib',
      'src/components',
      'src/components/ui',
    ])
    expect(groups[0].files.map((f) => f.path)).toEqual(['README.md'])
    expect(groups[2].files.map((f) => f.path)).toEqual(['src/components/App.vue'])
  })

  it('does not merge a chain when a directory also holds files', () => {
    const groups = groupChangesByDirectory([file('src/a.ts'), file('src/lib/b.ts')])

    expect(groups.map((group) => group.dir)).toEqual(['src', 'src/lib'])
  })

  it('sorts groups and files by path', () => {
    const groups = groupChangesByDirectory([
      file('z/b.ts'),
      file('z/a.ts'),
      file('a/c.ts'),
      file('a/b.ts'),
    ])

    expect(groups.map((group) => group.dir)).toEqual(['a', 'z'])
    expect(groups[0].files.map((f) => f.path)).toEqual(['a/b.ts', 'a/c.ts'])
  })
})

describe('change markers', () => {
  it('maps statuses to porcelain letters and lets conflicts win', () => {
    expect(changeStatusLetter(file('a', { status: 'modified' }))).toBe('M')
    expect(changeStatusLetter(file('a', { status: 'added' }))).toBe('A')
    expect(changeStatusLetter(file('a', { status: 'deleted' }))).toBe('D')
    expect(changeStatusLetter(file('a', { status: 'renamed' }))).toBe('R')
    expect(changeStatusLetter(file('a', { status: 'untracked' }))).toBe('U')
    expect(changeStatusLetter(file('a', { status: 'typechange' }))).toBe('T')
    expect(changeStatusLetter(file('a', { status: 'modified', conflicted: true }))).toBe('!')
  })

  it('treats a non-empty index column as staged', () => {
    expect(isStagedChange(file('a', { index_status: 'M' }))).toBe(true)
    expect(isStagedChange(file('a', { index_status: ' ' }))).toBe(false)
    expect(isStagedChange(file('a', { index_status: '' }))).toBe(false)
    expect(
      countStagedChanges([
        file('a', { index_status: 'M' }),
        file('b', { index_status: '' }),
        file('c', { index_status: 'A' }),
      ])
    ).toBe(2)
  })

  it('prints an em dash when the backend skipped line counting', () => {
    expect(formatChangeCount(12, '+')).toBe('+12')
    expect(formatChangeCount(null, '-')).toBe('—')
  })
})

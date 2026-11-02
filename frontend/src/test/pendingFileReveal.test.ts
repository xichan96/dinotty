import { describe, expect, it } from 'vitest'
import { setPendingFileReveal, takePendingFileReveal } from '../composables/pendingFileReveal'

describe('pendingFileReveal', () => {
  it('returns the stashed target exactly once', () => {
    setPendingFileReveal('files-1', { path: 'src/a.ts', line: 4, column: 2 })

    expect(takePendingFileReveal('files-1')).toEqual({
      path: 'src/a.ts',
      line: 4,
      column: 2,
    })
    expect(takePendingFileReveal('files-1')).toBeNull()
  })

  it('does not leak targets across panes', () => {
    setPendingFileReveal('files-1', { path: 'src/a.ts', line: 1 })
    expect(takePendingFileReveal('files-2')).toBeNull()
    expect(takePendingFileReveal('files-1')).not.toBeNull()
  })
})

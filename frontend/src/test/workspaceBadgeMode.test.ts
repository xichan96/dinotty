import { describe, expect, it } from 'vitest'
import { resolveWorkspaceBadgeMode } from '../composables/useWorkspaceBadgeMode'
import type { WorkspaceBadgeMode } from '../composables/useSettings'

describe('workspace badge mode resolution', () => {
  it.each<[WorkspaceBadgeMode, boolean, boolean]>([
    ['off', false, false],
    ['tab', true, false],
    ['icon', false, true],
    ['both', true, true],
  ])('resolves explicit %s mode', (mode, showTabBadge, showMonogram) => {
    expect(resolveWorkspaceBadgeMode(mode, false)).toEqual({
      mode,
      showTabBadge,
      showMonogram,
    })
    expect(resolveWorkspaceBadgeMode(mode, true)).toEqual({
      mode,
      showTabBadge,
      showMonogram,
    })
  })

  it('uses tab mode when unset on mobile', () => {
    expect(resolveWorkspaceBadgeMode(null, true)).toEqual({
      mode: 'tab',
      showTabBadge: true,
      showMonogram: false,
    })
  })

  it('uses off mode when unset on desktop', () => {
    expect(resolveWorkspaceBadgeMode(undefined, false)).toEqual({
      mode: 'off',
      showTabBadge: false,
      showMonogram: false,
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  migrateTab,
  migratePreviewToLeaf,
  getAllLeaves,
  type TerminalTab,
  type LegacyPreviewState,
} from '../types/pane'

type TabWithLegacyPreview = TerminalTab & LegacyPreviewState

function baseRawTab(overrides: Partial<any> = {}): any {
  return {
    type: 'terminal',
    paneId: 'tab-1',
    layout: {
      type: 'split',
      id: 's-1',
      direction: 'horizontal',
      children: [
        { type: 'leaf', kind: 'terminal', paneId: 'p-1', title: 'T', ratio: 1, zoomed: false },
      ],
      ratios: [1],
    },
    activePaneId: 'p-1',
    broadcastMode: false,
    broadcastActivity: 0,
    ...overrides,
  }
}

function baseTab(overrides: Partial<TabWithLegacyPreview> = {}): TabWithLegacyPreview {
  return {
    type: 'terminal',
    paneId: 'tab-1',
    layout: {
      type: 'split',
      id: 's-1',
      direction: 'horizontal',
      children: [
        { type: 'leaf', kind: 'terminal', paneId: 'p-1', title: 'T', ratio: 1, zoomed: false },
      ],
      ratios: [1],
    },
    activePaneId: 'p-1',
    paneMru: ['p-1'],
    broadcastMode: false,
    broadcastActivity: 0,
    ...overrides,
  }
}

describe('migratePreviewToLeaf', () => {
  it('returns the tab unchanged when previewVisible is false', () => {
    const tab = baseTab()
    const result = migratePreviewToLeaf(tab)
    expect(result).toBe(tab)
    expect(getAllLeaves(result.layout)).toHaveLength(1)
  })

  it('converts files preview state into a files leaf', () => {
    const tab = baseTab({
      previewVisible: true,
      previewAddress: '/foo',
      previewKind: 'files',
    })
    const result = migratePreviewToLeaf(tab)
    const leaves = getAllLeaves(result.layout)
    expect(leaves).toHaveLength(2)
    const filesLeaf = leaves.find((l) => l.kind === 'files')
    expect(filesLeaf).toBeDefined()
    expect(filesLeaf?.path).toBe('/foo')
    expect((result as any).previewVisible).toBeUndefined()
  })

  it('converts web preview state into a web leaf', () => {
    const tab = baseTab({
      previewVisible: true,
      previewAddress: 'https://example.com',
      previewUrl: 'https://example.com',
      previewKind: 'web',
    })
    const result = migratePreviewToLeaf(tab)
    const leaves = getAllLeaves(result.layout)
    expect(leaves).toHaveLength(2)
    const webLeaf = leaves.find((l) => l.kind === 'web')
    expect(webLeaf).toBeDefined()
    expect(webLeaf?.url).toBe('https://example.com')
    expect((result as any).previewVisible).toBeUndefined()
  })

  it('is idempotent: migrating an already-migrated tab adds no second leaf', () => {
    const raw = baseRawTab({
      previewVisible: true,
      previewAddress: '/foo',
      previewKind: 'files',
    })
    const first = migrateTab(raw)
    expect(getAllLeaves(first.layout)).toHaveLength(2)
    const second = migrateTab(first)
    expect(getAllLeaves(second.layout)).toHaveLength(2)
  })
})

describe('migrateTab (preview migration)', () => {
  it('migrates preview state when reading a modern-layout tab with previewVisible=true', () => {
    const raw = baseRawTab({
      previewVisible: true,
      previewAddress: '/foo',
      previewKind: 'files',
    })
    const tab = migrateTab(raw)
    expect(getAllLeaves(tab.layout)).toHaveLength(2)
    expect(getAllLeaves(tab.layout).some((l) => l.kind === 'files' && l.path === '/foo')).toBe(true)
    expect((tab as any).previewVisible).toBeUndefined()
  })

  it('does not touch a tab without preview state', () => {
    const raw = baseRawTab({})
    const tab = migrateTab(raw)
    expect(getAllLeaves(tab.layout)).toHaveLength(1)
    expect((tab as any).previewVisible).toBeUndefined()
  })

  it('migrates legacy paneId-format tab with preview state', () => {
    const raw = {
      type: 'terminal',
      paneId: 'p-1',
      title: 'T',
      previewVisible: true,
      previewAddress: '/bar',
      previewKind: 'files',
    }
    const tab = migrateTab(raw)
    expect(getAllLeaves(tab.layout)).toHaveLength(2)
    expect(getAllLeaves(tab.layout).some((l) => l.kind === 'files' && l.path === '/bar')).toBe(true)
    expect((tab as any).previewVisible).toBeUndefined()
  })
})

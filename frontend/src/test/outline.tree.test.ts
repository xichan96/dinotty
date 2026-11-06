import { describe, expect, it } from 'vitest'
import type { OutlineItem } from '../types/outline'
import {
  defaultExpandedIds,
  expandableIds,
  findOutlineEntry,
  flattenOutline,
  outlineAtLine,
  outlineRows,
} from '../utils/outlineTree'

const items: OutlineItem[] = [
  {
    id: 'a',
    label: 'Alpha',
    kind: 'heading',
    line: 1,
    level: 1,
    children: [
      {
        id: 'b',
        label: 'Beta child',
        kind: 'heading',
        line: 2,
        level: 2,
        children: [{ id: 'c', label: 'Gamma', kind: 'heading', line: 3, level: 3 }],
      },
      { id: 'd', label: 'Delta', kind: 'heading', line: 4, level: 2 },
    ],
  },
  { id: 'e', label: 'Epsilon', kind: 'heading', line: 5, level: 1 },
]

function rowIds(expanded: Set<string>, query = ''): string[] {
  return outlineRows(items, expanded, query).rows.map((entry) => entry.item.id)
}

describe('outline tree helpers', () => {
  it('flattens with depth and ancestor ids', () => {
    const flat = flattenOutline(items)
    expect(flat.map((entry) => entry.item.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(flat.find((entry) => entry.item.id === 'c')?.parents).toEqual(['a', 'b'])
  })

  it('expands two levels by default', () => {
    expect([...defaultExpandedIds(items)]).toEqual(['a', 'b'])
    expect(rowIds(defaultExpandedIds(items))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('keeps JSON arrays collapsed by default so they read as [n] leaves', () => {
    const jsonItems: OutlineItem[] = [
      {
        id: 'arr',
        label: 'modes',
        kind: 'array',
        line: 1,
        value: '[2]',
        children: [
          { id: 'arr0', label: '[0]', kind: 'scalar', line: 1, value: '"a"' },
          { id: 'arr1', label: '[1]', kind: 'scalar', line: 1, value: '"b"' },
        ],
      },
    ]
    expect(defaultExpandedIds(jsonItems).has('arr')).toBe(false)
    expect(outlineRows(jsonItems, defaultExpandedIds(jsonItems), '').rows).toHaveLength(1)
    expect(outlineRows(jsonItems, new Set(['arr']), '').rows).toHaveLength(3)
  })

  it('hides rows under collapsed ancestors', () => {
    expect(rowIds(new Set(['b']))).toEqual(['a', 'e'])
    expect(rowIds(new Set(['a']))).toEqual(['a', 'b', 'd', 'e'])
  })

  it('keeps the ancestor chain for filter matches and ignores collapse state', () => {
    const result = outlineRows(items, new Set(), 'gamma')
    expect(result.rows.map((entry) => entry.item.id)).toEqual(['a', 'b', 'c'])
    expect(result.matches).toBe(1)
    expect(result.total).toBe(5)

    expect(outlineRows(items, new Set(), 'delta').rows.map((entry) => entry.item.id)).toEqual([
      'a',
      'd',
    ])
    expect(outlineRows(items, new Set(), 'nothing').matches).toBe(0)
  })

  it('matches case-insensitively', () => {
    expect(outlineRows(items, new Set(), 'EPSILON').rows.map((entry) => entry.item.id)).toEqual([
      'e',
    ])
  })

  it('lists expandable ids and looks entries up by id', () => {
    expect(expandableIds(items)).toEqual(['a', 'b'])
    expect(findOutlineEntry(items, 'c')?.depth).toBe(2)
    expect(findOutlineEntry(items, 'missing')).toBeUndefined()
  })

  it('picks the deepest item above the reading line', () => {
    const flat = flattenOutline(items)
    expect(outlineAtLine(flat, 1)?.id).toBe('a')
    expect(outlineAtLine(flat, 2)?.id).toBe('b')
    expect(outlineAtLine(flat, 4)?.id).toBe('d')
    expect(outlineAtLine(flat, 99)?.id).toBe('e')
    expect(outlineAtLine(flat, 0)).toBeUndefined()
  })
})

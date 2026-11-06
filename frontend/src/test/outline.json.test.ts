import { describe, expect, it } from 'vitest'
import { parseJsonOutline } from '../utils/jsonOutline'
import type { OutlineItem } from '../types/outline'

function labels(items: OutlineItem[]): string[] {
  return items.map((item) => item.label)
}

describe('JSON outline', () => {
  const source = [
    '{',
    '  "panel": {',
    '    "width": 300,',
    '    "modes": ["fast", "safe"],',
    '    "enabled": true,',
    '    "empty": {}',
    '  },',
    '  "top": null',
    '}',
  ].join('\n')

  it('builds a key tree with object, array and scalar kinds', () => {
    const result = parseJsonOutline(source)
    expect(result.errorLine).toBeUndefined()

    expect(labels(result.items)).toEqual(['panel', 'top'])
    const [panel, top] = result.items
    expect(panel).toMatchObject({ id: '$.panel', kind: 'object', line: 2, value: '{4}' })
    expect(labels(panel.children ?? [])).toEqual(['width', 'modes', 'enabled', 'empty'])
    expect(panel.children?.[0]).toMatchObject({
      id: '$.panel.width',
      kind: 'scalar',
      line: 3,
      value: '300',
    })
    expect(panel.children?.[1]).toMatchObject({
      id: '$.panel.modes',
      kind: 'array',
      line: 4,
      value: '[2]',
    })
    expect(labels(panel.children?.[1].children ?? [])).toEqual(['[0]', '[1]'])
    expect(panel.children?.[1].children?.[0]).toMatchObject({
      id: '$.panel.modes[0]',
      kind: 'scalar',
      line: 4,
      value: '"fast"',
    })
    expect(panel.children?.[2]).toMatchObject({ kind: 'scalar', line: 5, value: 'true' })
    expect(panel.children?.[3]).toMatchObject({ kind: 'object', line: 6, value: '{0}' })
    expect(top).toMatchObject({ id: '$.top', kind: 'scalar', line: 8, value: 'null' })
  })

  it('supports a top-level array and object elements', () => {
    const result = parseJsonOutline('[\n  {"id": 1},\n  "x"\n]')
    expect(labels(result.items)).toEqual(['[0]', '[1]'])
    expect(result.items[0]).toMatchObject({ kind: 'object', line: 2, value: '{1}' })
    expect(result.items[0].children?.[0]).toMatchObject({
      id: '$[0].id',
      label: 'id',
      value: '1',
      line: 2,
    })
    expect(result.items[1]).toMatchObject({ kind: 'scalar', line: 3, value: '"x"' })
  })

  it('reports the failing line for malformed JSON', () => {
    const result = parseJsonOutline('{\n  "a": 1,\n  "b"\n}')
    expect(result.items).toEqual([])
    expect(result.errorLine).toBe(4)
    expect(result.errorMessage).toBeTruthy()
  })

  it('reports a line for errors without a position', () => {
    const result = parseJsonOutline('not json')
    expect(result.errorLine).toBe(1)
  })

  it('tolerates a UTF-8 BOM', () => {
    expect(parseJsonOutline('﻿{"a": 1}').items[0]).toMatchObject({
      label: 'a',
      value: '1',
      line: 1,
    })
  })

  it('returns no keys for empty or top-level scalar documents', () => {
    expect(parseJsonOutline('').items).toEqual([])
    expect(parseJsonOutline('   ').items).toEqual([])
    expect(parseJsonOutline('42').items).toEqual([])
    expect(parseJsonOutline('"text"').items).toEqual([])
  })
})

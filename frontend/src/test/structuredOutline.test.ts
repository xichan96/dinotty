import { describe, expect, it } from 'vitest'
import type { OutlineItem } from '../types/outline'
import { parseJsonOutline } from '../utils/jsonOutline'
import { parseStructuredOutline, structuredFormatForLanguage } from '../utils/structuredOutline'

function labels(items: OutlineItem[]): string[] {
  return items.map((item) => item.label)
}

function child(items: OutlineItem[], label: string): OutlineItem {
  const found = items.find((item) => item.label === label)
  if (!found) throw new Error(`missing child ${label}`)
  return found
}

describe('structuredFormatForLanguage', () => {
  it('maps config languages to structured formats', () => {
    expect(structuredFormatForLanguage('json')).toBe('json')
    expect(structuredFormatForLanguage('yaml')).toBe('yaml')
    expect(structuredFormatForLanguage('YML')).toBe('yaml')
    expect(structuredFormatForLanguage('toml')).toBe('toml')
    expect(structuredFormatForLanguage('typescript')).toBeNull()
    expect(structuredFormatForLanguage(null)).toBeNull()
    expect(structuredFormatForLanguage(undefined)).toBeNull()
  })
})

describe('structured outline JSON parity', () => {
  it('delegates to parseJsonOutline unchanged', () => {
    const text = '{\n  "a": [1, {"b": 2}],\n  "c": "x"\n}'
    expect(parseStructuredOutline(text, 'json')).toEqual(parseJsonOutline(text))
  })
})

describe('YAML outline', () => {
  const source = [
    'service:',
    '  name: dinotty',
    '  ports:',
    '    - 8080',
    '    - 9090',
    '  nested:',
    '    enabled: true',
    'flow: {a: 1, b: [x, y]}',
    'empty: {}',
  ].join('\n')

  it('builds nested maps and sequences with source lines', () => {
    const result = parseStructuredOutline(source, 'yaml')
    expect(result.errorLine).toBeUndefined()
    expect(labels(result.items)).toEqual(['service', 'flow', 'empty'])

    const service = child(result.items, 'service')
    expect(service).toMatchObject({
      id: '$.service',
      kind: 'object',
      line: 1,
      value: '{3}',
    })
    expect(labels(service.children ?? [])).toEqual(['name', 'ports', 'nested'])

    expect(child(service.children ?? [], 'name')).toMatchObject({
      id: '$.service.name',
      kind: 'scalar',
      line: 2,
      value: '"dinotty"',
    })

    const ports = child(service.children ?? [], 'ports')
    expect(ports).toMatchObject({ id: '$.service.ports', kind: 'array', line: 3, value: '[2]' })
    expect(ports.children?.[0]).toMatchObject({
      id: '$.service.ports[0]',
      label: '[0]',
      line: 4,
      value: '8080',
    })
    expect(ports.children?.[1]).toMatchObject({ id: '$.service.ports[1]', line: 5, value: '9090' })

    expect(child(child(service.children ?? [], 'nested').children ?? [], 'enabled')).toMatchObject({
      id: '$.service.nested.enabled',
      line: 7,
      value: 'true',
    })

    const flow = child(result.items, 'flow')
    expect(flow).toMatchObject({ kind: 'object', line: 8, value: '{2}' })
    expect(child(flow.children ?? [], 'a')).toMatchObject({
      id: '$.flow.a',
      line: 8,
      value: '1',
    })
    const flowList = child(flow.children ?? [], 'b')
    expect(flowList).toMatchObject({ kind: 'array', line: 8, value: '[2]' })
    expect(flowList.children?.[0]).toMatchObject({ id: '$.flow.b[0]', value: '"x"' })

    expect(child(result.items, 'empty')).toMatchObject({ kind: 'object', value: '{0}' })
  })

  it('handles anchors and guards alias cycles', () => {
    const source = ['base: &base', '  name: x', '  self: *base', 'ref: *base'].join('\n')
    const result = parseStructuredOutline(source, 'yaml')
    expect(result.errorLine).toBeUndefined()

    const base = child(result.items, 'base')
    expect(labels(base.children ?? [])).toEqual(['name', 'self'])
    expect(child(base.children ?? [], 'self')).toMatchObject({
      id: '$.base.self',
      kind: 'scalar',
      line: 3,
      value: '<circular>',
    })

    // A non-cyclic alias still expands to the anchored node.
    const ref = child(result.items, 'ref')
    expect(ref).toMatchObject({ kind: 'object', value: '{2}' })
    expect(labels(ref.children ?? [])).toEqual(['name', 'self'])
  })

  it('reports a YAML error line', () => {
    const result = parseStructuredOutline('a: 1\na: 2\n', 'yaml')
    expect(result.items).toEqual([])
    expect(result.errorLine).toBe(2)
    expect(result.errorMessage).toBeTruthy()
  })

  it('returns no keys for empty or scalar documents', () => {
    expect(parseStructuredOutline('', 'yaml').items).toEqual([])
    expect(parseStructuredOutline('text', 'yaml').items).toEqual([])
  })
})

describe('TOML outline', () => {
  const source = [
    'title = "demo"',
    'owner.name = "x"',
    '',
    '[server]',
    'host = "localhost"',
    'ports = [80, 443]',
    '',
    '[database]',
    'enabled = true',
    'config = { retries = 3, tags = ["a", "b"] }',
    '',
    '[[products]]',
    'name = "hammer"',
    '[products.details]',
    'weight = 2',
    '',
    '[[products]]',
    'name = "nail"',
  ].join('\n')

  it('builds tables, arrays of tables, inline tables and dotted keys', () => {
    const result = parseStructuredOutline(source, 'toml')
    expect(result.errorLine).toBeUndefined()
    expect(labels(result.items)).toEqual(['title', 'owner', 'server', 'database', 'products'])

    expect(child(result.items, 'title')).toMatchObject({
      id: '$.title',
      kind: 'scalar',
      line: 1,
      value: '"demo"',
    })

    const owner = child(result.items, 'owner')
    expect(owner).toMatchObject({ kind: 'object', line: 2, value: '{1}' })
    expect(child(owner.children ?? [], 'name')).toMatchObject({
      id: '$.owner.name',
      line: 2,
      value: '"x"',
    })

    const server = child(result.items, 'server')
    expect(server).toMatchObject({ kind: 'object', line: 4 })
    expect(child(server.children ?? [], 'host')).toMatchObject({ line: 5, value: '"localhost"' })
    const ports = child(server.children ?? [], 'ports')
    expect(ports).toMatchObject({ id: '$.server.ports', kind: 'array', line: 6, value: '[2]' })
    expect(ports.children?.[0]).toMatchObject({ id: '$.server.ports[0]', line: 6, value: '80' })

    const database = child(result.items, 'database')
    expect(child(database.children ?? [], 'enabled')).toMatchObject({ line: 9, value: 'true' })
    const config = child(database.children ?? [], 'config')
    expect(config).toMatchObject({ kind: 'object', line: 10, value: '{2}' })
    expect(child(config.children ?? [], 'retries')).toMatchObject({
      id: '$.database.config.retries',
      line: 10,
      value: '3',
    })
    expect(child(config.children ?? [], 'tags')).toMatchObject({
      id: '$.database.config.tags',
      kind: 'array',
      value: '[2]',
    })

    const products = child(result.items, 'products')
    expect(products).toMatchObject({ id: '$.products', kind: 'array', line: 12, value: '[2]' })
    expect(labels(products.children ?? [])).toEqual(['[0]', '[1]'])
    const first = products.children?.[0]
    expect(first).toMatchObject({ id: '$.products[0]', kind: 'object', line: 12 })
    expect(child(first?.children ?? [], 'name')).toMatchObject({ line: 13, value: '"hammer"' })
    const details = child(first?.children ?? [], 'details')
    expect(details).toMatchObject({ id: '$.products[0].details', kind: 'object', line: 14 })
    expect(child(details.children ?? [], 'weight')).toMatchObject({
      id: '$.products[0].details.weight',
      line: 15,
      value: '2',
    })
    const second = products.children?.[1]
    expect(second).toMatchObject({ id: '$.products[1]', line: 17 })
    expect(child(second?.children ?? [], 'name')).toMatchObject({ line: 18, value: '"nail"' })
  })

  it('reports a TOML error line', () => {
    const result = parseStructuredOutline('a = 1\nb = 2\nc =', 'toml')
    expect(result.items).toEqual([])
    expect(result.errorLine).toBe(3)
    expect(result.errorMessage).toBeTruthy()
  })

  it('returns no keys for empty or scalar documents', () => {
    expect(parseStructuredOutline('', 'toml').items).toEqual([])
    expect(parseStructuredOutline('n = 1', 'toml').items).toHaveLength(1)
  })
})

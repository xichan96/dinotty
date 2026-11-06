/** Tree helpers shared by the outline composable, panel and scroll spy. */
import type { OutlineItem } from '../types/outline'

export interface FlatOutlineEntry {
  item: OutlineItem
  depth: number
  /** Ancestor ids, root first. */
  parents: string[]
}

export function flattenOutline(items: readonly OutlineItem[]): FlatOutlineEntry[] {
  const rows: FlatOutlineEntry[] = []

  function visit(nodes: readonly OutlineItem[], depth: number, parents: string[]): void {
    for (const item of nodes) {
      rows.push({ item, depth, parents })
      if (item.children && item.children.length > 0) {
        visit(item.children, depth + 1, [...parents, item.id])
      }
    }
  }

  visit(items, 0, [])
  return rows
}

/**
 * Rows visible for the current expansion and filter state.
 *
 * With a query the tree ignores collapse state and shows every match plus its
 * ancestor chain; without one it hides rows below a collapsed ancestor.
 */
export function outlineRows(
  items: readonly OutlineItem[],
  expanded: ReadonlySet<string>,
  query: string
): { rows: FlatOutlineEntry[]; matches: number; total: number } {
  const all = flattenOutline(items)
  const needle = query.trim().toLowerCase()
  if (!needle) {
    const rows = all.filter((entry) => entry.parents.every((parent) => expanded.has(parent)))
    return { rows, matches: all.length, total: all.length }
  }

  const include = new Set<string>()
  let matches = 0
  for (const entry of all) {
    if (entry.item.label.toLowerCase().indexOf(needle) < 0) continue
    matches++
    include.add(entry.item.id)
    for (const parent of entry.parents) include.add(parent)
  }

  return { rows: all.filter((entry) => include.has(entry.item.id)), matches, total: all.length }
}

/**
 * Nodes expanded by default: those with children at depth < `maxDepth`.
 * Arrays stay collapsed so they read as a compact `[n]` leaf until opened.
 */
export function defaultExpandedIds(items: readonly OutlineItem[], maxDepth = 2): Set<string> {
  const ids = new Set<string>()
  function visit(nodes: readonly OutlineItem[], depth: number): void {
    for (const item of nodes) {
      if (item.children && item.children.length > 0) {
        if (depth < maxDepth && item.kind !== 'array') ids.add(item.id)
        visit(item.children, depth + 1)
      }
    }
  }
  visit(items, 0)
  return ids
}

export function expandableIds(items: readonly OutlineItem[]): string[] {
  const ids: string[] = []
  function visit(nodes: readonly OutlineItem[]): void {
    for (const item of nodes) {
      if (item.children && item.children.length > 0) {
        ids.push(item.id)
        visit(item.children)
      }
    }
  }
  visit(items)
  return ids
}

export function findOutlineEntry(
  items: readonly OutlineItem[],
  id: string
): FlatOutlineEntry | undefined {
  return flattenOutline(items).find((entry) => entry.item.id === id)
}

/** The outline item whose source line is closest above `line`. */
export function outlineAtLine(
  entries: readonly FlatOutlineEntry[],
  line: number
): OutlineItem | undefined {
  const ordered = entries.slice().sort((a, b) => a.item.line - b.item.line || a.depth - b.depth)
  let active: OutlineItem | undefined
  for (const entry of ordered) {
    if (entry.item.line > line) break
    active = entry.item
  }
  return active
}

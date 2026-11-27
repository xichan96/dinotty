import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Vue resolves a string template ref against setup-state keys by exact name. A
// dotted name such as `ref="ops.inputRef"` silently lands in `$refs` instead of
// writing to `ops.inputRef`, so the composable that reads that ref never sees
// the element and actions like "open the file picker" become no-ops. Dynamic
// refs (`:ref="setter"` / `:ref="theRef"`) are the supported way to reach a
// ref that lives inside a composable's return object.

const SRC = path.resolve(__dirname, '..')
const DOTTED_STATIC_REF = /(?<![:\w-])ref="([^"]*\.[^"]*)"/g

function vueFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : vueFiles(full)
    return entry.name.endsWith('.vue') ? [full] : []
  })
}

/** Only the SFC template block: script comments and docs may quote the pattern. */
function templateBlock(src: string): string {
  const start = src.indexOf('<template')
  const end = src.lastIndexOf('</template>')
  return start === -1 || end <= start ? '' : src.slice(start, end)
}

describe('template refs', () => {
  it('never uses a dotted string ref, which Vue resolves to nothing', () => {
    const offenders: string[] = []
    for (const file of vueFiles(SRC)) {
      const template = templateBlock(fs.readFileSync(file, 'utf8'))
      for (const match of template.matchAll(DOTTED_STATIC_REF)) {
        offenders.push(`${path.relative(SRC, file)}: ref="${match[1]}"`)
      }
    }
    expect(offenders).toEqual([])
  })
})

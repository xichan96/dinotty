import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFilePathLinkProvider } from '../composables/useTerminal'
import type { LogicalTerminalLine } from '../utils/terminalLogicalLine'

/** Lay `text` out over `cols`-wide rows, like xterm's soft wrap. */
function laidOutLine(text: string, cols: number, startY = 1): LogicalTerminalLine {
  return {
    text,
    cells: Array.from(text, (_, i) => ({
      x: (i % cols) + 1,
      y: startY + Math.floor(i / cols),
      width: 1,
    })),
  }
}

function plainLine(text: string): LogicalTerminalLine {
  return laidOutLine(text, Math.max(text.length, 1))
}

function makeProvider(lineText: string | undefined) {
  const onOpen = vi.fn()
  const onHover = vi.fn()
  const provider = createFilePathLinkProvider({
    readLine: () => (lineText === undefined ? undefined : plainLine(lineText)),
    onOpen,
    onHover,
  }) as {
    provideLinks: (n: number, cb: (links: any[] | undefined) => void) => void
  }
  let links: any[] | undefined
  provider.provideLinks(1, (found) => {
    links = found
  })
  return { links: links ?? [], onOpen, onHover }
}

const click = { clientX: 11, clientY: 22 } as MouseEvent

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createFilePathLinkProvider', () => {
  it('detects absolute, relative and ~/ paths but not bare words', () => {
    const { links } = makeProvider('cat /etc/hosts ./a.txt ~/notes.md src/main.rs word')

    expect(links.map((l: any) => l.text)).toEqual([
      '/etc/hosts',
      './a.txt',
      '~/notes.md',
      'src/main.rs',
    ])
  })

  it('does not treat http URLs as file paths', () => {
    const { links } = makeProvider('see https://example.com/a and http://example.com/b')

    expect(links).toHaveLength(0)
  })

  it('activates with the target, parsed position, and click coordinates', () => {
    const { links, onOpen } = makeProvider('error at /var/log/system.log:5')

    links[0].activate(click)

    expect(onOpen).toHaveBeenCalledWith(
      { path: '/var/log/system.log', line: 5, column: undefined },
      11,
      22
    )
  })

  it('underlines the :line:col suffix but opens the bare path', () => {
    const { links, onOpen } = makeProvider('  src/foo.ts:42:7')

    expect(links[0].range).toEqual({
      start: { x: 3, y: 1 },
      end: { x: 18, y: 1 },
    })
    links[0].activate(click)
    expect(onOpen).toHaveBeenCalledWith({ path: 'src/foo.ts', line: 42, column: 7 }, 11, 22)
  })

  it('reports hover and clears on leave', () => {
    const { links, onHover } = makeProvider('error at /var/log/system.log:5')

    links[0].hover()
    expect(onHover).toHaveBeenCalledWith('/var/log/system.log')
    links[0].leave()
    expect(onHover).toHaveBeenCalledWith(null)
  })

  it('spans soft-wrapped rows instead of truncating at the wrap', () => {
    const text = '/very/long/path/main.rs:42'
    const onOpen = vi.fn()
    const provider = createFilePathLinkProvider({
      readLine: () => laidOutLine(text, 10),
      onOpen,
      onHover: vi.fn(),
    }) as {
      provideLinks: (n: number, cb: (links: any[] | undefined) => void) => void
    }
    let links: any[] | undefined
    provider.provideLinks(1, (found) => {
      links = found
    })

    expect(links).toHaveLength(1)
    expect(links![0].text).toBe(text)
    // Starts on row 1, continues onto rows 2 and 3.
    expect(links![0].range).toEqual({ start: { x: 1, y: 1 }, end: { x: 7, y: 3 } })
    links![0].activate(click)
    expect(onOpen).toHaveBeenCalledWith(
      { path: '/very/long/path/main.rs', line: 42, column: undefined },
      11,
      22
    )
  })

  it('yields no links for plain text or missing lines', () => {
    for (const text of ['no paths here', undefined]) {
      const { links, onOpen, onHover } = makeProvider(text)
      expect(links).toHaveLength(0)
      expect(onOpen).not.toHaveBeenCalled()
      expect(onHover).not.toHaveBeenCalled()
    }
  })
})

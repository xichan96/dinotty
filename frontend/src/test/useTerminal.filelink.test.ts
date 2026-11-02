import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFilePathLinkProvider } from '../composables/useTerminal'

function makeProvider(lineText: string | undefined) {
  const onOpen = vi.fn()
  const onHover = vi.fn()
  const provider = createFilePathLinkProvider({
    readLine: () => lineText,
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

  it('yields no links for plain text or missing lines', () => {
    for (const text of ['no paths here', undefined]) {
      const { links, onOpen, onHover } = makeProvider(text)
      expect(links).toHaveLength(0)
      expect(onOpen).not.toHaveBeenCalled()
      expect(onHover).not.toHaveBeenCalled()
    }
  })
})

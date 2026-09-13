import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUrlLinkProvider } from '../composables/useTerminal'

function makeProvider(lineText: string | undefined) {
  const onOpen = vi.fn()
  const onMenu = vi.fn()
  const onHover = vi.fn()
  const provider = createUrlLinkProvider({
    readLine: () => lineText,
    onOpen,
    onMenu,
    onHover,
  }) as {
    provideLinks: (n: number, cb: (links: any[] | undefined) => void) => void
  }
  let links: any[] | undefined
  provider.provideLinks(1, (found) => {
    links = found
  })
  return { links: links ?? [], onOpen, onMenu, onHover }
}

const primaryClick = { button: 0, clientX: 11, clientY: 22 } as MouseEvent
const secondaryClick = { button: 2, clientX: 11, clientY: 22 } as MouseEvent

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createUrlLinkProvider click routing (#306)', () => {
  it('routes a primary click to open, never to the menu', () => {
    const { links, onOpen, onMenu } = makeProvider('see https://example.com/docs here')

    expect(links).toHaveLength(1)
    links[0].activate(primaryClick)

    expect(onOpen).toHaveBeenCalledWith('https://example.com/docs')
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('routes a non-primary click to the menu with coordinates', () => {
    const { links, onOpen, onMenu } = makeProvider('see https://example.com/docs here')

    links[0].activate(secondaryClick)

    expect(onMenu).toHaveBeenCalledWith('https://example.com/docs', 11, 22)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('prefixes bare www hostnames before opening', () => {
    const { links, onOpen } = makeProvider('open www.example.com/a please')

    links[0].activate(primaryClick)

    expect(onOpen).toHaveBeenCalledWith('http://www.example.com/a')
  })

  it('reports hover and clears on leave', () => {
    const { links, onHover } = makeProvider('see https://example.com/docs here')

    links[0].hover()
    expect(onHover).toHaveBeenCalledWith('https://example.com/docs')
    links[0].leave()
    expect(onHover).toHaveBeenCalledWith(null)
  })

  it('yields no links for plain text or missing lines', () => {
    for (const text of ['no links here', undefined]) {
      const { links, onOpen, onMenu, onHover } = makeProvider(text)
      expect(links).toHaveLength(0)
      expect(onOpen).not.toHaveBeenCalled()
      expect(onMenu).not.toHaveBeenCalled()
      expect(onHover).not.toHaveBeenCalled()
    }
  })
})

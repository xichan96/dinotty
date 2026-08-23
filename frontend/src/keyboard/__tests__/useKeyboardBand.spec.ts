import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useKeyboardBand } from '../useKeyboardBand'

// keyboard-plugin-design.md §三 D / Phase 2: the host owns the keyboard
// reservation band. desiredHeight: number reserves a fixed height, 'auto'
// measures the rendered component root via ResizeObserver, undefined leaves
// the band to the provider's own ctx.setDesiredHeight calls.

class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  callback: ResizeObserverCallback
  observed: Element[] = []
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }
  observe(el: Element) {
    this.observed.push(el)
  }
  unobserve() {}
  disconnect() {}
  fire() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function readBand(): string {
  return document.documentElement.style.getPropertyValue('--mkb-height')
}

// happy-dom has no layout engine, so getBoundingClientRect is always 0.
// Mock it to stand in for a rendered keyboard root of the given height.
function elementWithHeight(initial: number) {
  const el = document.createElement('div')
  let height = initial
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 300, height, top: 0, right: 300, bottom: height, left: 0 }) as DOMRect
  document.body.appendChild(el)
  return { el, setHeight: (h: number) => (height = h) }
}

beforeEach(() => {
  MockResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
})

afterEach(() => {
  document.documentElement.style.removeProperty('--mkb-height')
  vi.unstubAllGlobals()
})

async function settle() {
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
}

describe('useKeyboardBand', () => {
  it('reserves a fixed height while visible and releases it when hidden', async () => {
    const visible = ref(true)
    const desiredHeight = ref<number | 'auto' | undefined>(undefined)
    const band = useKeyboardBand({ visible, desiredHeight, hostRef: ref(null) })

    desiredHeight.value = 320
    await nextTick()
    expect(readBand()).toBe('320px')

    visible.value = false
    await nextTick()
    expect(readBand()).toBe('0px')

    visible.value = true
    await nextTick()
    expect(readBand()).toBe('320px')
    expect(band.reserved.value).toBe(320)
  })

  it('measures the rendered root via ResizeObserver when desiredHeight is auto', async () => {
    const { el, setHeight } = elementWithHeight(200)
    const visible = ref(true)
    const desiredHeight = ref<number | 'auto' | undefined>('auto')
    const host = ref<{ $el?: Element | null } | null>(null)
    useKeyboardBand({ visible, desiredHeight, hostRef: host })

    host.value = { $el: el }
    await settle()

    expect(readBand()).toBe('200px')
    expect(MockResizeObserver.instances).toHaveLength(1)
    expect(MockResizeObserver.instances[0].observed).toContain(el)

    setHeight(150)
    MockResizeObserver.instances[0].fire()
    expect(readBand()).toBe('150px')

    visible.value = false
    await nextTick()
    expect(readBand()).toBe('0px')

    visible.value = true
    await nextTick()
    expect(readBand()).toBe('150px')
    el.remove()
  })

  it('releases the band to 0 when an auto keyboard is not rendered', async () => {
    const visible = ref(true)
    const desiredHeight = ref<number | 'auto' | undefined>(undefined)
    useKeyboardBand({ visible, desiredHeight, hostRef: ref(null) })

    desiredHeight.value = 'auto'
    await settle()
    expect(readBand()).toBe('0px')
  })

  it('leaves the band alone when no desiredHeight is declared', async () => {
    const { el } = elementWithHeight(200)
    const visible = ref(true)
    const desiredHeight = ref<number | 'auto' | undefined>(undefined)
    const host = ref<{ $el?: Element | null } | null>(null)
    useKeyboardBand({ visible, desiredHeight, hostRef: host })

    host.value = { $el: el }
    await settle()

    expect(MockResizeObserver.instances).toHaveLength(0)
    expect(readBand()).toBe('')
    el.remove()
  })

  it('switches between providers and resyncs the band', async () => {
    const { el } = elementWithHeight(240)
    const visible = ref(true)
    const desiredHeight = ref<number | 'auto' | undefined>('auto')
    const host = ref<{ $el?: Element | null } | null>(null)
    useKeyboardBand({ visible, desiredHeight, hostRef: host })

    host.value = { $el: el }
    await settle()
    expect(readBand()).toBe('240px')

    // Provider changes to a fixed-height one (no component swap needed to
    // drive sync — the desiredHeight watch re-evaluates the band).
    desiredHeight.value = 300
    await nextTick()
    expect(readBand()).toBe('300px')

    // Back to self-reporting: the host goes hands-off and leaves the var alone.
    document.documentElement.style.setProperty('--mkb-height', '123px')
    desiredHeight.value = undefined
    await nextTick()
    expect(readBand()).toBe('123px')
    el.remove()
  })
})

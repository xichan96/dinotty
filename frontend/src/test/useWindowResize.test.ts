import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useWindowResize } from '../composables/useWindowResize'

const raf = () => new Promise((r) => requestAnimationFrame(r))

function makeHarness(opts: {
  size: { w: number; h: number }
  x: number
  y: number
  minSize?: { w: number; h: number }
  onPersist?: (w: number, h: number) => void
}) {
  const size = ref({ ...opts.size })
  const x = ref(opts.x)
  const y = ref(opts.y)
  let resize: ReturnType<typeof useWindowResize> | null = null
  const Harness = defineComponent({
    setup() {
      resize = useWindowResize({
        size,
        x,
        y,
        minSize: opts.minSize,
        persist: opts.onPersist,
      })
      return () =>
        h('div', {
          class: 'handle',
          onPointerdown: (e: PointerEvent) => resize!.onHandlePointerDown(e),
        })
    },
  })
  return { Harness, size, getResize: () => resize! }
}

function pointerdown(el: Element, x = 0, y = 0) {
  el.dispatchEvent(
    new PointerEvent('pointerdown', {
      button: 0,
      pointerId: 1,
      bubbles: true,
      clientX: x,
      clientY: y,
    })
  )
}

function pointermove(x: number, y: number) {
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y }))
}

function pointerup(x: number, y: number) {
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: y }))
}

describe('useWindowResize', () => {
  beforeEach(() => {
    window.innerWidth = 1280
    window.innerHeight = 800
  })

  it('clampSize shrinks an oversized size to viewport bounds', () => {
    const { Harness, size, getResize } = makeHarness({ size: { w: 2000, h: 1500 }, x: 100, y: 50 })
    mount(Harness)
    expect(size.value.w).toBe(1280 - 100)
    // status bar (~24px, no keyboard vars in test env) eats into the height bound
    expect(size.value.h).toBeLessThanOrEqual(800 - 50)
    expect(size.value.h).toBeGreaterThan(700)
    expect(getResize().resizing.value).toBe(false)
  })

  it('enforces the min-size floor and clamps to viewport during a resize', async () => {
    const { Harness, size } = makeHarness({
      size: { w: 480, h: 360 },
      x: 400,
      y: 100,
      minSize: { w: 380, h: 300 },
    })
    const wrapper = mount(Harness)
    const handle = wrapper.find('.handle').element

    // Shrink past min
    pointerdown(handle, 400, 100)
    pointermove(100, -100) // -300w / -200h from start
    await raf()
    expect(size.value).toEqual({ w: 380, h: 300 })

    // Grow past the viewport bound (vw 1280 - x 400 = 880; vh 800 - y 100 - sb)
    pointermove(2000, 2000)
    await raf()
    expect(size.value.w).toBe(880)
    expect(size.value.h).toBeLessThanOrEqual(800 - 100 - 24)

    pointerup(2000, 2000)
  })

  it('persists the final clamped size on settle, not on cancel', async () => {
    const persisted: Array<{ w: number; h: number }> = []
    const { Harness } = makeHarness({
      size: { w: 480, h: 360 },
      x: 0,
      y: 0,
      onPersist: (w, h) => persisted.push({ w, h }),
    })
    const wrapper = mount(Harness)
    const handle = wrapper.find('.handle').element

    pointerdown(handle, 0, 0)
    pointermove(520, 240)
    await raf()
    pointerup(520, 240)
    expect(persisted).toEqual([{ w: 1000, h: 600 }])

    pointerdown(handle, 0, 0)
    pointermove(600, 300)
    await raf()
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }))
    expect(persisted).toHaveLength(1)
  })

  it('re-clamps the live size when the window shrinks', () => {
    const { Harness, size } = makeHarness({ size: { w: 480, h: 360 }, x: 0, y: 0 })
    mount(Harness)
    window.innerWidth = 400
    window.dispatchEvent(new Event('resize'))
    expect(size.value.w).toBe(400)
  })
})

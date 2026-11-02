import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import ImagePreview from '../components/workspace/ImagePreview.vue'
import type { ImageViewMode } from '../utils/imageZoom'

const STAGE = '[data-testid="image-preview-stage"]'
const IMAGE = '[data-testid="image-preview-img"]'
const ZOOM_LEVEL = '[data-testid="image-preview-zoom-level"]'

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = []
  callback: ResizeObserverCallback
  targets: Element[] = []

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverStub.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.push(target)
  }

  unobserve(): void {}

  disconnect(): void {
    this.targets = []
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}

type PreviewWrapper = ReturnType<typeof mountPreview>
type PreviewVm = {
  scale: number
  mode: ImageViewMode
  fitToWindow: () => void
  actualSize: () => void
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
}

type PointerInit = {
  id: number
  x: number
  y: number
  pointerType?: 'mouse' | 'touch'
  button?: number
}

function mountPreview(props: Record<string, unknown> = {}) {
  return mount(ImagePreview, {
    props: {
      src: '/api/workspace/raw?path=photo.png',
      alt: 'photo',
      fileKey: 'photo.png',
      ...props,
    },
    attachTo: document.body,
  })
}

function stageOf(wrapper: PreviewWrapper): HTMLElement {
  return wrapper.get(STAGE).element as HTMLElement
}

function vmOf(wrapper: PreviewWrapper): PreviewVm {
  return wrapper.vm as unknown as PreviewVm
}

function setViewport(wrapper: PreviewWrapper, width: number, height: number): void {
  Object.defineProperty(stageOf(wrapper), 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }),
  })
}

function triggerResize(): void {
  const observer = ResizeObserverStub.instances[ResizeObserverStub.instances.length - 1]
  observer?.trigger()
}

async function loadImage(wrapper: PreviewWrapper, width: number, height: number): Promise<void> {
  const image = wrapper.get(IMAGE)
  Object.defineProperties(image.element, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  })
  await image.trigger('load')
  await nextTick()
}

function dispatchPointer(target: Element, type: string, init: PointerInit): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: init.id },
    pointerType: { value: init.pointerType ?? 'mouse' },
    button: { value: init.button ?? 0 },
    clientX: { value: init.x },
    clientY: { value: init.y },
  })
  target.dispatchEvent(event)
  return event
}

function dispatchWheel(
  target: Element,
  init: WheelEventInit
): WheelEvent & { defaultPrevented: boolean } {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  // happy-dom's WheelEvent extends UIEvent, so MouseEvent's modifiers and
  // coordinates are not copied from the init object.
  Object.defineProperties(event, {
    ctrlKey: { value: init.ctrlKey ?? false },
    metaKey: { value: init.metaKey ?? false },
    clientX: { value: init.clientX ?? 0 },
    clientY: { value: init.clientY ?? 0 },
  })
  target.dispatchEvent(event)
  return event
}

function dispatchKey(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

function transformOf(wrapper: PreviewWrapper): { tx: number; ty: number; scale: number } {
  const raw = (wrapper.get(IMAGE).element as HTMLElement).style.transform
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\((-?[\d.]+)\)/.exec(raw)
  if (!match) throw new Error(`Unexpected transform: ${raw}`)
  return { tx: Number(match[1]), ty: Number(match[2]), scale: Number(match[3]) }
}

beforeEach(() => {
  ResizeObserverStub.instances = []
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('ImagePreview', () => {
  it('fits large images on load and reports the zoom level', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)

    expect(vmOf(wrapper).scale).toBeCloseTo(0.5)
    expect(vmOf(wrapper).mode).toBe('fit')
    expect(wrapper.get(ZOOM_LEVEL).text()).toBe('50%')
    expect(transformOf(wrapper)).toMatchObject({ tx: 0, ty: 0 })
    wrapper.unmount()
  })

  it('does not upscale small images at fit', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 32, 32)

    expect(vmOf(wrapper).scale).toBe(1)
    expect(wrapper.get(ZOOM_LEVEL).text()).toBe('100%')
    wrapper.unmount()
  })

  it('steps zoom with the toolbar buttons', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)

    await wrapper.get('[data-testid="image-preview-zoom-in"]').trigger('click')
    expect(vmOf(wrapper).scale).toBeCloseTo(0.625)
    expect(vmOf(wrapper).mode).toBe('manual')
    expect(wrapper.get(ZOOM_LEVEL).text()).toBe('63%')

    await wrapper.get('[data-testid="image-preview-zoom-out"]').trigger('click')
    expect(vmOf(wrapper).scale).toBeCloseTo(0.5)
    wrapper.unmount()
  })

  it('switches between actual size and fit', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)

    await wrapper.get('[data-testid="image-preview-actual"]').trigger('click')
    expect(vmOf(wrapper).scale).toBe(1)
    expect(vmOf(wrapper).mode).toBe('actual')

    await wrapper.get('[data-testid="image-preview-fit"]').trigger('click')
    expect(vmOf(wrapper).scale).toBeCloseTo(0.5)
    expect(vmOf(wrapper).mode).toBe('fit')
    wrapper.unmount()
  })

  it('recomputes the fit scale when the viewport resizes', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)
    expect(vmOf(wrapper).scale).toBeCloseTo(0.5)

    setViewport(wrapper, 400, 300)
    triggerResize()
    await nextTick()

    expect(vmOf(wrapper).scale).toBeCloseTo(0.25)
    expect(vmOf(wrapper).mode).toBe('fit')
    wrapper.unmount()
  })

  it('clamps the offset when a manual zoom is resized', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)

    await wrapper.get('[data-testid="image-preview-zoom-in"]').trigger('click')
    await wrapper.get('[data-testid="image-preview-zoom-in"]').trigger('click')
    expect(vmOf(wrapper).scale).toBeCloseTo(0.78125)

    const stage = stageOf(wrapper)
    dispatchPointer(stage, 'pointerdown', { id: 1, x: 400, y: 300 })
    dispatchPointer(stage, 'pointermove', { id: 1, x: -2000, y: -2000 })
    dispatchPointer(stage, 'pointerup', { id: 1, x: -2000, y: -2000 })
    await nextTick()
    expect(transformOf(wrapper)).toMatchObject({ tx: -225, ty: -168.75 })

    setViewport(wrapper, 1200, 900)
    triggerResize()
    await nextTick()

    expect(vmOf(wrapper).scale).toBeCloseTo(0.78125)
    expect(transformOf(wrapper).tx).toBeCloseTo(-25)
    expect(transformOf(wrapper).ty).toBeCloseTo(-18.75)
    wrapper.unmount()
  })

  it('toggles fit <-> 1:1 on double click', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)

    await wrapper.get(STAGE).trigger('dblclick')
    expect(vmOf(wrapper).scale).toBe(1)
    expect(vmOf(wrapper).mode).toBe('actual')

    await wrapper.get(STAGE).trigger('dblclick')
    expect(vmOf(wrapper).scale).toBeCloseTo(0.5)
    expect(vmOf(wrapper).mode).toBe('fit')
    wrapper.unmount()
  })

  it('zooms with Ctrl+wheel around the pointer without drift', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)

    const event = dispatchWheel(stageOf(wrapper), {
      deltaY: -100,
      ctrlKey: true,
      clientX: 600,
      clientY: 300,
    })
    await nextTick()

    expect(event.defaultPrevented).toBe(true)
    const { scale, tx } = transformOf(wrapper)
    expect(scale).toBeGreaterThan(0.5)
    // Focal point is 200px right of the viewport centre; image coordinate 400.
    expect((200 - tx) / scale).toBeCloseTo(400)
    wrapper.unmount()
  })

  it('pans with a plain wheel only after zooming in', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)

    const atFit = dispatchWheel(stageOf(wrapper), { deltaY: 100 })
    await nextTick()
    expect(atFit.defaultPrevented).toBe(false)
    expect(vmOf(wrapper).scale).toBeCloseTo(0.5)

    await wrapper.get('[data-testid="image-preview-actual"]').trigger('click')
    const zoomed = dispatchWheel(stageOf(wrapper), { deltaY: 100 })
    await nextTick()

    expect(zoomed.defaultPrevented).toBe(true)
    expect(transformOf(wrapper).ty).toBeCloseTo(-100)
    wrapper.unmount()
  })

  it('pans by dragging and shows the grabbing cursor', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)
    await wrapper.get('[data-testid="image-preview-actual"]').trigger('click')

    const stage = stageOf(wrapper)
    dispatchPointer(stage, 'pointerdown', { id: 1, x: 400, y: 300 })
    dispatchPointer(stage, 'pointermove', { id: 1, x: 300, y: 250 })
    await nextTick()

    expect(transformOf(wrapper)).toMatchObject({ tx: -100, ty: -50, scale: 1 })
    expect(stage.classList.contains('is-dragging')).toBe(true)

    dispatchPointer(stage, 'pointerup', { id: 1, x: 300, y: 250 })
    await nextTick()
    expect(stage.classList.contains('is-dragging')).toBe(false)
    wrapper.unmount()
  })

  it('detects a touch double tap and toggles the zoom', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)

    const stage = stageOf(wrapper)
    dispatchPointer(stage, 'pointerdown', { id: 1, x: 400, y: 300, pointerType: 'touch' })
    dispatchPointer(stage, 'pointerup', { id: 1, x: 400, y: 300, pointerType: 'touch' })
    now += 100
    dispatchPointer(stage, 'pointerdown', { id: 2, x: 402, y: 301, pointerType: 'touch' })
    dispatchPointer(stage, 'pointerup', { id: 2, x: 402, y: 301, pointerType: 'touch' })
    await nextTick()

    expect(vmOf(wrapper).mode).toBe('actual')
    expect(vmOf(wrapper).scale).toBe(1)
    wrapper.unmount()
  })

  it('pinch-zooms with two touch pointers', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)
    await wrapper.get('[data-testid="image-preview-actual"]').trigger('click')

    const stage = stageOf(wrapper)
    dispatchPointer(stage, 'pointerdown', { id: 1, x: 300, y: 300, pointerType: 'touch' })
    dispatchPointer(stage, 'pointerdown', { id: 2, x: 500, y: 300, pointerType: 'touch' })
    dispatchPointer(stage, 'pointermove', { id: 2, x: 700, y: 300, pointerType: 'touch' })
    await nextTick()

    const transform = transformOf(wrapper)
    expect(transform.scale).toBeCloseTo(2)
    expect(transform.tx).toBeCloseTo(100)
    expect(vmOf(wrapper).mode).toBe('manual')
    wrapper.unmount()
  })

  it('resets the view when fileKey changes', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)
    await wrapper.get('[data-testid="image-preview-zoom-in"]').trigger('click')
    expect(vmOf(wrapper).scale).toBeCloseTo(0.625)

    await wrapper.setProps({ fileKey: 'other.png', src: '/api/workspace/raw?path=other.png' })
    await nextTick()

    expect(vmOf(wrapper).scale).toBe(1)
    expect(vmOf(wrapper).mode).toBe('fit')
    expect(transformOf(wrapper)).toMatchObject({ tx: 0, ty: 0 })

    await loadImage(wrapper, 32, 32)
    expect(vmOf(wrapper).scale).toBe(1)
    wrapper.unmount()
  })

  it('keeps the zoom when only the source changes for the same fileKey', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)
    await wrapper.get('[data-testid="image-preview-zoom-in"]').trigger('click')

    await wrapper.setProps({ src: '/api/workspace/raw?path=photo.svg&rev=2' })
    await loadImage(wrapper, 800, 600)

    expect(vmOf(wrapper).scale).toBeCloseTo(0.625)
    expect(vmOf(wrapper).mode).toBe('manual')
    wrapper.unmount()
  })

  it('shows the load failure message and disables the controls', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await wrapper.get(IMAGE).trigger('error')
    await nextTick()

    expect(wrapper.get('[data-testid="image-preview-error"]').text()).toBe(
      'Could not load this image'
    )
    expect(
      wrapper.get('[data-testid="image-preview-zoom-in"]').attributes('disabled')
    ).toBeDefined()
    wrapper.unmount()
  })

  it('handles keyboard zoom, fit, 1:1 and arrow panning', async () => {
    const wrapper = mountPreview()
    setViewport(wrapper, 800, 600)
    await loadImage(wrapper, 1600, 1200)
    const stage = stageOf(wrapper)

    expect(dispatchKey(stage, '+').defaultPrevented).toBe(true)
    expect(vmOf(wrapper).scale).toBeCloseTo(0.625)

    dispatchKey(stage, '-')
    expect(vmOf(wrapper).scale).toBeCloseTo(0.5)

    dispatchKey(stage, '1')
    expect(vmOf(wrapper).scale).toBe(1)
    expect(vmOf(wrapper).mode).toBe('actual')

    dispatchKey(stage, 'ArrowRight')
    await nextTick()
    expect(transformOf(wrapper).tx).toBeCloseTo(40)

    dispatchKey(stage, '0')
    await nextTick()
    expect(vmOf(wrapper).scale).toBeCloseTo(0.5)
    expect(vmOf(wrapper).mode).toBe('fit')
    expect(transformOf(wrapper)).toMatchObject({ tx: 0, ty: 0 })
    wrapper.unmount()
  })
})

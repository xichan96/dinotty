import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncOpenFileViewer } from '../types/protocol'
import { useFileViewerStore } from '../stores/fileViewerStore'

/**
 * The overlay is the web/mobile shell for a viewer request. It must render
 * above everything, own Escape, and hand focus back to where it came from —
 * losing focus inside a lazy-loaded Monaco mount would strand keyboard users.
 */

vi.mock('../components/preview/FileViewer.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'FileViewer',
      props: {
        sourcePaneId: { type: String, required: true },
        path: { type: String, required: true },
        title: { type: String, default: undefined },
      },
      setup(props) {
        return () =>
          h('div', {
            class: 'file-viewer-stub',
            'data-pane': props.sourcePaneId,
            'data-path': props.path,
            'data-title': props.title ?? '',
          })
      },
    }),
  }
})

import FileViewerOverlay from '../components/preview/FileViewerOverlay.vue'

function request(overrides: Partial<SyncOpenFileViewer> = {}): SyncOpenFileViewer {
  return {
    type: 'open_file_viewer',
    request_id: 'req-1',
    pane_id: 'pane-1',
    path: '/tmp/docs/readme.md',
    ...overrides,
  }
}

function overlayEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.file-viewer-overlay')
}

function closeButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('.file-viewer-overlay__close')!
}

let wrapper: ReturnType<typeof mount> | null = null

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('FileViewerOverlay', () => {
  it('renders nothing until a request arrives', () => {
    wrapper = mount(FileViewerOverlay, { attachTo: document.body })

    expect(overlayEl()).toBeNull()
  })

  it('teleports the viewer into body with the request payload', async () => {
    useFileViewerStore().show(request({ title: 'Release notes' }))
    wrapper = mount(FileViewerOverlay, { attachTo: document.body })
    await nextTick()

    expect(overlayEl()).not.toBeNull()
    expect(overlayEl()!.parentElement).toBe(document.body)
    expect(document.querySelector('.file-viewer-overlay__title')?.textContent).toBe(
      'Release notes'
    )
    const stub = document.querySelector<HTMLElement>('.file-viewer-stub')!
    expect(stub.dataset).toMatchObject({
      pane: 'pane-1',
      path: '/tmp/docs/readme.md',
      title: 'Release notes',
    })
  })

  it('falls back to the file name when the request has no title', async () => {
    useFileViewerStore().show(request({ title: undefined }))
    wrapper = mount(FileViewerOverlay, { attachTo: document.body })
    await nextTick()

    expect(document.querySelector('.file-viewer-overlay__title')?.textContent).toBe('readme.md')
  })

  it('focuses the close button on open', async () => {
    useFileViewerStore().show(request())
    wrapper = mount(FileViewerOverlay, { attachTo: document.body })
    await nextTick()
    await flushPromises()

    expect(document.activeElement).toBe(closeButton())
  })

  it('closes on the close button', async () => {
    const store = useFileViewerStore()
    store.show(request())
    wrapper = mount(FileViewerOverlay, { attachTo: document.body })
    await nextTick()

    closeButton().click()
    await nextTick()

    expect(store.request).toBeNull()
    expect(overlayEl()).toBeNull()
  })

  it('closes on Escape and restores the previous focus', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const store = useFileViewerStore()
    store.show(request())
    wrapper = mount(FileViewerOverlay, { attachTo: document.body })
    await nextTick()
    await flushPromises()
    expect(document.activeElement).toBe(closeButton())

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    await flushPromises()

    expect(store.request).toBeNull()
    expect(overlayEl()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps other keys from closing the overlay', async () => {
    const store = useFileViewerStore()
    store.show(request())
    wrapper = mount(FileViewerOverlay, { attachTo: document.body })
    await nextTick()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await nextTick()

    expect(store.request).not.toBeNull()
  })

  it('remounts the viewer when a newer request replaces the current one', async () => {
    const store = useFileViewerStore()
    store.show(request({ request_id: 'req-1', path: '/tmp/a.md' }))
    wrapper = mount(FileViewerOverlay, { attachTo: document.body })
    await nextTick()

    store.show(request({ request_id: 'req-2', path: '/tmp/b.md' }))
    await nextTick()

    expect(document.querySelector<HTMLElement>('.file-viewer-stub')!.dataset.path).toBe(
      '/tmp/b.md'
    )
  })
})

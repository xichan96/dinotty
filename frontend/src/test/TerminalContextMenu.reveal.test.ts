import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(() => false), isLocalActive: vi.fn(() => true) }))

vi.mock('../composables/useTransport', () => ({ isTauri: mocks.isTauri }))
vi.mock('../composables/activeServer', () => ({ isLocalActive: mocks.isLocalActive }))
vi.mock('../composables/useSettings', () => ({
  useSettings: () => ({ settings: { bookmarks: [] }, saveSettings: vi.fn() }),
}))
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'terminal.ctxOpenFile': 'Open in File Browser',
        'terminal.ctxRevealInFileManager': 'Reveal in File Manager',
      })[key] ?? key,
  }),
}))
vi.mock('../composables/useKeybindings', () => ({
  useKeybindings: () => ({
    getBinding: () => ({ key: '' }),
    formatBinding: () => [],
  }),
}))
vi.mock('../utils/clipboard', () => ({ copyToClipboard: vi.fn() }))
vi.mock('vue-toastification', () => ({ useToast: () => ({ success: vi.fn() }) }))

import TerminalContextMenu from '../components/terminal/TerminalContextMenu.vue'

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(TerminalContextMenu, {
    props: {
      visible: true,
      x: 20,
      y: 20,
      selectedText: '',
      linkType: 'file',
      linkTarget: '/var/log/system.log',
      paneId: 'pane-1',
      ...props,
    },
    global: { stubs: { Teleport: true } },
  })
}

function findRevealButton(wrapper: ReturnType<typeof mountMenu>) {
  return wrapper
    .findAll('button')
    .find((button) => button.text().includes('Reveal in File Manager'))
}

describe('TerminalContextMenu reveal in file manager', () => {
  beforeEach(() => {
    mocks.isTauri.mockReset()
    mocks.isLocalActive.mockReset()
    mocks.isTauri.mockReturnValue(false)
    mocks.isLocalActive.mockReturnValue(true)
  })

  it('shows and emits for local desktop file links', async () => {
    mocks.isTauri.mockReturnValue(true)
    mocks.isLocalActive.mockReturnValue(true)
    const wrapper = mountMenu()

    const reveal = findRevealButton(wrapper)
    expect(reveal).toBeDefined()
    await reveal!.trigger('click')

    expect(wrapper.emitted('revealFile')).toEqual([['/var/log/system.log']])
    wrapper.unmount()
  })

  it('omits the item for remote web clients', () => {
    mocks.isTauri.mockReturnValue(false)
    const wrapper = mountMenu()

    expect(findRevealButton(wrapper)).toBeUndefined()
    expect(wrapper.text()).toContain('Open in File Browser')
    wrapper.unmount()
  })

  it('omits the item when the active server is remote', () => {
    mocks.isTauri.mockReturnValue(true)
    mocks.isLocalActive.mockReturnValue(false)
    const wrapper = mountMenu()

    expect(findRevealButton(wrapper)).toBeUndefined()
    wrapper.unmount()
  })

  it('omits the item for SSH panes', () => {
    mocks.isTauri.mockReturnValue(true)
    mocks.isLocalActive.mockReturnValue(true)
    const wrapper = mountMenu({ isSsh: true })

    expect(findRevealButton(wrapper)).toBeUndefined()
    wrapper.unmount()
  })

  it('omits the item for non-file links', () => {
    mocks.isTauri.mockReturnValue(true)
    const wrapper = mountMenu({ linkType: 'link', linkTarget: 'https://example.com' })

    expect(findRevealButton(wrapper)).toBeUndefined()
    wrapper.unmount()
  })
})

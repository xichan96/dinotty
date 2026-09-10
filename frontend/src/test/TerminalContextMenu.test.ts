import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(() => false) }))

vi.mock('../composables/useTransport', () => ({ isTauri: mocks.isTauri }))
vi.mock('../composables/useSettings', () => ({
  useSettings: () => ({ settings: { bookmarks: [] }, saveSettings: vi.fn() }),
}))
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'terminal.ctxOpenInBrowser': 'Open in System Browser',
        'terminal.ctxOpenLink': 'Open in Preview',
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

function mountMenu() {
  return mount(TerminalContextMenu, {
    props: {
      visible: true,
      x: 20,
      y: 20,
      selectedText: '',
      linkType: 'link',
      linkTarget: 'https://example.com',
      paneId: 'pane-1',
    },
    global: { stubs: { Teleport: true } },
  })
}

describe('TerminalContextMenu link actions', () => {
  beforeEach(() => mocks.isTauri.mockReset())

  it('shows system-browser opening before preview only in the local desktop app', async () => {
    mocks.isTauri.mockReturnValue(true)
    const wrapper = mountMenu()
    const actions = wrapper.findAll('button').map((button) => button.text())

    expect(actions.indexOf('Open in System Browser')).toBeLessThan(actions.indexOf('Open in Preview'))
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('openInBrowser')).toEqual([['https://example.com']])
    wrapper.unmount()
  })

  it('omits system-browser opening for remote web clients', () => {
    mocks.isTauri.mockReturnValue(false)
    const wrapper = mountMenu()

    expect(wrapper.text()).not.toContain('Open in System Browser')
    expect(wrapper.text()).toContain('Open in Preview')
    wrapper.unmount()
  })
})

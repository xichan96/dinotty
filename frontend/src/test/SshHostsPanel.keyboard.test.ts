import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { SshProfile } from '../composables/useSettings'

const tabApiMocks = vi.hoisted(() => ({
  apiCreateSshTab: vi.fn(),
  apiCreateSshQuickTab: vi.fn(),
}))

const settingsMocks = vi.hoisted(() => {
  const settings = {
    ssh_profiles: [] as SshProfile[],
  }
  return {
    settings,
    saveSettings: vi.fn(),
  }
})

vi.mock('../composables/useTabApi', () => ({
  apiCreateSshTab: tabApiMocks.apiCreateSshTab,
  apiCreateSshQuickTab: tabApiMocks.apiCreateSshQuickTab,
}))

vi.mock('../composables/useSettings', async () => {
  return {
    settings: settingsMocks.settings,
    saveSettings: settingsMocks.saveSettings,
  }
})

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

interface PanelVm {
  open: () => void
}

async function mountPanel() {
  const { default: SshHostsPanel } = await import('../components/ssh/SshHostsPanel.vue')
  return mount(SshHostsPanel, {
    attachTo: document.body,
  })
}

function makeProfile(id: string, name: string, host: string, group?: string): SshProfile {
  return {
    id,
    name,
    host,
    port: 22,
    username: 'root',
    auth_method: { type: 'password', password: 'secret' },
    group: group || null,
  }
}

function keydown(input: HTMLInputElement, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  input.dispatchEvent(event)
}

describe('SshHostsPanel keyboard navigation', () => {
  beforeEach(() => {
    settingsMocks.settings.ssh_profiles = [
      makeProfile('p1', 'Alpha', 'alpha.example.com', 'prod'),
      makeProfile('p2', 'Beta', 'beta.example.com', 'prod'),
      makeProfile('p3', 'Gamma', 'gamma.example.com', 'dev'),
    ]
    tabApiMocks.apiCreateSshTab.mockReset()
    tabApiMocks.apiCreateSshQuickTab.mockReset()
  })

  it('opens with the first profile selected', async () => {
    const wrapper = await mountPanel()
    ;(wrapper.vm as unknown as PanelVm).open()
    await flushPromises()

    const items = document.querySelectorAll('.ssh-item')
    expect(items.length).toBe(3)
    expect(items[0].classList.contains('active')).toBe(true)
    wrapper.unmount()
  })

  it('moves selection down and up with arrow keys', async () => {
    const wrapper = await mountPanel()
    ;(wrapper.vm as unknown as PanelVm).open()
    await flushPromises()

    const input = document.querySelector('.ssh-search-input') as HTMLInputElement
    expect(input).not.toBeNull()

    keydown(input, 'ArrowDown')
    await flushPromises()

    const items = document.querySelectorAll('.ssh-item')
    expect(items[0].classList.contains('active')).toBe(false)
    expect(items[1].classList.contains('active')).toBe(true)

    keydown(input, 'ArrowUp')
    await flushPromises()

    expect(items[0].classList.contains('active')).toBe(true)
    expect(items[1].classList.contains('active')).toBe(false)
    wrapper.unmount()
  })

  it('wraps selection around at list boundaries', async () => {
    const wrapper = await mountPanel()
    ;(wrapper.vm as unknown as PanelVm).open()
    await flushPromises()

    const input = document.querySelector('.ssh-search-input') as HTMLInputElement

    keydown(input, 'ArrowUp')
    await flushPromises()

    const items = document.querySelectorAll('.ssh-item')
    expect(items[2].classList.contains('active')).toBe(true)

    keydown(input, 'ArrowDown')
    await flushPromises()

    expect(items[0].classList.contains('active')).toBe(true)
    wrapper.unmount()
  })

  it('connects the selected profile on Enter', async () => {
    tabApiMocks.apiCreateSshTab.mockResolvedValue({
      tab_id: 'tab-1',
      pane_id: 'pane-1',
      layout: { id: 'pane-1', type: 'leaf' },
    })

    const wrapper = await mountPanel()
    ;(wrapper.vm as unknown as PanelVm).open()
    await flushPromises()

    const input = document.querySelector('.ssh-search-input') as HTMLInputElement
    keydown(input, 'ArrowDown')
    await flushPromises()

    keydown(input, 'Enter')
    await flushPromises()

    expect(tabApiMocks.apiCreateSshTab).toHaveBeenCalledWith('p2', undefined, undefined, expect.any(AbortSignal))
    wrapper.unmount()
  })

  it('filters and resets selection when typing in the search box', async () => {
    const wrapper = await mountPanel()
    ;(wrapper.vm as unknown as PanelVm).open()
    await flushPromises()

    const input = document.querySelector('.ssh-search-input') as HTMLInputElement
    input.value = 'gamma'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    const items = document.querySelectorAll('.ssh-item')
    expect(items.length).toBe(1)
    expect(items[0].classList.contains('active')).toBe(true)
    wrapper.unmount()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// The chip is the *only* switch entry, so this file is where its contract
// lives: always present, fixed-width, and driving the same roster everywhere.
const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  activeId: '__local__',
  switchServer: vi.fn(),
}))

vi.mock('../composables/activeServer', async () => {
  const actual = await vi.importActual<typeof import('../composables/activeServer')>(
    '../composables/activeServer'
  )
  return {
    ...actual,
    activeServerId: () => mocks.activeId,
    LOCAL_SERVER_ID: '__local__',
    switchServer: mocks.switchServer,
  }
})

// Spread the real module: `uiStore` and friends reach for other members of it
// (`hasAuthToken`), and only the fetch itself needs to be a stub.
vi.mock('../composables/apiBase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../composables/apiBase')>()),
  authFetch: mocks.authFetch,
  hubApiUrl: (p: string) => p,
}))

// `activeServerIdRef` / `serverPickerOpen` are the reactive mirrors the real
// module keeps; the local ones here are the same shape, so the component under
// test is the real one.
vi.mock('../composables/useAppCore', async () => {
  const { ref } = await import('vue')
  const activeServerIdRef = ref('__local__')
  const serverPickerOpen = ref(false)
  return {
    activeServerIdRef,
    serverPickerOpen,
    toggleServerPicker: () => {
      serverPickerOpen.value = !serverPickerOpen.value
    },
    closeServerPicker: () => {
      serverPickerOpen.value = false
    },
  }
})

vi.mock('../composables/useSettings', async () => {
  const { reactive } = await import('vue')
  // `locale: 'en'` so the assertions can be written against real strings rather
  // than against whatever `normalizeLocale` would do with an absent locale.
  const settings = reactive({
    locale: 'en',
    monitor: { enabled: true, cpu: true, memory: true, disk: false, network: true },
  })
  return { settings, useSettings: () => ({ settings }) }
})

// The bar is not about the samples themselves - only about whether the items
// beside the chip are gated by the master switch.
vi.mock('../composables/useMonitor', async () => {
  const { ref } = await import('vue')
  return {
    monitorData: ref(null),
    cpuHistory: ref([]),
    memHistory: ref([]),
    netRxHistory: ref([]),
    netTxHistory: ref([]),
    gpuUtilHistory: ref([]),
    gpuMemHistory: ref([]),
  }
})

import StatusBar from '../components/terminal/StatusBar.vue'
import { activeServerIdRef, serverPickerOpen } from '../composables/useAppCore'
import { refreshRemoteServers } from '../composables/useRemoteServers'
import { settings } from '../composables/useSettings'
import { useUiStore } from '../stores/uiStore'

const REMOTE = {
  id: 'board',
  name: 'Lab board',
  url: 'http://192.168.1.5:58901',
  has_token: true,
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

async function mountBar() {
  const wrapper = mount(StatusBar, { attachTo: document.body })
  await nextTick()
  return wrapper
}

/** Open the picker the way a user does. */
async function openPicker(wrapper: any) {
  await wrapper.find('.status-bar-server').trigger('click')
  await nextTick()
}

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }))
}

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useUiStore().syncConnected = true
  mocks.activeId = '__local__'
  mocks.switchServer.mockResolvedValue({ ok: true })
  settings.monitor.enabled = true
  activeServerIdRef.value = '__local__'
  serverPickerOpen.value = false
  mocks.authFetch.mockResolvedValue(jsonResponse([REMOTE]))
  await refreshRemoteServers()
})

describe('status bar server chip', () => {
  it('is present on the local server, where there is nothing to switch away from', async () => {
    const wrapper = await mountBar()

    expect(wrapper.find('.status-bar').exists()).toBe(true)
    expect(wrapper.find('.status-bar-server').exists()).toBe(true)
    expect(wrapper.find('.server-name').text()).toBe('LOC')
  })

  // The bar used to disappear when the monitor was switched off. It cannot any
  // more: that would take the switch entry with it.
  it('stays put when monitor items are switched off', async () => {
    settings.monitor.enabled = false
    const wrapper = await mountBar()
    await nextTick()

    expect(wrapper.find('.status-bar').exists()).toBe(true)
    expect(wrapper.find('.status-bar-server').exists()).toBe(true)
    expect(wrapper.find('.status-bar-right').text()).not.toContain('CPU')
  })

  it('shows the server it is on, and marks the row', async () => {
    activeServerIdRef.value = 'board'
    const wrapper = await mountBar()

    expect(wrapper.find('.server-name').text()).toBe('Lab board')

    await openPicker(wrapper)
    const rows = wrapper.findAll('.server-option')
    expect(rows).toHaveLength(2)
    expect(rows[1].find('.server-option-tag').text()).toBe('Current')
    // The lock is the one fact the roster endpoint cannot carry on its own.
    expect(rows[1].find('.server-option-lock').exists()).toBe(true)
  })

  it('falls back to "unknown" when the active id left the roster', async () => {
    activeServerIdRef.value = 'gone'
    const wrapper = await mountBar()

    expect(wrapper.find('.server-name').text()).toBe('Unknown server')
    expect(wrapper.find('.server-name').classes()).toContain('stale')
  })

  it('switches when a row is clicked', async () => {
    const wrapper = await mountBar()
    await openPicker(wrapper)

    await wrapper.findAll('.server-option')[1].trigger('click')
    await nextTick()

    expect(mocks.switchServer).toHaveBeenCalledWith('board')
    expect(serverPickerOpen.value).toBe(false)
  })

  // Without the cursor, opening the picker with `s` from Mission Control would
  // leave the keyboard with no way to pick anything.
  it('picks from the keyboard', async () => {
    const wrapper = await mountBar()
    await openPicker(wrapper)

    pressKey('ArrowDown')
    await nextTick()
    expect(wrapper.findAll('.server-option')[1].classes()).toContain('active')

    pressKey('Enter')
    await nextTick()
    expect(mocks.switchServer).toHaveBeenCalledWith('board')
  })

  it('leaves the cursor on the active entry when it opens', async () => {
    activeServerIdRef.value = 'board'
    const wrapper = await mountBar()
    await openPicker(wrapper)

    expect(wrapper.findAll('.server-option')[1].classes()).toContain('active')
    // Down from the last row wraps back to the first.
    pressKey('ArrowDown')
    await nextTick()
    expect(wrapper.findAll('.server-option')[0].classes()).toContain('active')
  })

  it('closes on Escape without switching', async () => {
    const wrapper = await mountBar()
    await openPicker(wrapper)

    pressKey('Escape')
    await nextTick()

    expect(serverPickerOpen.value).toBe(false)
    expect(mocks.switchServer).not.toHaveBeenCalled()
  })

  // Mission Control's backdrop sits at 2000, so the picker is unreachable from
  // its disconnected panel unless the whole bar rides above it.
  it('rides above an overlay while the picker is open', async () => {
    const wrapper = await mountBar()
    expect(wrapper.find('.status-bar').classes()).not.toContain('is-elevated')

    await openPicker(wrapper)

    expect(wrapper.find('.status-bar').classes()).toContain('is-elevated')
  })
})

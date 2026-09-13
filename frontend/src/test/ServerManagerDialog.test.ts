import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  switchServer: vi.fn(),
  uiConfirm: vi.fn(),
  activeId: 'a',
}))

vi.mock('../composables/apiBase', () => ({
  authFetch: mocks.authFetch,
  hubApiUrl: (p: string) => p,
}))

vi.mock('../composables/activeServer', () => ({
  LOCAL_SERVER_ID: '__local__',
  activeServerId: () => mocks.activeId,
  switchServer: mocks.switchServer,
}))

vi.mock('../composables/useConfirm', () => ({
  uiConfirm: mocks.uiConfirm,
}))

vi.mock('vue-toastification', () => ({
  useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}))

import ServerManagerDialog from '../components/server/ServerManagerDialog.vue'
import { refreshRemoteServers } from '../composables/useRemoteServers'
import {
  closeServerManager,
  managerOpen,
  openServerManager,
} from '../composables/useRemoteServerAdmin'

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

const LAB = { id: 'a', name: 'Lab board', url: 'http://192.168.1.5:58901', has_token: true }
const ATTIC = { id: 'b', name: 'Attic', url: 'http://192.168.1.9:58901', has_token: false }

/** The hub, answering the roster read and the roster write separately. */
function hub(entries: unknown[], putResult: { body: unknown; status: number } = { body: {}, status: 200 }) {
  mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return jsonResponse(putResult.body, putResult.status)
    }
    return jsonResponse(entries)
  })
}

/** Calls in the order they reached the transport, for ordering assertions. */
let order: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  order = []
  mocks.activeId = 'a'
  mocks.switchServer.mockResolvedValue({ ok: true, id: '__local__' })
  mocks.uiConfirm.mockResolvedValue(true)
  closeServerManager()
  hub([LAB, ATTIC])
})

async function openManager() {
  await refreshRemoteServers()
  openServerManager()
  const wrapper = mount(ServerManagerDialog, {
    // The dialog teleports to <body>; rendering it inline keeps the queries
    // below on the wrapper.
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  return wrapper
}

const ROW = '.srv-mgr-row'
const SAVE = '.dialog-btn--primary'

function putBody(): Record<string, unknown>[] {
  const call = mocks.authFetch.mock.calls.find(
    ([, init]) => (init as RequestInit)?.method === 'PUT'
  )
  if (!call) throw new Error('no PUT was made')
  return JSON.parse(String((call[1] as RequestInit).body))
}

function probeBody(): Record<string, unknown> {
  const call = mocks.authFetch.mock.calls.find(([url]) => String(url).endsWith('/probe'))
  if (!call) throw new Error('no probe was made')
  return JSON.parse(String((call[1] as RequestInit).body))
}

describe('ServerManagerDialog', () => {
  it('lists the local device as a fixed row alongside the roster', async () => {
    const wrapper = await openManager()

    const rows = wrapper.findAll(ROW)
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('LOC')
    expect(rows[1].text()).toContain('Lab board')
    expect(rows[2].text()).toContain('Attic')
  })

  // The local entry is synthesized by the client and is not in the stored
  // roster at all, so it must never reach the submitted list.
  it('never submits the local device as a roster entry', async () => {
    const wrapper = await openManager()

    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect(putBody().map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('marks the active server and the tokenless one in words', async () => {
    const wrapper = await openManager()

    const rows = wrapper.findAll(ROW)
    expect(rows[1].find('.srv-mgr-tag').text()).toBe('Current')
    expect(rows[2].find('.srv-mgr-tag.warn').text()).toBe('No token')
  })

  it('adds an empty draft, selects it, and holds the save until it has a url', async () => {
    const wrapper = await openManager()

    await wrapper.find('.srv-mgr-add').trigger('click')

    expect(wrapper.findAll(ROW)).toHaveLength(4)
    // A new row has no address yet, and the hub would reject the whole replace.
    expect(wrapper.find(SAVE).attributes('disabled')).toBeDefined()

    await wrapper.findAll('.srv-mgr-input')[0].setValue('New board')
    await wrapper.findAll('.srv-mgr-input')[1].setValue('http://h:9')
    expect(wrapper.find(SAVE).attributes('disabled')).toBeUndefined()

    await wrapper.find(SAVE).trigger('click')
    await flushPromises()
    expect(putBody().map((s) => s.name)).toContain('New board')
  })

  it('mints ids that are unique and never the local sentinel', async () => {
    const wrapper = await openManager()

    // Each new row needs an address before the save is allowed through, so
    // fill as we go rather than adding both and then editing one.
    for (const url of ['http://h:9', 'http://h:10']) {
      await wrapper.find('.srv-mgr-add').trigger('click')
      await wrapper.findAll('.srv-mgr-input')[1].setValue(url)
    }
    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    const ids = putBody().map((s) => s.id)
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain('__local__')
  })

  it('omits the token key when nothing was typed, which asks the hub to keep it', async () => {
    const wrapper = await openManager()

    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect('token' in putBody()[0]).toBe(false)
  })

  it('sends a typed token', async () => {
    const wrapper = await openManager()

    await wrapper.findAll('.srv-mgr-input')[2].setValue('secret')
    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect(putBody()[0].token).toBe('secret')
  })

  // The destructive direction has to be asked for, never stumbled into.
  it('clears a token only through the explicit button', async () => {
    const wrapper = await openManager()

    // Type, then erase: still "keep".
    const tokenInput = wrapper.findAll('.srv-mgr-input')[2]
    await tokenInput.setValue('secret')
    await tokenInput.setValue('')
    await wrapper.find(SAVE).trigger('click')
    await flushPromises()
    expect('token' in putBody()[0]).toBe(false)
  })

  it('sends an empty string when the clear button is pressed', async () => {
    const wrapper = await openManager()

    await wrapper.find('.srv-mgr-token-row .srv-mgr-btn').trigger('click')
    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect('token' in putBody()[0]).toBe(true)
    expect(putBody()[0].token).toBe('')
  })

  it('echoes back the fields the form does not edit', async () => {
    hub([{ ...LAB, group: 'lab', last_seen_version: '1.2.3' }])
    const wrapper = await openManager()

    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect(putBody()[0]).toMatchObject({ group: 'lab', last_seen_version: '1.2.3' })
  })

  // ── Test connection ───────────────────────────────────────────

  it('tests an untouched entry by id, so the hub uses its own stored token', async () => {
    const wrapper = await openManager()

    await wrapper.find('.srv-mgr-btn--test').trigger('click')
    await flushPromises()

    expect(probeBody()).toEqual({ id: 'a' })
  })

  // The hub ignores a url sent alongside an id, so testing by id after an
  // address change would report on the host the user just moved away from.
  it('tests the form values once the address has been edited', async () => {
    const wrapper = await openManager()

    await wrapper.findAll('.srv-mgr-input')[1].setValue('http://192.168.1.77:58901')
    await wrapper.find('.srv-mgr-btn--test').trigger('click')
    await flushPromises()

    expect(probeBody()).toEqual({ url: 'http://192.168.1.77:58901' })
  })

  it('warns when the server it reached has no token of its own', async () => {
    hub([ATTIC])
    mocks.activeId = 'b'
    const wrapper = await openManager()
    mocks.authFetch.mockResolvedValue(
      jsonResponse({ reachable: true, token_configured: false, token_valid: null })
    )

    await wrapper.find('.srv-mgr-btn--test').trigger('click')
    await flushPromises()

    expect(wrapper.find('.srv-mgr-result-line.warn').text()).toContain('no token')
  })

  // An absent settings_version has three causes, only one of which is age - it
  // must never be reported as an incompatibility.
  it('treats an absent version as "cannot say", not as incompatible', async () => {
    const wrapper = await openManager()
    mocks.authFetch.mockResolvedValue(
      jsonResponse({ reachable: true, token_configured: true, token_valid: true })
    )

    await wrapper.find('.srv-mgr-btn--test').trigger('click')
    await flushPromises()

    const text = wrapper.find('.srv-mgr-result').text()
    expect(text).toContain('Reachable')
    expect(text).toContain('older')
    expect(text).not.toMatch(/incompatible|版本不兼容/i)
  })

  it('reports a rejected token as such', async () => {
    const wrapper = await openManager()
    mocks.authFetch.mockResolvedValue(
      jsonResponse({ reachable: true, token_configured: true, token_valid: false })
    )

    await wrapper.find('.srv-mgr-btn--test').trigger('click')
    await flushPromises()

    expect(wrapper.find('.srv-mgr-result-line.bad').text()).toContain('rejected this token')
  })

  it('drops a stale result as soon as a field changes', async () => {
    const wrapper = await openManager()
    mocks.authFetch.mockResolvedValue(
      jsonResponse({ reachable: true, token_configured: true, token_valid: true })
    )
    await wrapper.find('.srv-mgr-btn--test').trigger('click')
    await flushPromises()
    expect(wrapper.find('.srv-mgr-result').exists()).toBe(true)

    await wrapper.findAll('.srv-mgr-input')[1].setValue('http://elsewhere:1')

    expect(wrapper.find('.srv-mgr-result').exists()).toBe(false)
  })

  // ── Deleting ──────────────────────────────────────────────────

  it('leaves the list alone when the confirmation is declined', async () => {
    mocks.uiConfirm.mockResolvedValue(false)
    const wrapper = await openManager()

    await wrapper.find('.srv-mgr-btn--danger').trigger('click')
    await flushPromises()

    expect(wrapper.findAll(ROW)).toHaveLength(3)
  })

  it('removes a row once confirmed', async () => {
    const wrapper = await openManager()

    await wrapper.find('.srv-mgr-btn--danger').trigger('click')
    await flushPromises()

    expect(wrapper.findAll(ROW)).toHaveLength(2)
    expect(wrapper.text()).not.toContain('Lab board')
  })

  // Removing the server you are on leaves `relayPrefix()` pointing at an id
  // nothing answers to, so the confirmation has to say the save will move first.
  it('warns in the confirmation when the row is the active server', async () => {
    const wrapper = await openManager()

    await wrapper.find('.srv-mgr-btn--danger').trigger('click')
    await flushPromises()

    expect(mocks.uiConfirm.mock.calls[0][0]).toContain('switch back to this device')
  })

  // ── Saving ────────────────────────────────────────────────────

  it('steps back to local before dropping the server it is on', async () => {
    mocks.switchServer.mockImplementation(async () => {
      order.push('switch')
      return { ok: true, id: '__local__' }
    })
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        order.push('put')
        return jsonResponse({}, 200)
      }
      return jsonResponse([LAB, ATTIC])
    })
    const wrapper = await openManager()

    await wrapper.find('.srv-mgr-btn--danger').trigger('click')
    await flushPromises()
    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect(order).toEqual(['switch', 'put'])
    expect(mocks.switchServer).toHaveBeenCalledWith('__local__')
  })

  it('does not touch the active server when it survives the save', async () => {
    const wrapper = await openManager()

    await wrapper.findAll('.srv-mgr-input')[0].setValue('Lab board 2')
    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect(mocks.switchServer).not.toHaveBeenCalled()
  })

  it('stays open and points at the row the hub rejected', async () => {
    hub([LAB, ATTIC], {
      body: { error: 'remote server `b`: url must be an origin with no path' },
      status: 400,
    })
    const wrapper = await openManager()

    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect(managerOpen.value).toBe(true)
    expect(wrapper.find('.srv-mgr-put-error').text()).toContain('must be an origin with no path')
  })

  it('closes once the roster is saved', async () => {
    const wrapper = await openManager()

    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect(managerOpen.value).toBe(false)
  })

  it('asks before discarding unsaved edits', async () => {
    mocks.uiConfirm.mockResolvedValue(false)
    const wrapper = await openManager()

    await wrapper.findAll('.srv-mgr-input')[0].setValue('Renamed')
    await wrapper.find('.dialog-close').trigger('click')
    await flushPromises()

    expect(mocks.uiConfirm).toHaveBeenCalled()
    expect(managerOpen.value).toBe(true)
  })

  it('closes without asking when nothing was edited', async () => {
    const wrapper = await openManager()

    await wrapper.find('.dialog-close').trigger('click')
    await flushPromises()

    expect(mocks.uiConfirm).not.toHaveBeenCalled()
    expect(managerOpen.value).toBe(false)
  })

  // ── Ordering ──────────────────────────────────────────────────

  it('reorders drafts without submitting them', async () => {
    const wrapper = await openManager()

    // The list owns the drag gestures; the reorder contract is what the dialog
    // acts on, so drive that directly rather than synthesising drag events.
    wrapper.findComponent({ name: 'ServerManagerList' }).vm.$emit('reorder', 'b', 'a', 'top')
    await flushPromises()
    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect(putBody().map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('moves the selected row with the mobile buttons', async () => {
    const wrapper = await openManager()

    await wrapper.findAll('.srv-mgr-row')[2].trigger('click')
    wrapper.findComponent({ name: 'ServerManagerList' }).vm.$emit('move', -1)
    await flushPromises()
    await wrapper.find(SAVE).trigger('click')
    await flushPromises()

    expect(putBody().map((s) => s.id)).toEqual(['b', 'a'])
  })
})

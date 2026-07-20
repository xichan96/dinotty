import { effectScope, nextTick, type EffectScope, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../types/pane'
import type { Workspace } from '../types/workspace'

const mocks = vi.hoisted(() => ({
  session: undefined as unknown as { tabs: Tab[]; activePaneId: string | null },
  firstUnreadAtByPane: {} as Record<string, number | null>,
  workspaces: undefined as unknown as Ref<Workspace[]>,
  matchWorkspace: vi.fn(),
}))

vi.mock('../stores/sessionStore', async () => {
  const { reactive } = await vi.importActual<typeof import('vue')>('vue')
  mocks.session = reactive({ tabs: [] as Tab[], activePaneId: null as string | null })
  return { useSessionStore: () => mocks.session }
})

vi.mock('../composables/useNotification', () => ({
  useNotification: () => ({ firstUnreadAtByPane: mocks.firstUnreadAtByPane }),
}))

vi.mock('../composables/useWorkspaces', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  mocks.workspaces = ref<Workspace[]>([])
  return {
    useWorkspaces: () => ({
      workspaces: mocks.workspaces,
      matchWorkspace: mocks.matchWorkspace,
    }),
  }
})

import { useSuperviseTabs } from '../composables/useSuperviseTabs'
import { currentRevealNavGen, nextRevealNavGen } from '../utils/navGen'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

const scopes: EffectScope[] = []

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function pluginTab(id: string): Tab {
  return { type: 'plugin', paneId: id, title: id, pluginId: id }
}

function terminalTab(id: string): Tab {
  return {
    type: 'terminal',
    paneId: id,
    layout: {
      type: 'leaf',
      paneId: `${id}-leaf`,
      title: id,
      ratio: 1,
      zoomed: false,
    },
    activePaneId: `${id}-leaf`,
    paneMru: [`${id}-leaf`],
    broadcastMode: false,
    broadcastActivity: 0,
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
  }
}

function setup(ids = ['a', 'b', 'c'], activePaneId = 'a') {
  mocks.session.tabs.splice(0, mocks.session.tabs.length, ...ids.map(terminalTab))
  mocks.session.activePaneId = activePaneId
  mocks.workspaces.value = []
  mocks.matchWorkspace.mockReset().mockReturnValue(null)
  for (const id of Object.keys(mocks.firstUnreadAtByPane)) {
    delete mocks.firstUnreadAtByPane[id]
  }

  const scope = effectScope()
  scopes.push(scope)
  const subject = scope.run(() => useSuperviseTabs())!
  return { scope, supervise: subject.supervise }
}

describe('useSuperviseTabs lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('excludes plugin tabs from supervised candidates', async () => {
    const { supervise } = setup(['a', 'b'])
    mocks.session.tabs.splice(1, 0, pluginTab('plugin'))
    const activate = vi.fn().mockResolvedValue(false)

    await supervise(activate)

    expect(activate).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledWith('b')
  })

  it('settles reversed activations under their own tokens and promotes both successes', async () => {
    const { supervise } = setup()
    const attempts = new Map<string, Deferred<boolean>>()
    const activate = vi.fn((id: string) => {
      const attempt = deferred<boolean>()
      attempts.set(id, attempt)
      return attempt.promise
    })

    const first = supervise(activate)
    const second = supervise(activate)
    expect(activate.mock.calls.map(([id]) => id)).toEqual(['b', 'c'])

    attempts.get('c')!.resolve(true)
    await second
    attempts.get('b')!.resolve(true)
    await first

    const probe = vi.fn<(id: string) => Promise<boolean>>(() => new Promise<boolean>(() => {}))
    void supervise(probe)
    void supervise(probe)
    expect(probe.mock.calls.map(([id]) => id)).toEqual(['b', 'c'])
  })

  it('drops a hung reservation and bumps navigation generation after 10 seconds', async () => {
    const { supervise } = setup(['a', 'b'])
    const activate = vi.fn<(id: string) => Promise<boolean>>(() => {
      nextRevealNavGen()
      return new Promise<boolean>(() => {})
    })

    const run = supervise(activate)
    const attemptGen = currentRevealNavGen()
    await vi.advanceTimersByTimeAsync(10_000)
    await run

    expect(currentRevealNavGen()).toBe(attemptGen + 1)
    const retry = vi.fn().mockResolvedValue(false)
    await supervise(retry)
    expect(retry).toHaveBeenCalledWith('b')
  })

  it('drops a hung reservation without clobbering a newer navigation generation', async () => {
    const { supervise } = setup(['a', 'b'])
    const activate = vi.fn(() => {
      nextRevealNavGen()
      return new Promise<boolean>(() => {})
    })

    const run = supervise(activate)
    nextRevealNavGen()
    const newerGen = currentRevealNavGen()
    await vi.advanceTimersByTimeAsync(10_000)
    await run

    expect(currentRevealNavGen()).toBe(newerGen)
    const retry = vi.fn().mockResolvedValue(false)
    await supervise(retry)
    expect(retry).toHaveBeenCalledWith('b')
  })

  it('ignores a timed-out late settle without disturbing a newer reservation', async () => {
    const { supervise } = setup()
    const attempts: Deferred<boolean>[] = []
    const activate = vi.fn<(id: string) => Promise<boolean>>(() => {
      nextRevealNavGen()
      const attempt = deferred<boolean>()
      attempts.push(attempt)
      return attempt.promise
    })

    const oldRun = supervise(activate)
    await vi.advanceTimersByTimeAsync(10_000)
    await oldRun

    const newerRun = supervise(activate)
    attempts[0].resolve(true)
    await nextTick()

    void supervise(activate)
    expect(activate.mock.calls.map(([id]) => id)).toEqual(['b', 'b', 'c'])

    attempts[1].resolve(false)
    await newerRun
    void supervise(activate)
    expect(activate.mock.calls.map(([id]) => id)).toEqual(['b', 'b', 'c', 'b'])
  })

  it('drops a failed activation without promotion and makes the target re-eligible', async () => {
    const { supervise } = setup()
    const activate = vi.fn().mockResolvedValue(false)

    await supervise(activate)
    await supervise(activate)

    expect(activate.mock.calls.map(([id]) => id)).toEqual(['b', 'b'])
  })

  it('bails out without registering a watchdog when disposed during activation', async () => {
    const { scope, supervise } = setup(['a', 'b'])
    const activate = vi.fn<(id: string) => Promise<boolean>>(() => {
      scope.stop()
      return new Promise<boolean>(() => {})
    })

    const genBefore = currentRevealNavGen()
    await supervise(activate)

    expect(activate).toHaveBeenCalledWith('b')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(currentRevealNavGen()).toBe(genBefore)
  })

  it('does nothing when every non-current tab is pending', async () => {
    const { supervise } = setup(['a', 'b'])
    const activate = vi.fn(() => new Promise<boolean>(() => {}))

    void supervise(activate)
    await supervise(activate)

    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledWith('b')
  })

  it('clears watchdogs on scope disposal without bumping navigation generation', async () => {
    const { scope, supervise } = setup(['a', 'b'])
    const activate = vi.fn(() => {
      nextRevealNavGen()
      return new Promise<boolean>(() => {})
    })

    void supervise(activate)
    const attemptGen = currentRevealNavGen()
    expect(vi.getTimerCount()).toBe(1)

    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(currentRevealNavGen()).toBe(attemptGen)
  })

  it('settles an in-flight supervise promise when the scope is disposed', async () => {
    const { scope, supervise } = setup(['a', 'b'])
    const activate = vi.fn(() => new Promise<boolean>(() => {}))

    const run = supervise(activate)
    const settled = vi.fn()
    void run.then(settled)
    expect(vi.getTimerCount()).toBe(1)

    scope.stop()
    await run
    expect(settled).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

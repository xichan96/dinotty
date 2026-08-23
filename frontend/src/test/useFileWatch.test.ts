import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useFileWatch, type FileWatchOptions } from '../composables/useFileWatch'

// Mock WebSocket - must be defined before tests run
const mockInstances: any[] = []

class MockWebSocket {
  static instances = mockInstances
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readyState = 1
  url: string

  constructor(url: string) {
    this.url = url
    mockInstances.push(this)
    // Trigger onopen on next microtask
    queueMicrotask(() => this.onopen?.())
  }
  close() {
    this.readyState = 3
  }
  send() {}
}

// Mock apiBase module
vi.mock('../composables/apiBase', () => ({
  getApiBase: vi.fn().mockResolvedValue('http://localhost:8999'),
  apiUrl: (path: string) => `http://localhost:8999${path}`,
  authFetch: vi.fn(),
  wsUrlWithToken: (url: string) => url,
}))

describe('useFileWatch', () => {
  let originalWebSocket: typeof globalThis.WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    originalWebSocket = globalThis.WebSocket
    globalThis.WebSocket = MockWebSocket as any
    // Ensure window globals are available (happy-dom should provide these)
    if (typeof window === 'undefined') {
      ;(globalThis as any).window = {
        location: { protocol: 'http:', origin: 'http://localhost:3000' },
      }
    }
    mockInstances.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  function makeOpts(overrides: Partial<FileWatchOptions> = {}) {
    return {
      paneId: () => 'test-pane',
      cwdLabel: ref('/workspace'),
      expanded: ref(new Set<string>()),
      childCache: ref<Record<string, any[]>>({ '': [{ name: 'src', is_dir: true, size: 0 }] }),
      selectedRel: ref<string | null>(null),
      selectedIsDir: ref(false),
      meta: ref(null),
      editorDirty: () => false,
      onFileDeleted: vi.fn(),
      onFileChanged: vi.fn(),
      onBinaryChanged: vi.fn(),
      fetchList: vi.fn().mockResolvedValue([{ name: 'src', is_dir: true, size: 0 }]),
      ...overrides,
    }
  }

  it('root cache is preserved when file created at root level', async () => {
    const opts = makeOpts()
    const fw = useFileWatch(opts)
    await fw.connectTreeWatchSocket()

    const ws = mockInstances[0]
    expect(ws).toBeDefined()

    // Simulate a file creation event at root level
    ws.onmessage!({
      data: JSON.stringify({
        type: 'file_event',
        path: '/workspace/newfile.txt',
        kind: 'created',
      }),
    })

    // Root cache should NOT be deleted (root is always considered expanded)
    expect(opts.childCache.value['']).toBeDefined()
    expect(opts.childCache.value['']).toEqual([{ name: 'src', is_dir: true, size: 0 }])

    fw.disconnectTreeWatchSocket()
  })

  it('root cache is preserved when file deleted at root level', async () => {
    const opts = makeOpts({
      childCache: ref<Record<string, any[]>>({
        '': [
          { name: 'src', is_dir: true, size: 0 },
          { name: 'temp.txt', is_dir: false, size: 10 },
        ],
      }),
    })
    const fw = useFileWatch(opts)
    await fw.connectTreeWatchSocket()

    const ws = mockInstances[0]

    // Simulate a file deletion event at root level
    ws.onmessage!({
      data: JSON.stringify({
        type: 'file_event',
        path: '/workspace/temp.txt',
        kind: 'deleted',
      }),
    })

    // Root cache should NOT be deleted
    expect(opts.childCache.value['']).toBeDefined()

    fw.disconnectTreeWatchSocket()
  })

  it('batch timer refreshes root directory after file event', async () => {
    const newEntries = [
      { name: 'src', is_dir: true, size: 0 },
      { name: 'newfile.txt', is_dir: false, size: 5 },
    ]
    const opts = makeOpts({
      fetchList: vi.fn().mockResolvedValue(newEntries),
    })
    const fw = useFileWatch(opts)
    await fw.connectTreeWatchSocket()

    const ws = mockInstances[0]

    // Simulate file creation at root
    ws.onmessage!({
      data: JSON.stringify({
        type: 'file_event',
        path: '/workspace/newfile.txt',
        kind: 'created',
      }),
    })

    // Before timer fires, root cache is still old value
    expect(opts.childCache.value['']).toEqual([{ name: 'src', is_dir: true, size: 0 }])

    // Advance timer past the 300ms debounce
    await vi.advanceTimersByTimeAsync(350)

    // Root cache should be refreshed
    expect(opts.fetchList).toHaveBeenCalledWith('')
    expect(opts.childCache.value['']).toEqual(newEntries)

    fw.disconnectTreeWatchSocket()
  })

  it('file event in subdirectory refreshes parent when expanded', async () => {
    const opts = makeOpts({
      expanded: ref(new Set(['src'])),
      childCache: ref<Record<string, any[]>>({
        '': [{ name: 'src', is_dir: true, size: 0 }],
        src: [{ name: 'main.rs', is_dir: false, size: 100 }],
      }),
    })
    const fw = useFileWatch(opts)
    await fw.connectTreeWatchSocket()

    const ws = mockInstances[0]

    // Simulate file change in src/
    ws.onmessage!({
      data: JSON.stringify({
        type: 'file_event',
        path: '/workspace/src/main.rs',
        kind: 'changed',
      }),
    })

    await vi.advanceTimersByTimeAsync(350)

    // src directory should be refreshed
    expect(opts.fetchList).toHaveBeenCalledWith('src')

    fw.disconnectTreeWatchSocket()
  })

  it('non-expanded subdirectory cache is deleted on create/delete', async () => {
    const opts = makeOpts({
      expanded: ref(new Set<string>()),
      childCache: ref<Record<string, any[]>>({
        '': [{ name: 'src', is_dir: true, size: 0 }],
        src: [{ name: 'main.rs', is_dir: false, size: 100 }],
      }),
    })
    const fw = useFileWatch(opts)
    await fw.connectTreeWatchSocket()

    const ws = mockInstances[0]

    // Simulate file creation in src/ (not expanded)
    ws.onmessage!({
      data: JSON.stringify({
        type: 'file_event',
        path: '/workspace/src/newfile.rs',
        kind: 'created',
      }),
    })

    // Non-expanded parent cache should be deleted (to force re-fetch on expand)
    expect(opts.childCache.value['src']).toBeUndefined()
    // But root cache should still be there
    expect(opts.childCache.value['']).toBeDefined()

    fw.disconnectTreeWatchSocket()
  })

  it('WebSocket reconnects after close', async () => {
    const opts = makeOpts()
    const fw = useFileWatch(opts)
    await fw.connectTreeWatchSocket()

    expect(mockInstances).toHaveLength(1)

    // Simulate server-side close
    mockInstances[0].onclose!()

    // Advance timer past reconnect delay
    await vi.advanceTimersByTimeAsync(1500)

    // Should have created a new WebSocket
    expect(mockInstances).toHaveLength(2)

    fw.disconnectTreeWatchSocket()
  })

  it('no reconnect after intentional disconnect', async () => {
    const opts = makeOpts()
    const fw = useFileWatch(opts)
    await fw.connectTreeWatchSocket()

    expect(mockInstances).toHaveLength(1)

    // Intentional disconnect
    fw.disconnectTreeWatchSocket()

    // Advance timer well past reconnect delay
    await vi.advanceTimersByTimeAsync(5000)

    // Should NOT have created a new WebSocket
    expect(mockInstances).toHaveLength(1)
  })

  it('reconnect delay resets on successful connection', async () => {
    const opts = makeOpts()
    const fw = useFileWatch(opts)
    await fw.connectTreeWatchSocket()

    // First disconnect → reconnect after 1s
    mockInstances[0].onclose!()
    await vi.advanceTimersByTimeAsync(1200)
    expect(mockInstances).toHaveLength(2)

    // onopen fired (via microtask), resetting delay to 1s
    // Second disconnect → should still reconnect after 1s (delay was reset)
    mockInstances[1].onclose!()
    await vi.advanceTimersByTimeAsync(1200)
    expect(mockInstances).toHaveLength(3) // reconnected again

    fw.disconnectTreeWatchSocket()
  })
})

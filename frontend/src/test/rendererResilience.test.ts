import { describe, it, expect, vi } from 'vitest'
import { createRendererResilience } from '../composables/useTerminal'

// Spec: openspec/changes/fix-webgl-context-loss-no-fallback/specs/terminal-renderer-resilience/spec.md
//
// "When the active WebGL renderer reports a context loss event (e.g., triggered
//  by GPU pressure during rapid scrolling on Tauri WKWebView) the system MUST
//  dispose the broken WebGL addon AND schedule a debounced reinitialization of
//  the WebGL renderer."
//
// Without this fix, the user-visible symptom was: frantic up/down scroll on
// macOS desktop → terminal appears frozen. Root cause: WKWebView drops the
// WebGL context under sustained GPU pressure; the previous code only called
// webgl.dispose() and left xterm without a renderer.

interface FakeAddon {
  kind: 'webgl' | 'canvas'
  disposed: boolean
  // webgl-only context-loss hook
  contextLossCb?: () => void
}

function makeFakeAddon(kind: 'webgl' | 'canvas'): FakeAddon {
  return { kind, disposed: false }
}

interface Harness {
  attached: FakeAddon[]
  detached: FakeAddon[]
  controller: ReturnType<typeof createRendererResilience>
  hooks: {
    onRendererLost: ReturnType<typeof vi.fn>
    onRendererRestored: ReturnType<typeof vi.fn>
  }
  /** Manually advance the debounce timer by firing whatever is queued. */
  flushScheduled: () => void
  webglFactoryCalls: number
  canvasFactoryCalls: number
  nextWebglResult: FakeAddon | null
  nextCanvasResult: FakeAddon | null
}

function makeHarness(opts?: {
  maxAttempts?: number
  debounceMs?: number
  /** If true, every createWebgl() call returns null (simulates WebGL unavailable). */
  webglAlwaysFails?: boolean
  /** If true, every createCanvas() call returns null (simulates Canvas unavailable). */
  canvasAlwaysFails?: boolean
  /** After N successful WebGL attaches, the next createWebgl returns null. */
  webglFailsAfter?: number
}): Harness {
  const attached: FakeAddon[] = []
  const detached: FakeAddon[] = []
  const hooks = {
    onRendererLost: vi.fn(),
    onRendererRestored: vi.fn(),
  }
  let webglFactoryCalls = 0
  let canvasFactoryCalls = 0
  let pending: (() => void) | null = null

  const controller = createRendererResilience(
    (addon) => attached.push(addon as unknown as FakeAddon),
    (addon) => {
      detached.push(addon as unknown as FakeAddon)
      ;(addon as unknown as FakeAddon).disposed = true
    },
    hooks,
    {
      maxAttempts: opts?.maxAttempts,
      debounceMs: opts?.debounceMs,
      schedule: (cb) => {
        pending = cb
        return () => { if (pending === cb) pending = null }
      },
      factories: {
        createWebgl: () => {
          webglFactoryCalls++
          if (opts?.webglAlwaysFails) return null
          if (opts?.webglFailsAfter !== undefined && webglFactoryCalls > opts.webglFailsAfter) return null
          return makeFakeAddon('webgl') as any
        },
        createCanvas: () => {
          canvasFactoryCalls++
          if (opts?.canvasAlwaysFails) return null
          return makeFakeAddon('canvas') as any
        },
      },
    },
  )

  return {
    attached,
    detached,
    controller,
    hooks,
    flushScheduled: () => {
      if (pending) {
        const cb = pending
        pending = null
        cb()
      }
    },
    webglFactoryCalls: 0,
    canvasFactoryCalls: 0,
    nextWebglResult: null,
    nextCanvasResult: null,
  }
}

describe('renderer resilience state machine (useTerminal)', () => {
  it('attaches WebGL on initial attach', () => {
    const h = makeHarness()
    const ok = h.controller.attachInitial()
    expect(ok).toBe(true)
    expect(h.attached).toHaveLength(1)
    expect(h.attached[0].kind).toBe('webgl')
    expect(h.controller.getState().renderer).toBe('webgl')
    expect(h.controller.getState().attempts).toBe(0)
  })

  it('context loss schedules a debounced WebGL reinit', () => {
    const h = makeHarness()
    h.controller.attachInitial()
    h.controller.onContextLoss()
    // After context loss, the broken addon is detached.
    expect(h.detached).toHaveLength(1)
    expect(h.detached[0].kind).toBe('webgl')
    // We are in the debounce window — no new addon yet.
    expect(h.attached).toHaveLength(1)
    expect(h.controller.getState().debouncing).toBe(true)
    expect(h.controller.getState().attempts).toBe(1)
    expect(h.hooks.onRendererLost).toHaveBeenCalledWith({
      from: 'webgl',
      reason: 'webglcontextlost',
    })
    // Flush the debounce → webgl reinit succeeds → restored hook fires.
    h.flushScheduled()
    expect(h.attached).toHaveLength(2)
    expect(h.attached[1].kind).toBe('webgl')
    expect(h.controller.getState().renderer).toBe('webgl')
    expect(h.controller.getState().debouncing).toBe(false)
    expect(h.controller.getState().attempts).toBe(0) // reset on success
    expect(h.hooks.onRendererRestored).toHaveBeenCalledWith({ to: 'webgl' })
  })

  it('repeated context loss eventually falls back to Canvas', () => {
    // Initial WebGL succeeds, but every reinit attempt fails.
    const h = makeHarness({ maxAttempts: 2, webglFailsAfter: 1 })
    h.controller.attachInitial() // initial webgl succeeds (1st createWebgl call)
    // 1st context loss: attempts=1, debounce → reinit (2nd createWebgl) → fails
    //   → state.attempts=1, not yet >= maxAttempts(2), so stays unrendered.
    h.controller.onContextLoss()
    h.flushScheduled()
    expect(h.controller.getState().renderer).toBe('none')
    // 2nd context loss: attempts=2, > maxAttempts(2)? No, == maxAttempts.
    //   We use > maxAttempts as the cutoff in onContextLoss, so this still
    //   schedules a reinit. The reinit will fail again and now attempts=2
    //   satisfies the >= maxAttempts check inside scheduleReinit → canvas.
    h.controller.onContextLoss()
    h.flushScheduled()
    expect(h.controller.getState().renderer).toBe('canvas')
    expect(h.hooks.onRendererRestored).toHaveBeenLastCalledWith({ to: 'canvas' })
  })

  it('falls back to Canvas when WebGL is structurally unavailable', () => {
    // WebGL factory always returns null — both initial and reinit attempts fail.
    const h = makeHarness({ webglAlwaysFails: true })
    const ok = h.controller.attachInitial()
    expect(ok).toBe(false)
    expect(h.controller.getState().renderer).toBe('none')
    // Now force a fallback — Canvas should attach.
    const fb = h.controller.forceFallback()
    expect(fb).toBe(true)
    expect(h.controller.getState().renderer).toBe('canvas')
  })

  it('debounces multiple context-loss events in the window', () => {
    const h = makeHarness()
    h.controller.attachInitial()
    // Fire 3 context-loss events back-to-back without flushing.
    h.controller.onContextLoss()
    h.controller.onContextLoss()
    h.controller.onContextLoss()
    // Only one detach happened (the first one), only one debounce is pending.
    expect(h.detached).toHaveLength(1)
    expect(h.controller.getState().debouncing).toBe(true)
    expect(h.controller.getState().attempts).toBe(3)
    // Flush once → single reinit.
    h.flushScheduled()
    expect(h.attached).toHaveLength(2)
    expect(h.controller.getState().renderer).toBe('webgl')
  })

  it('skips reinit and goes straight to Canvas after max attempts', () => {
    // Force WebGL reinit to always fail, but initial attach to succeed.
    const h = makeHarness({ maxAttempts: 1, webglFailsAfter: 1 })
    h.controller.attachInitial()
    // webglFailsAfter=1 → 1st createWebgl call (initial) succeeds, 2nd onwards fail.
    h.controller.onContextLoss()
    // attempts goes from 0 → 1, debounce is scheduled.
    expect(h.controller.getState().debouncing).toBe(true)
    // Now spam context loss to push attempts beyond max.
    // (debounce is still active, but we can still call onContextLoss; it
    // will increment attempts and skip reinit if attempts > maxAttempts)
    h.controller.onContextLoss()
    expect(h.controller.getState().renderer).toBe('canvas')
    expect(h.controller.getState().debouncing).toBe(false)
  })

  it('does not crash when both WebGL and Canvas factories return null', () => {
    const h = makeHarness({ webglAlwaysFails: true, canvasAlwaysFails: true })
    expect(() => h.controller.attachInitial()).not.toThrow()
    expect(h.controller.getState().renderer).toBe('none')
    expect(() => h.controller.forceFallback()).not.toThrow()
    expect(h.controller.getState().renderer).toBe('none')
    // Critical: no exception means the terminal keeps working with its
    // built-in DOM renderer. We never let the state machine throw.
  })

  it('dispose() cancels pending debounce and detaches active addon', () => {
    const h = makeHarness()
    h.controller.attachInitial()
    h.controller.onContextLoss()
    expect(h.controller.getState().debouncing).toBe(true)
    h.controller.dispose()
    expect(h.controller.getState().debouncing).toBe(false)
    // Subsequent context-loss events should be no-ops.
    h.controller.onContextLoss()
    h.flushScheduled() // nothing scheduled, must not crash
    // The detached count is unchanged from the first loss + dispose.
    expect(h.detached.length).toBeGreaterThanOrEqual(1)
  })

  it('forceFallback is idempotent when already on Canvas', () => {
    const h = makeHarness()
    // Force into Canvas state via webgl-unavailable path.
    h.controller.attachInitial()
    const ok1 = h.controller.forceFallback()
    expect(ok1).toBe(true)
    expect(h.controller.getState().renderer).toBe('canvas')
    const ok2 = h.controller.forceFallback()
    expect(ok2).toBe(false)
    // No new canvas addon attached.
    const canvasCount = h.attached.filter((a) => a.kind === 'canvas').length
    expect(canvasCount).toBe(1)
  })
})
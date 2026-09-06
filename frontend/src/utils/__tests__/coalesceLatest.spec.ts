import { describe, it, expect } from 'vitest'
import { coalesceLatest } from '../coalesceLatest'

interface Task {
  at: number
  id: number
  fn: () => void
}

/** Minimal fake clock + setTimeout that runs callbacks on manual `tick`. */
class FakeClock {
  private time = 0
  private tasks: Task[] = []
  private nextId = 1

  now = (): number => this.time
  schedule = (fn: () => void, ms: number): unknown => {
    const task: Task = { at: this.time + ms, id: this.nextId++, fn }
    this.tasks.push(task)
    this.tasks.sort((a, b) => a.at - b.at)
    return task.id
  }

  runAll(): void {
    while (this.tasks.length > 0) {
      const { at, fn } = this.tasks.shift() as Task
      this.time = Math.max(this.time, at)
      fn()
    }
  }
}

describe('coalesceLatest', () => {
  it('emits a single spaced value promptly', () => {
    const clock = new FakeClock()
    const seen: number[] = []
    const push = coalesceLatest<number>((v) => seen.push(v), {
      intervalMs: 200,
      now: clock.now,
      schedule: clock.schedule,
    })
    push(1)
    clock.runAll()
    expect(seen).toEqual([1])
  })

  it('collapses a burst to the newest value only, keeping the cadence', () => {
    const clock = new FakeClock()
    const seen: number[] = []
    const push = coalesceLatest<number>((v) => seen.push(v), {
      intervalMs: 200,
      now: clock.now,
      schedule: clock.schedule,
    })
    // A wake-up style flood: many samples arrive back-to-back.
    for (let i = 1; i <= 100; i++) push(i)
    clock.runAll()
    expect(seen).toEqual([100])
  })

  it('emits at most once per interval and always delivers the trailing value', () => {
    const clock = new FakeClock()
    const seen: number[] = []
    const push = coalesceLatest<number>((v) => seen.push(v), {
      intervalMs: 200,
      now: clock.now,
      schedule: clock.schedule,
    })
    push(1)
    clock.runAll() // -> 1 at t=0
    push(2)
    push(3)
    push(4)
    clock.runAll() // -> 4 at t=200
    expect(seen).toEqual([1, 4])

    // Trailing value: a lone final sample is still delivered.
    push(5)
    clock.runAll() // -> 5 at t=400
    expect(seen).toEqual([1, 4, 5])
  })

  it('does not emit when nothing is pushed', () => {
    const clock = new FakeClock()
    const seen: number[] = []
    const push = coalesceLatest<number>((v) => seen.push(v), {
      intervalMs: 200,
      now: clock.now,
      schedule: clock.schedule,
    })
    void push
    clock.runAll()
    expect(seen).toEqual([])
  })
})

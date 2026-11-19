import { beforeEach, describe, expect, it } from 'vitest'
import { runWithConcurrency, useUploadTracker } from '../composables/useUploadTracker'

describe('useUploadTracker', () => {
  beforeEach(() => {
    useUploadTracker().resetUploadTracker()
  })

  it('moves a task through the progress phases and finishes it', () => {
    const tracker = useUploadTracker()
    const id = tracker.addTask('photo.png', 100)
    expect(tracker.tasks.value[0].status).toBe('queued')

    tracker.setTaskStatus(id, 'uploading')
    tracker.updateTaskProgress(id, 50, 100)
    expect(tracker.tasks.value[0].status).toBe('uploading')

    tracker.updateTaskProgress(id, 100, 100)
    expect(tracker.tasks.value[0].status).toBe('processing')

    tracker.finishTask(id, true)
    expect(tracker.tasks.value[0].status).toBe('done')
    expect(tracker.activeCount.value).toBe(0)
    expect(tracker.hasFinished.value).toBe(true)
  })

  it('records failures and lets finished rows be dismissed or cleared', () => {
    const tracker = useUploadTracker()
    const a = tracker.addTask('a.txt', 10)
    const b = tracker.addTask('b.txt', 10)

    tracker.finishTask(a, false, 'HTTP 507')
    expect(tracker.tasks.value[0].status).toBe('failed')
    expect(tracker.tasks.value[0].error).toBe('HTTP 507')

    tracker.dismissTask(a)
    expect(tracker.tasks.value).toHaveLength(1)

    tracker.finishTask(b, true)
    tracker.clearFinished()
    expect(tracker.tasks.value).toHaveLength(0)
    expect(tracker.hasFinished.value).toBe(false)
  })
})

describe('runWithConcurrency', () => {
  it('never runs more than the allowed number of workers at once', async () => {
    let active = 0
    let peak = 0
    const order: number[] = []

    await runWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
      active += 1
      peak = Math.max(peak, active)
      order.push(item)
      await Promise.resolve()
      active -= 1
    })

    expect(peak).toBe(2)
    expect(order).toHaveLength(6)
    expect(new Set(order).size).toBe(6)
  })
})

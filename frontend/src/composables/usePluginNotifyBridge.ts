import { apiUrl, authFetch, getApiBase } from './apiBase'

export interface PluginNotifyBridgeJob {
  readonly requestId: string
  readonly body: string
}

export interface PluginNotifyBridgeOptions {
  pushNotification: (n: {
    type: 'info' | 'warning' | 'error'
    title: string
    body: string
    source: 'plugin'
  }) => void
}

export interface PluginNotifyBridge {
  enqueueJob: (job: PluginNotifyBridgeJob) => void
  dispose: () => void
}

const PLUGIN_NOTIFY_RETRY_DELAYS_MS = [1000, 2000, 4000] as const
const BRIDGE_MAX_CONCURRENT = 3
const BRIDGE_QUEUE_CAP = 64

export function usePluginNotifyBridge(opts: PluginNotifyBridgeOptions): PluginNotifyBridge {
  const { pushNotification } = opts

  const queue: PluginNotifyBridgeJob[] = []
  const retryTimers = new Map<ReturnType<typeof setTimeout>, (shouldContinue: boolean) => void>()
  const abortControllers = new Set<AbortController>()
  let activeJobs = 0
  let disposed = false
  let overflowDropped = 0
  let overflowWarnScheduled = false

  function waitForRetry(delayMs: number) {
    if (disposed) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        retryTimers.delete(timer)
        resolve(!disposed)
      }, delayMs)
      retryTimers.set(timer, resolve)
    })
  }

  async function runJob(job: PluginNotifyBridgeJob) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await getApiBase()
        if (disposed) return

        const controller = new AbortController()
        abortControllers.add(controller)
        let response: Awaited<ReturnType<typeof authFetch>>
        try {
          response = await authFetch(apiUrl('/api/notify'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: job.body,
            signal: controller.signal,
          })
        } finally {
          abortControllers.delete(controller)
        }
        if (disposed) return

        const responseBody = await response.json().catch(() => null)
        if (disposed) return

        if (response.status === 200) {
          const accepted =
            responseBody?.status === 'accepted' ||
            (typeof responseBody?.eventSeq === 'string' &&
              (typeof responseBody?.notifId === 'string' ||
                typeof responseBody?.paneId === 'string'))
          if (accepted || responseBody?.status === 'suppressed') return
          console.error('[notification] plugin notify returned an unexpected 200 response')
          return
        }

        if (response.status === 503) {
          if (attempt < PLUGIN_NOTIFY_RETRY_DELAYS_MS.length) {
            if (!(await waitForRetry(PLUGIN_NOTIFY_RETRY_DELAYS_MS[attempt]))) return
            continue
          }
          break
        }

        console.error(`[notification] plugin notify failed with HTTP ${response.status}`)
        return
      } catch (error) {
        if (disposed) return
        if (attempt < PLUGIN_NOTIFY_RETRY_DELAYS_MS.length) {
          if (!(await waitForRetry(PLUGIN_NOTIFY_RETRY_DELAYS_MS[attempt]))) return
          continue
        }
        console.error('[notification] plugin notify retry exhausted', error)
        break
      }
    }

    if (disposed) return
    const request = JSON.parse(job.body) as {
      type: 'info' | 'warning' | 'error'
      title: string
      body: string
    }
    console.error('[notification] plugin notify retry exhausted; inserting locally')
    pushNotification({
      type: request.type,
      title: request.title,
      body: request.body,
      source: 'plugin',
    })
  }

  function pumpQueue() {
    while (!disposed && activeJobs < BRIDGE_MAX_CONCURRENT && queue.length > 0) {
      const job = queue.shift()!
      activeJobs++
      void runJob(job).finally(() => {
        activeJobs--
        pumpQueue()
      })
    }
  }

  function enqueueJob(job: PluginNotifyBridgeJob) {
    if (disposed) return
    if (queue.length >= BRIDGE_QUEUE_CAP) {
      queue.shift()
      overflowDropped++
      if (!overflowWarnScheduled) {
        overflowWarnScheduled = true
        queueMicrotask(() => {
          overflowWarnScheduled = false
          if (disposed) {
            overflowDropped = 0
            return
          }
          const dropped = overflowDropped
          overflowDropped = 0
          console.warn(
            `[notification] plugin notify bridge queue full; evicted ${dropped} oldest pending ${dropped === 1 ? 'job' : 'jobs'}`
          )
        })
      }
    }
    queue.push(job)
    pumpQueue()
  }

  function dispose() {
    disposed = true
    queue.length = 0
    overflowDropped = 0
    for (const [timer, resolve] of retryTimers) {
      clearTimeout(timer)
      resolve(false)
    }
    retryTimers.clear()
    for (const controller of abortControllers) controller.abort()
    abortControllers.clear()
  }

  return {
    enqueueJob,
    dispose,
  }
}

import { computed, ref } from 'vue'

export type UploadTaskStatus = 'queued' | 'uploading' | 'processing' | 'done' | 'failed'

export interface UploadTask {
  id: string
  name: string
  status: UploadTaskStatus
  loaded: number
  total: number
  error?: string
  finishedAt?: number
}

// A module-level singleton: the terminal, the file workspace and any other
// upload entry point all push rows into the same panel without prop drilling.
// This mirrors how `settings` is shared from useSettings.ts.
const tasks = ref<UploadTask[]>([])
const activeCount = computed(() => tasks.value.filter((t) => !t.finishedAt).length)
const hasFinished = computed(() => tasks.value.some((t) => !!t.finishedAt))

let seq = 0
function nextId(): string {
  seq += 1
  return globalThis.crypto?.randomUUID?.() ?? `upload-${Date.now()}-${seq}`
}

// Keep the list bounded so a long session full of uploads cannot grow forever.
const MAX_TASKS = 50

function trim(): void {
  if (tasks.value.length <= MAX_TASKS) return
  const finished = tasks.value.filter((t) => t.finishedAt)
  const remove = Math.min(finished.length, tasks.value.length - MAX_TASKS)
  const removeIds = new Set(finished.slice(0, remove).map((t) => t.id))
  tasks.value = tasks.value.filter((t) => !removeIds.has(t.id))
}

export function addTask(name: string, total: number): string {
  const id = nextId()
  tasks.value.push({ id, name: name || 'file', status: 'queued', loaded: 0, total })
  trim()
  return id
}

function findTask(id: string): UploadTask | undefined {
  return tasks.value.find((t) => t.id === id)
}

export function setTaskStatus(id: string, status: UploadTaskStatus): void {
  const task = findTask(id)
  if (task && !task.finishedAt) task.status = status
}

export function updateTaskProgress(id: string, loaded: number, total?: number): void {
  const task = findTask(id)
  if (!task || task.finishedAt) return
  task.loaded = loaded
  if (total !== undefined && total > 0) task.total = total
  task.status = 'uploading'
  // Bytes are all sent; the server still has to write them to disk.
  if (task.total > 0 && loaded >= task.total) task.status = 'processing'
}

export function finishTask(id: string, ok: boolean, error?: string): void {
  const task = findTask(id)
  if (!task || task.finishedAt) return
  task.status = ok ? 'done' : 'failed'
  task.error = error
  task.finishedAt = Date.now()
}

function dismissTask(id: string): void {
  tasks.value = tasks.value.filter((t) => t.id !== id)
}

function clearFinished(): void {
  tasks.value = tasks.value.filter((t) => !t.finishedAt)
}

/** Test helper — not used by app code. */
function resetUploadTracker(): void {
  tasks.value = []
}

/**
 * Run `worker` over `items` with a small concurrency limit. Dropping 100 files
 * should not open 100 sockets at once, but serialising everything would make a
 * big drop needlessly slow.
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (!items.length) return
  let next = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

export function useUploadTracker() {
  return {
    tasks,
    activeCount,
    hasFinished,
    addTask,
    setTaskStatus,
    updateTaskProgress,
    finishTask,
    dismissTask,
    clearFinished,
    resetUploadTracker,
  }
}

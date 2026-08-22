import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { VNode } from 'vue'

export interface StatusBarItem {
  id: string
  position: 'left' | 'right'
  priority: number
  render: () => VNode | null
  tooltip?: string
  onClick?: (event: MouseEvent) => void
  defaultVisible?: boolean
  visible?: () => boolean
}

interface RegisteredItem extends StatusBarItem {
  pluginId: string
  failureCount: number
  lastError?: string
  autoHidden: boolean
}

const MAX_FAILURES = 5

function sortItems(items: RegisteredItem[]): RegisteredItem[] {
  return [...items].sort((a, b) => a.priority - b.priority)
}

export const useStatusBarItemsStore = defineStore('statusBarItems', () => {
  const items = ref<RegisteredItem[]>([])

  function register(pluginId: string, newItems: StatusBarItem[]) {
    for (const item of newItems) {
      if (items.value.some((i) => i.id === item.id)) continue
      items.value.push({
        ...item,
        pluginId,
        failureCount: 0,
        autoHidden: false,
      })
    }
  }

  function unregister(pluginId: string) {
    items.value = items.value.filter((i) => i.pluginId !== pluginId)
  }

  function reportFailure(itemId: string, err: unknown) {
    const item = items.value.find((i) => i.id === itemId)
    if (!item) return
    item.failureCount += 1
    item.lastError = err instanceof Error ? err.message : String(err)
    if (item.failureCount >= MAX_FAILURES) {
      item.autoHidden = true
    }
  }

  function reportSuccess(itemId: string) {
    const item = items.value.find((i) => i.id === itemId)
    if (!item) return
    if (item.failureCount > 0 || item.autoHidden) {
      item.failureCount = 0
      item.autoHidden = false
      item.lastError = undefined
    }
  }

  function isVisible(item: RegisteredItem): boolean {
    if (item.autoHidden) return false
    if (item.visible && !item.visible()) return false
    return item.defaultVisible ?? true
  }

  const leftItems = computed(() =>
    sortItems(items.value.filter((i) => i.position === 'left' && isVisible(i)))
  )

  const rightItems = computed(() =>
    sortItems(items.value.filter((i) => i.position === 'right' && isVisible(i)))
  )

  return {
    items,
    leftItems,
    rightItems,
    register,
    unregister,
    reportFailure,
    reportSuccess,
  }
})

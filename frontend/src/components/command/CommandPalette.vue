<template>
  <div id="palette-backdrop" :class="{ open: isOpen }" @mousedown.self="close">
    <div id="palette">
      <div id="palette-input-wrap">
        <Search :size="14" />
        <input
          ref="inputRef"
          id="palette-input"
          type="text"
          placeholder="Search commands…"
          autocomplete="off"
          spellcheck="false"
          v-model="query"
          @keydown="onKey"
        />
      </div>
      <div id="palette-list">
        <div v-if="filtered.length === 0" id="palette-empty">No matching commands</div>
        <div
          v-for="(cmd, i) in filtered"
          :key="i"
          class="palette-item"
          :class="{ selected: i === selected }"
          @mousedown.prevent="execute(i)"
          @mouseenter="selected = i"
        >
          <div class="palette-item-icon">{{ cmd.icon || '›' }}</div>
          <div class="palette-item-body">
            <div class="palette-item-title" v-html="highlightTitle(cmd.title)"></div>
            <div v-if="cmd.subtitle" class="palette-item-subtitle">{{ cmd.subtitle }}</div>
          </div>
          <div v-if="cmd.kbd?.length" class="palette-item-kbd">
            <kbd v-for="(k, ki) in cmd.kbd" :key="ki">{{ k }}</kbd>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Search } from 'lucide-vue-next'

export interface Command {
  icon?: string
  title: string
  subtitle?: string
  kbd?: string[]
  action: () => void
}

const props = defineProps<{
  commands: Command[]
}>()

const isOpen = ref(false)
const query = ref('')
const selected = ref(0)
const inputRef = ref<HTMLInputElement>()
const overrideItems = ref<Command[] | null>(null)

const filtered = computed(() => {
  const items = overrideItems.value ?? props.commands
  const q = query.value.trim().toLowerCase()
  if (!q) return items
  return items
    .filter((c) => fuzzyMatch(c.title, q) !== null || c.subtitle?.toLowerCase().includes(q))
    .sort((a, b) => {
      const sa = fuzzyMatch(a.title, q) ?? 999
      const sb = fuzzyMatch(b.title, q) ?? 999
      return sa - sb
    })
})

watch(query, () => { selected.value = 0 })

function open() {
  isOpen.value = true
  query.value = ''
  nextTick(() => inputRef.value?.focus())
}

function close() {
  isOpen.value = false
  overrideItems.value = null
}

function toggle() {
  isOpen.value ? close() : open()
}

function openWithItems(items: Command[]) {
  overrideItems.value = items
  isOpen.value = true
  query.value = ''
  nextTick(() => inputRef.value?.focus())
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { close(); return }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selected.value = Math.min(selected.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selected.value = Math.max(selected.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    execute(selected.value)
  }
}

function execute(i: number) {
  const cmd = filtered.value[i]
  if (!cmd) return
  close()
  setTimeout(() => cmd.action(), 10)
}

function fuzzyMatch(str: string, q: string): number | null {
  const s = str.toLowerCase()
  let si = 0, qi = 0, score = 0, lastMatch = -1
  while (si < s.length && qi < q.length) {
    if (s[si] === q[qi]) {
      score += (si - lastMatch - 1)
      lastMatch = si
      qi++
    }
    si++
  }
  return qi === q.length ? score : null
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightTitle(title: string) {
  const q = query.value.trim().toLowerCase()
  if (!q) return escHtml(title)
  const s = title.toLowerCase()
  const positions = new Set<number>()
  let si = 0, qi = 0
  while (si < s.length && qi < q.length) {
    if (s[si] === q[qi]) { positions.add(si); qi++ }
    si++
  }
  if (qi < q.length) return escHtml(title)
  return [...title].map((c, i) =>
    positions.has(i) ? `<mark>${escHtml(c)}</mark>` : escHtml(c)
  ).join('')
}

defineExpose({ open, close, toggle, openWithItems })
</script>

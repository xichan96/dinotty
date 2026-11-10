<template>
  <template v-for="(part, index) in parts" :key="index">
    <mark v-if="part.match">{{ part.text }}</mark>
    <template v-else>{{ part.text }}</template>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Part {
  text: string
  match: boolean
}

const props = defineProps<{
  text: string
  query: string
}>()

/**
 * Split text into plain and matching slices. The slices stay normal text nodes,
 * so workspace names cannot inject markup; only the match is wrapped in
 * `<mark>`.
 */
const parts = computed<Part[]>(() => {
  const needle = props.query.trim()
  if (!needle) return [{ text: props.text, match: false }]

  const lower = props.text.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  const result: Part[] = []
  let cursor = 0
  let found = lower.indexOf(lowerNeedle)

  while (found !== -1) {
    if (found > cursor) result.push({ text: props.text.slice(cursor, found), match: false })
    result.push({ text: props.text.slice(found, found + needle.length), match: true })
    cursor = found + needle.length
    found = lower.indexOf(lowerNeedle, cursor)
  }
  if (cursor < props.text.length) result.push({ text: props.text.slice(cursor), match: false })
  return result
})
</script>

<style scoped>
mark {
  padding: 0 1px;
  border-radius: 3px;
  background: rgba(86, 156, 214, 0.22);
  color: #cfe8ff;
}
</style>

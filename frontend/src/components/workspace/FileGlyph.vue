<template>
  <span
    class="file-glyph"
    :style="{ color: glyph.color, fontSize: `${size}px`, width: `${size + 1}px` }"
    aria-hidden="true"
    >{{ glyph.char }}</span
  >
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { fileTypeGlyph } from './fileTypeIcons'

const props = withDefaults(defineProps<{ path: string; size?: number }>(), { size: 15 })

const glyph = computed(() => fileTypeGlyph(props.path))
</script>

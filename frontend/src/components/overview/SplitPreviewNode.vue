<template>
  <div
    class="mc-split-node"
    :style="{ flex: node.ratio, flexDirection: node.direction === 'vertical' ? 'column' : 'row' }"
  >
    <template v-for="(child, i) in node.children" :key="i">
      <div
        v-if="child.children.length === 0"
        class="mc-split-leaf"
        :style="{ flex: child.ratio }"
      >
        <pre class="mc-card-text" v-html="child.html"></pre>
      </div>
      <SplitPreviewNode v-else :node="child" />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { PanePreviewNode } from '../../composables/useTabPreview'

defineOptions({ name: 'SplitPreviewNode' })

defineProps<{
  node: PanePreviewNode
}>()
</script>

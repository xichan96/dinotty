<!--
  Placeholder image viewer. The zoom/pan feature branch replaces this
  implementation; keep the public props (`src`, `alt`, `fileKey`) stable.
-->
<template>
  <div class="image-preview" :data-file-key="fileKey">
    <img class="image-preview-media" :src="src" :alt="alt" />
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    src: string
    alt?: string
    fileKey?: string
  }>(),
  {
    alt: '',
    fileKey: '',
  }
)
</script>

<style scoped>
.image-preview {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--bg-surface, #141414);
}

.image-preview-media {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
}
</style>

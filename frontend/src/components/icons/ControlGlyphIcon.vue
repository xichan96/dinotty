<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    data-key-symbol="ctrl"
  >
    <path d="m5 15 7-7 7 7" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{ size?: number }>()
</script>

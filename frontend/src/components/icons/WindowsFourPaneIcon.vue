<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    data-key-symbol="win"
  >
    <path d="M3 4.7 10.5 3.6v7.8H3z" />
    <path d="m11.5 3.5 9.5-1.4v9.3h-9.5z" />
    <path d="M3 12.6h7.5v7.8L3 19.3z" />
    <path d="M11.5 12.6H21v9.3l-9.5-1.4z" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{ size?: number }>()
</script>

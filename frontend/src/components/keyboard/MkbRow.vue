<template>
  <div class="mkb-row-wrap" :class="stagger ? `mkb-stagger-${stagger}` : ''">
    <div class="mkb-row" :class="rowClass">
      <MkbKey
        v-for="(k, i) in keys"
        :key="i"
        :k="k"
        :state="state"
        @key-press="(ch: string) => $emit('key-press', ch)"
        @app-action="(id: string) => $emit('app-action', id)"
        @special="(sp: string) => $emit('special', sp)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import MkbKey from './MkbKey.vue'
import type { KeyDef, ModState } from './mkbTypes'

defineProps<{
  keys: KeyDef[]
  state: ModState
  stagger?: string
  rowClass?: string
}>()

defineEmits<{
  'key-press': [ch: string]
  'app-action': [id: string]
  special: [sp: string]
}>()
</script>

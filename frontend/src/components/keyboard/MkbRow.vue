<template>
  <div class="mkb-row-wrap" :class="stagger ? `mkb-stagger-${stagger}` : ''">
    <div class="mkb-row" :class="rowClass">
      <MkbKey
        v-for="(k, i) in keys"
        :key="i"
        :k="k"
        :state="state"
        @key-press="(ch: string) => $emit('key-press', ch)"
        @app-action="(id: string, options: AppActionOptions) => $emit('app-action', id, options)"
        @special="(sp: string) => $emit('special', sp)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import MkbKey from './MkbKey.vue'
import type { AppActionOptions, KeyDef, ModState } from './mkbTypes'

defineProps<{
  keys: KeyDef[]
  state: ModState
  stagger?: string
  rowClass?: string
}>()

defineEmits<{
  'key-press': [ch: string]
  'app-action': [id: string, options: AppActionOptions]
  special: [sp: string]
}>()
</script>

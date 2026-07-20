<template>
  <button
    :class="['mkb-btn', k.cls, { 'mkb-active': isModActive }]"
    :id="k.id"
    :disabled="isDisabled"
    :style="{ flexGrow: k.g ?? 1, flexBasis: '0' }"
    :aria-label="k.aria || k.l || undefined"
    :title="k.aria || undefined"
    @touchstart.prevent="onTouchDown"
    @mousedown.prevent="onMouseDown"
    @touchend.prevent="onUp"
    @touchcancel.prevent="onUp"
    @mouseup="onUp"
    @mouseleave="onUp"
  >
    <component v-if="k.icon" :is="k.icon" :size="20" /><template v-else>{{
      displayLabel
    }}</template>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { KeyDef, ModState } from './mkbTypes'
import { settings } from '../../composables/useSettings'

let audioCtx: AudioContext | null = null

function playClick() {
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.value = 1800
  gain.gain.setValueAtTime(0.08, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.008)
  osc.connect(gain).connect(audioCtx.destination)
  osc.start()
  osc.stop(audioCtx.currentTime + 0.01)
}

function feedback() {
  if (settings.keyboard_sound) playClick()
}

const props = defineProps<{
  k: KeyDef
  state: ModState
}>()

const emit = defineEmits<{
  'key-press': [ch: string]
  'app-action': [id: string]
  special: [sp: string]
}>()

const isDisabled = computed(() => props.k.cls?.split(/\s+/).includes('mkb-disabled') ?? false)

const isModActive = computed(() => {
  const sp = props.k.sp
  return sp === 'ctrl' || sp === 'alt' || sp === 'shift' ? props.state[sp] : false
})

const displayLabel = computed(() => {
  if (props.k.sl && props.state.shift) return props.k.sl
  if (
    props.k.s &&
    props.k.s.length === 1 &&
    props.k.s >= 'a' &&
    props.k.s <= 'z' &&
    props.state.shift
  ) {
    return props.k.l.toUpperCase()
  }
  return props.k.l
})

let repeatTimer: ReturnType<typeof setTimeout> | null = null
let repeatInterval: ReturnType<typeof setInterval> | null = null
let touchActive = false

function fire() {
  if (props.k.act) {
    emit('app-action', props.k.act)
    return
  }
  if (props.k.sp) {
    emit('special', props.k.sp)
    return
  }
  if (!props.k.s) return

  let ch = props.k.s
  if (props.state.shift) {
    if (props.k.sl) ch = props.k.sl
    else if (ch >= 'a' && ch <= 'z') ch = ch.toUpperCase()
  }
  emit('key-press', ch)
}

function fireWithFeedback() {
  feedback()
  fire()
}

function onTouchDown() {
  touchActive = true
  fireWithFeedback()
  if (props.k.repeat && !props.k.act) {
    repeatTimer = setTimeout(() => {
      repeatInterval = setInterval(fireWithFeedback, 80)
    }, 400)
  }
}

function onMouseDown() {
  if (touchActive) return
  fireWithFeedback()
  if (props.k.repeat && !props.k.act) {
    repeatTimer = setTimeout(() => {
      repeatInterval = setInterval(fireWithFeedback, 80)
    }, 400)
  }
}

function onUp(e: Event) {
  if (repeatTimer) {
    clearTimeout(repeatTimer)
    repeatTimer = null
  }
  if (repeatInterval) {
    clearInterval(repeatInterval)
    repeatInterval = null
  }
  if (e.type === 'touchend' || e.type === 'touchcancel') {
    setTimeout(() => {
      touchActive = false
    }, 300)
  } else {
    touchActive = false
  }
}
</script>

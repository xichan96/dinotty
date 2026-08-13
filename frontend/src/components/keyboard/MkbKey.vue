<template>
  <button
    :class="['mkb-btn', k.cls, { 'mkb-active': isModActive, 'mkb-locked': isModLocked }]"
    :id="k.id"
    :disabled="isDisabled"
    :style="keyStyle"
    :aria-label="k.aria || k.l || undefined"
    :aria-pressed="isModifier ? isModActive : undefined"
    :title="k.aria || undefined"
    @touchstart="onTouchDown"
    @touchmove="onTouchMove"
    @mousedown.prevent="onMouseDown"
    @touchend="onUp"
    @touchcancel="onUp"
    @mouseup="onUp"
    @mouseleave="onUp"
  >
    <component v-if="k.icon" :is="k.icon" :size="20" /><template v-else>{{
      displayLabel
    }}</template>
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, type CSSProperties } from 'vue'
import type { AppActionOptions, KeyDef, ModState } from './mkbTypes'
import { settings } from '../../composables/useSettings'
import { parseKeyboardSpecial } from '../../utils/keyboardSpecialKeys'

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
  swipeAware?: boolean
}>()

const emit = defineEmits<{
  'key-press': [ch: string]
  'app-action': [id: string, options: AppActionOptions]
  special: [sp: string]
}>()

const isDisabled = computed(() => props.k.disabled === true)
const keyStyle = computed(() => {
  const configuredGrow = props.k.g
  const grow =
    typeof configuredGrow === 'number' && Number.isFinite(configuredGrow) && configuredGrow > 0
      ? configuredGrow
      : 1
  return {
    flexGrow: grow,
    flexBasis: '0',
  } as CSSProperties
})

const parsedSpecial = computed(() => parseKeyboardSpecial(props.k.sp))
const isModifier = computed(() => Boolean(parsedSpecial.value?.entry.modifier))
const isModActive = computed(() => {
  if (!isModifier.value) return false
  const modifier = parsedSpecial.value?.entry.modifier
  if (!modifier || !props.state[modifier]) return false
  const owner = props.state.activeSpecial?.[modifier]
  return !owner || owner === parsedSpecial.value?.id
})
const isModLocked = computed(() => {
  const modifier = parsedSpecial.value?.entry.modifier
  return modifier ? props.state.locked?.[modifier] === true : false
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
let touchResetTimer: ReturnType<typeof setTimeout> | null = null
let touchActive = false
let touchMoved = false
let touchRepeatStarted = false
let touchStartX = 0
let touchStartY = 0

function fire() {
  if (props.k.act) {
    const options = props.k.act === 'pasteTerminal' ? { autoEnter: props.k.autoEnter ?? true } : {}
    emit('app-action', props.k.act, options)
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

function startRepeat(fireAtThreshold: boolean) {
  repeatTimer = setTimeout(() => {
    repeatTimer = null
    if (fireAtThreshold) {
      touchRepeatStarted = true
      fireWithFeedback()
    }
    repeatInterval = setInterval(fireWithFeedback, 80)
  }, 400)
}

function onTouchDown(e: TouchEvent) {
  if (touchResetTimer) {
    clearTimeout(touchResetTimer)
    touchResetTimer = null
  }
  touchActive = true
  touchMoved = false
  touchRepeatStarted = false
  touchStartX = e.touches[0]?.clientX ?? 0
  touchStartY = e.touches[0]?.clientY ?? 0
  if (props.swipeAware) {
    if (props.k.repeat) startRepeat(true)
    return
  }
  e.preventDefault()
  fireWithFeedback()
  if (props.k.repeat) startRepeat(false)
}

function onTouchMove(e: TouchEvent) {
  if (!props.swipeAware || touchMoved) return
  const touch = e.touches[0]
  if (!touch) return
  if (Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY) < 10) return
  touchMoved = true
  stopRepeat()
}

function onMouseDown() {
  if (touchActive) return
  fireWithFeedback()
  if (props.k.repeat) {
    startRepeat(false)
  }
}

function onUp(e: Event) {
  const isTouch = e.type === 'touchend' || e.type === 'touchcancel'
  if (isTouch) {
    if (props.swipeAware) {
      if (e.type === 'touchend' && !touchMoved && !touchRepeatStarted) {
        e.preventDefault()
        fireWithFeedback()
      } else if (!touchMoved) {
        e.preventDefault()
      }
    } else {
      e.preventDefault()
    }
  }
  stopRepeat()
  if (isTouch) {
    touchResetTimer = setTimeout(() => {
      touchActive = false
      touchResetTimer = null
    }, 300)
  } else {
    touchActive = false
  }
}

function stopRepeat() {
  if (repeatTimer) {
    clearTimeout(repeatTimer)
    repeatTimer = null
  }
  if (repeatInterval) {
    clearInterval(repeatInterval)
    repeatInterval = null
  }
}

onBeforeUnmount(() => {
  stopRepeat()
  if (touchResetTimer) clearTimeout(touchResetTimer)
})
</script>

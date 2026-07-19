<template>
  <span v-if="monogramEnabled" class="ws-badge" :style="badgeStyle">{{ abbr }}</span>
  <component v-else :is="icon" :size="size" :stroke-width="2" class="ws-icon" />
</template>

<script setup lang="ts">
import { computed, reactive, watchPostEffect } from 'vue'
import { Folder, Server } from 'lucide-vue-next'
import { outlineColor } from '../utils/workspaceIcon'
import { useSettings } from '../composables/useSettings'
import { useIsMobile } from '../composables/useIsMobile'
import { resolveWorkspaceBadgeMode } from '../composables/useWorkspaceBadgeMode'

const cardBgs = reactive(new Map<string, string>())
const cardBgUsers = new Map<string, number>()
let cardBgObserver: MutationObserver | null = null

function refreshCardBgs() {
  const styles = getComputedStyle(document.documentElement)
  for (const name of cardBgUsers.keys()) {
    cardBgs.set(name, styles.getPropertyValue(name).trim())
  }
}

function observeCardBg(name: string) {
  cardBgUsers.set(name, (cardBgUsers.get(name) ?? 0) + 1)
  refreshCardBgs()
  if (!cardBgObserver) {
    cardBgObserver = new MutationObserver(refreshCardBgs)
    cardBgObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
  }
  return () => {
    const users = cardBgUsers.get(name)! - 1
    if (users) cardBgUsers.set(name, users)
    else {
      cardBgUsers.delete(name)
      cardBgs.delete(name)
    }
    if (!cardBgUsers.size) {
      cardBgObserver?.disconnect()
      cardBgObserver = null
    }
  }
}

const props = withDefaults(
  defineProps<{
  remote?: boolean
  size?: number
    abbr?: string
    color?: string
    cardBgVar?: string
  }>(),
  {
  remote: false,
  size: 18,
    abbr: '',
    color: '',
    cardBgVar: '--bg-surface',
  }
)

const icon = computed(() => (props.remote ? Server : Folder))

const { settings } = useSettings()
const { isMobile } = useIsMobile()
const monogramEnabled = computed(
  () => resolveWorkspaceBadgeMode(settings.workspace_badge_mode, isMobile.value).showMonogram
)

watchPostEffect((onCleanup) => {
  if (monogramEnabled.value) onCleanup(observeCardBg(props.cardBgVar))
})

const border = computed(() => {
  const cardBg = cardBgs.get(props.cardBgVar) ?? ''
  const isValidCardBg = /^#[0-9A-Fa-f]{6}$/.test(cardBg)
  return isValidCardBg && props.color ? outlineColor(props.color, cardBg) : props.color
})

const badgeStyle = computed(() => ({
  '--wb-border': border.value,
  '--wb-size': `${props.size}px`,
  '--wb-width': `${Math.round(props.size * 1.65)}px`,
  '--wb-font-size': `${Math.round(props.size * 0.56)}px`,
}))
</script>

<style scoped>
.ws-icon {
  color: var(--fg-bright);
  flex-shrink: 0;
}

.ws-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--wb-width);
  height: var(--wb-size);
  border: 1.5px solid var(--wb-border);
  border-radius: 5px;
  color: var(--fg-bright);
  font-weight: 600;
  font-size: var(--wb-font-size);
  line-height: 1;
  background: color-mix(in srgb, var(--wb-border) 14%, transparent);
  overflow: hidden;
  user-select: none;
  flex-shrink: 0;
}
</style>

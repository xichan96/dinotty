<template>
  <Teleport to="body">
    <div v-if="visible" class="mobile-input-guide-backdrop" @click.self="emit('close')">
      <section
        class="mobile-input-guide"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <header>
          <div class="guide-mark"><Keyboard :size="22" /></div>
          <div>
            <h2 :id="titleId">{{ t('mobileInputGuide.title') }}</h2>
            <p>{{ t('mobileInputGuide.subtitle') }}</p>
          </div>
          <button
            type="button"
            class="guide-close"
            :aria-label="t('mobileInputGuide.close')"
            @click="emit('close')"
          >
            <X :size="18" />
          </button>
        </header>

        <div class="guide-options">
          <button type="button" class="guide-option recommended" @click="choose('system')">
            <span class="guide-option-topline">
              <span class="guide-option-icon"><Languages :size="22" /></span>
              <span class="guide-badge">{{ t('mobileInputGuide.system.recommended') }}</span>
            </span>
            <strong>{{ t('mobileInputGuide.system.title') }}</strong>
            <span class="guide-description">{{ t('mobileInputGuide.system.description') }}</span>
            <span class="guide-kept"
              ><ShieldCheck :size="15" />{{ t('mobileInputGuide.shortcutsKept') }}</span
            >
          </button>

          <button type="button" class="guide-option" @click="choose('builtin')">
            <span class="guide-option-topline">
              <span class="guide-option-icon"><PanelTop :size="22" /></span>
            </span>
            <strong>{{ t('mobileInputGuide.builtin.title') }}</strong>
            <span class="guide-description">{{ t('mobileInputGuide.builtin.description') }}</span>
            <span class="guide-kept"
              ><ShieldCheck :size="15" />{{ t('mobileInputGuide.shortcutsKept') }}</span
            >
          </button>
        </div>

        <button type="button" class="guide-later" @click="emit('close')">
          {{ t('mobileInputGuide.close') }}
        </button>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Keyboard, Languages, PanelTop, ShieldCheck, X } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import type { MobileInputMode } from '../../composables/useSettings'

defineProps<{ visible: boolean }>()

const emit = defineEmits<{
  choose: [mode: MobileInputMode]
  close: []
}>()

const { t } = useI18n()
const titleId = 'mobile-input-guide-title'

function choose(mode: MobileInputMode) {
  emit('choose', mode)
}
</script>

<style scoped>
.mobile-input-guide-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2300;
  display: grid;
  place-items: end center;
  padding: 18px;
  background:
    radial-gradient(
      circle at 50% 100%,
      color-mix(in srgb, var(--accent), transparent 78%),
      transparent 48%
    ),
    rgba(4, 7, 10, 0.72);
  backdrop-filter: blur(8px);
}

.mobile-input-guide {
  width: min(680px, 100%);
  padding: 20px;
  border: 1px solid color-mix(in srgb, var(--border), white 9%);
  border-radius: 18px;
  background: color-mix(in srgb, var(--bg-surface), black 4%);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.48);
  animation: guide-rise 180ms ease-out;
}

header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: start;
}

.guide-mark,
.guide-option-icon {
  display: grid;
  place-items: center;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent), transparent 86%);
}

.guide-mark {
  width: 42px;
  height: 42px;
  border-radius: 12px;
}

h2 {
  margin: 1px 0 5px;
  color: var(--fg-bright);
  font-size: 18px;
}

header p {
  margin: 0;
  color: var(--fg-muted);
  font-size: 13px;
  line-height: 1.45;
}

.guide-close {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: var(--fg-muted);
}

.guide-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.guide-option {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-height: 196px;
  padding: 15px;
  border: 1px solid var(--border);
  border-radius: 13px;
  color: var(--fg);
  background: var(--bg);
  text-align: left;
  transition:
    border-color 120ms ease,
    transform 120ms ease,
    background 120ms ease;
}

.guide-option:active {
  transform: scale(0.985);
}

.guide-option.recommended {
  border-color: color-mix(in srgb, var(--accent), white 15%);
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--accent), transparent 91%),
    var(--bg)
  );
}

.guide-option-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.guide-option-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
}

.guide-badge {
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--bg);
  background: var(--accent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.guide-option strong {
  margin-top: 13px;
  color: var(--fg-bright);
  font-size: 15px;
}

.guide-description {
  margin-top: 6px;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.48;
}

.guide-kept {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin-top: auto;
  padding-top: 14px;
  color: var(--color-green);
  font-size: 11px;
  line-height: 1.35;
}

.guide-kept svg {
  flex: 0 0 auto;
}

.guide-later {
  display: block;
  margin: 14px auto 0;
  padding: 5px 12px;
  color: var(--fg-muted);
  font-size: 12px;
}

@keyframes guide-rise {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
}

@media (min-width: 700px) {
  .mobile-input-guide-backdrop {
    place-items: center;
  }
}

@media (max-width: 560px) {
  .mobile-input-guide-backdrop {
    padding: 8px;
  }
  .mobile-input-guide {
    padding: 16px;
    border-radius: 16px;
  }
  .guide-options {
    grid-template-columns: 1fr;
  }
  .guide-option {
    min-height: 166px;
  }
}
</style>

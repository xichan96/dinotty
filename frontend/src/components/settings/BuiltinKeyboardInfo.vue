<template>
  <div class="builtin-keyboard-info">
    <div class="bki-hero">
      <div class="bki-icon"><Keyboard :size="22" /></div>
      <div>
        <h3>{{ t('plugin.builtinKeyboard.title') }}</h3>
        <p class="bki-subtitle">{{ t('plugin.builtinKeyboard.subtitle') }}</p>
      </div>
    </div>

    <ul class="bki-features">
      <li>
        <Check :size="14" /><span>{{ t('plugin.builtinKeyboard.feature.layout') }}</span>
      </li>
      <li>
        <Check :size="14" /><span>{{ t('plugin.builtinKeyboard.feature.bottom') }}</span>
      </li>
      <li>
        <Check :size="14" /><span>{{ t('plugin.builtinKeyboard.feature.behavior') }}</span>
      </li>
    </ul>

    <p class="bki-hint">{{ t('plugin.builtinKeyboard.settingsHint') }}</p>

    <button class="bki-go" @click="openSettings">
      <Settings2 :size="14" />
      <span>{{ t('plugin.builtinKeyboard.goSettings') }}</span>
      <ArrowRight :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ArrowRight, Check, Keyboard, Settings2 } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()

function openSettings() {
  window.dispatchEvent(new CustomEvent('dinotty:open-settings-keyboard'))
}
</script>

<style scoped>
.builtin-keyboard-info {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bki-hero {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.bki-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.bki-hero h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg-bright);
  margin-bottom: 4px;
}

.bki-subtitle {
  font-size: 12px;
  color: var(--fg-muted);
  line-height: 1.5;
}

.bki-features {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  margin: 0;
}

.bki-features li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--fg);
  line-height: 1.4;
}

.bki-features li svg {
  flex-shrink: 0;
  color: var(--accent);
}

.bki-hint {
  font-size: 12px;
  color: var(--fg-muted);
  line-height: 1.6;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}

.bki-go {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--fg-bright);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s,
    background 0.15s;
}

.bki-go:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-hover);
}
</style>

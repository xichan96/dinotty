<template>
  <div class="srv-mgr-form">
    <p v-if="!draft" class="srv-mgr-form-empty">{{ t('server.empty') }}</p>

    <template v-else>
      <label class="srv-mgr-field">
        <span class="srv-mgr-label">{{ t('server.name') }}</span>
        <input
          v-model="draft.name"
          class="srv-mgr-input"
          :placeholder="t('server.newName')"
          @input="$emit('edit')"
        />
      </label>

      <label class="srv-mgr-field">
        <span class="srv-mgr-label">{{ t('server.addMethod') }}</span>
        <select
          class="srv-mgr-select"
          :value="transportKey"
          @change="onTransportSelected(($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ t('server.directUrl') }}</option>
          <option v-if="draft.transport && !transport" :value="transportKey" disabled>
            {{ t('server.transportUnavailable') }}
          </option>
          <option
            v-for="item in transports"
            :key="`${item.pluginId}:${item.id}`"
            :value="`${item.pluginId}:${item.id}`"
            :disabled="!item.available"
          >
            {{ item.label }}{{ item.available ? '' : ` (${t('server.transportUnavailable')})` }}
          </option>
        </select>
        <p v-if="transport?.description" class="srv-mgr-hint">{{ transport.description }}</p>
        <p v-if="transport && !transport.available" class="srv-mgr-warn">
          <TriangleAlert :size="12" />{{ transport.error || t('server.transportUnavailableDetail') }}
        </p>
        <p v-else-if="draft.transport && !transport" class="srv-mgr-warn">
          <TriangleAlert :size="12" />{{ t('server.transportUnavailableDetail') }}
        </p>
      </label>

      <component
        :is="transport.component"
        v-if="transport && transport.available"
        :mode="transportMode"
        :server="{ id: draft.id, name: draft.name, url: draft.url }"
        :on-prepared="onPrepared"
      />

      <label class="srv-mgr-field">
        <span class="srv-mgr-label">{{ t('server.url') }}</span>
        <input
          v-model="draft.url"
          class="srv-mgr-input srv-mgr-input--mono"
          placeholder="http://192.168.1.5:58901"
          spellcheck="false"
          :disabled="!!draft.transport"
          @input="$emit('edit')"
        />
      </label>

      <div class="srv-mgr-field">
        <span class="srv-mgr-label">
          {{ t('server.token') }}
          <span v-if="draft.tokenCleared" class="srv-mgr-badge warn">
            {{ t('server.tokenCleared') }}
          </span>
          <span v-else-if="draftWillHaveToken(draft)" class="srv-mgr-badge">
            {{ t('server.tokenConfigured') }}
          </span>
        </span>
        <div class="srv-mgr-token-row">
          <input
            v-model="draft.tokenInput"
            class="srv-mgr-input srv-mgr-input--mono"
            type="password"
            autocomplete="off"
            :disabled="draft.tokenCleared"
            :placeholder="draft.hasToken ? t('server.tokenKeep') : ''"
            @input="onTokenInput"
          />
          <button class="srv-mgr-btn" @click="toggleClear">
            {{ draft.tokenCleared ? t('server.tokenUndoClear') : t('server.tokenClear') }}
          </button>
        </div>
        <!-- An upstream with no token lets anyone who can reach it in as admin,
             so this is a security warning rather than a hint. -->
        <p v-if="!draftWillHaveToken(draft)" class="srv-mgr-warn">
          <TriangleAlert :size="12" />
          <span>{{ t('server.tokenWarning') }}</span>
        </p>
        <p v-else-if="draft.hasToken && !draft.tokenDirty" class="srv-mgr-hint">
          {{ t('server.tokenKeep') }}
        </p>
      </div>

      <div class="srv-mgr-test">
        <button
          class="srv-mgr-btn srv-mgr-btn--test"
          :disabled="testing || !draft.url.trim()"
          @click="$emit('test')"
        >
          <span v-if="testing" class="srv-mgr-spin" />
          {{ testing ? t('server.testing') : t('server.test') }}
        </button>
        <button class="srv-mgr-btn srv-mgr-btn--danger" @click="$emit('request-delete')">
          <Trash2 :size="13" />
          {{ t('server.delete') }}
        </button>
      </div>

      <!-- The result belongs to the (url, token) pair that was tested, so the
           parent drops it on any edit rather than letting a stale "reachable"
           sit under a host that was just changed. -->
      <div v-if="testing" class="srv-mgr-result"><span class="srv-mgr-spin" />{{ t('server.testing') }}</div>
      <div v-else-if="result" class="srv-mgr-result" :class="resultOk ? 'ok' : 'bad'">
        <template v-if="!result.reachable">
          <span class="srv-mgr-result-line">{{ failedText }}</span>
        </template>
        <template v-else>
          <span class="srv-mgr-result-line ok">
            <Check :size="12" />{{ t('server.testOk') }}
            <template v-if="result.settingsVersion !== null">
              · {{ t('server.testVersion', { version: result.settingsVersion }) }}
            </template>
          </span>
          <!-- No token on the far side is a warning, not a detail. -->
          <span v-if="!result.tokenConfigured" class="srv-mgr-result-line warn">
            <TriangleAlert :size="12" />{{ t('server.testNoToken') }}
          </span>
          <span v-if="result.tokenValid === false" class="srv-mgr-result-line bad">
            <TriangleAlert :size="12" />{{ t('server.testTokenRejected') }}
          </span>
          <span
            v-else-if="result.tokenValid === null && result.tokenConfigured"
            class="srv-mgr-result-line muted"
          >
            {{ t('server.testNoCredential') }}
          </span>
          <!-- Absent is "the server cannot say", never "incompatible". -->
          <span
            v-else-if="result.tokenValid === true && result.settingsVersion === null"
            class="srv-mgr-result-line muted"
          >
            {{ t('server.testOldServer') }}
          </span>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Check, Trash2, TriangleAlert } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import {
  draftWillHaveToken,
  probeFailureText,
  type ProbeResult,
  type RemoteServerDraft,
} from '../../composables/useRemoteServerAdmin'
import type { RegisteredRemoteServerTransport } from '../../composables/useRemoteServerTransports'
import type { RemoteServerTransportResult } from '../../../../plugin-api/index'

const props = defineProps<{
  draft: RemoteServerDraft | null
  testing: boolean
  result: ProbeResult | null
  transports: RegisteredRemoteServerTransport[]
  savedTransport: { pluginId: string; transportId: string } | null
}>()

const emit = defineEmits<{
  /** Any field changed - the parent invalidates the last test result. */
  edit: []
  test: []
  'request-delete': []
  'select-transport': [ref: { pluginId: string; transportId: string } | null]
  prepared: [result: RemoteServerTransportResult]
}>()

const { t } = useI18n()

const resultOk = computed(() => {
  const r = props.result
  return !!r && r.reachable && r.tokenValid !== false
})

const failedText = computed(() => {
  const draft = props.draft
  if (!props.result || !draft) return ''
  return probeFailureText(t, props.result, draft.url.trim()) ?? ''
})

const transportKey = computed(() => {
  const ref = props.draft?.transport
  return ref ? `${ref.pluginId}:${ref.transportId}` : ''
})

const transport = computed(() =>
  props.draft?.transport
    ? props.transports.find(
        (item) => item.pluginId === props.draft?.transport?.pluginId && item.id === props.draft?.transport?.transportId
      )
    : undefined
)

const transportMode = computed(() =>
  props.draft?.transport &&
  props.draft.transport.pluginId === props.savedTransport?.pluginId &&
  props.draft.transport.transportId === props.savedTransport?.transportId
    ? 'update'
    : 'create'
)

function onTransportSelected(value: string) {
  if (!value) {
    emit('select-transport', null)
    return
  }
  const item = props.transports.find((candidate) => `${candidate.pluginId}:${candidate.id}` === value)
  if (item) emit('select-transport', { pluginId: item.pluginId, transportId: item.id })
}

function onPrepared(result: RemoteServerTransportResult) {
  emit('prepared', result)
}

/**
 * Keep the two token flags in step with what was typed.
 *
 * Clearing the field means "keep", never "clear" - a destructive clear is only
 * ever the explicit button below. That asymmetry is deliberate: backspacing is
 * not a decision, and there is no way to recover a wiped credential from here.
 */
function onTokenInput() {
  const draft = props.draft
  if (!draft) return
  draft.tokenDirty = draft.tokenInput !== ''
  // Typing again after asking to clear cancels the clear.
  draft.tokenCleared = false
  emit('edit')
}

function toggleClear() {
  const draft = props.draft
  if (!draft) return
  draft.tokenCleared = !draft.tokenCleared
  if (draft.tokenCleared) {
    draft.tokenInput = ''
    draft.tokenDirty = false
  }
  emit('edit')
}
</script>

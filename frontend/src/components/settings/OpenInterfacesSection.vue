<template>
  <CollapsibleSection :title="t('settings.group.openApi')" level="group" default-open>
    <section class="settings-section">
      <h3>{{ t('settings.keyboard.openApi') }}</h3>
      <p class="settings-hint">{{ t('settings.keyboard.openApiHint') }}</p>
      <div class="settings-row">
        <label>{{ t('settings.keyboard.openApiEnabled') }}</label>
        <label class="toggle">
          <input v-model="settings.open_api.enabled" type="checkbox" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>

      <template v-if="settings.open_api.enabled">
        <div class="api-test">
          <div class="api-method-row">
            <span class="method-badge">POST</span>
            <span class="api-url">/api/input</span>
            <div class="mode-tabs">
              <button
                :class="{ active: openApiMode === 'form' }"
                @click="switchOpenApiMode('form')"
              >
                {{ t('notification.testForm') }}
              </button>
              <button :class="{ active: openApiMode === 'raw' }" @click="switchOpenApiMode('raw')">
                {{ t('notification.testRaw') }}
              </button>
            </div>
          </div>

          <template v-if="openApiMode === 'form'">
            <div class="api-field">
              <label>pane_id</label>
              <input
                v-model="openApiPaneId"
                type="text"
                :placeholder="t('settings.keyboard.openApiPaneHint')"
              />
            </div>
            <div class="api-field">
              <label>data <span class="required">*</span></label>
              <input v-model="openApiData" type="text" placeholder="hello\n" />
            </div>
          </template>

          <template v-else>
            <textarea v-model="openApiRawJson" class="raw-editor" rows="5" spellcheck="false" />
            <span v-if="openApiRawError" class="api-result err">{{ openApiRawError }}</span>
          </template>

          <div class="api-actions">
            <button
              class="send-btn"
              :disabled="!openApiCanSend || openApiSending"
              @click="sendOpenApiTest"
            >
              {{ openApiSending ? '...' : `▶ ${t('settings.keyboard.openApiSend')}` }}
            </button>
            <span v-if="openApiResult" class="api-result" :class="openApiResultOk ? 'ok' : 'err'">{{
              openApiResult
            }}</span>
          </div>

          <details class="open-api-curl">
            <summary>curl {{ t('settings.keyboard.openApiExample') }}</summary>
            <code class="open-api-curl-code"
              >curl -X POST {{ apiBaseUrl }}/api/input \ -H "Authorization: Bearer &lt;token&gt;" \
              -H "Content-Type: application/json" \ -d '{"data":"hello\\n"}'</code
            >
          </details>
        </div>
      </template>
    </section>

    <section class="settings-section">
      <h3>{{ t('settings.openApi.agentApi') }}</h3>
      <p class="settings-hint">{{ t('settings.openApi.agentApiHint') }}</p>
      <p class="settings-hint">{{ t('settings.openApi.agentApiTokenHint') }}</p>
    </section>

    <section class="settings-section">
      <h3>{{ t('settings.keyboard.mcp') }}</h3>
      <p class="settings-hint">{{ t('settings.keyboard.mcpHint') }}</p>
      <div class="settings-row">
        <label>{{ t('settings.keyboard.mcpHttp') }}</label>
        <label class="toggle">
          <input v-model="settings.mcp.http_enabled" type="checkbox" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <p class="settings-hint">{{ t('settings.keyboard.mcpHttpHint') }}</p>
      <div class="settings-row">
        <label>{{ t('settings.keyboard.mcpStdio') }}</label>
        <label class="toggle">
          <input v-model="settings.mcp.stdio_enabled" type="checkbox" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <p class="settings-hint">{{ t('settings.keyboard.mcpStdioHint') }}</p>

      <details class="open-api-curl">
        <summary>{{ t('settings.keyboard.mcpExample') }}</summary>
        <code class="open-api-curl-code"
          >{&quot;mcpServers&quot;:{&quot;dinotty&quot;:{&quot;command&quot;:&quot;/path/to/dinotty-server&quot;,&quot;args&quot;:[&quot;--mcp-stdio&quot;,&quot;--port&quot;,&quot;8999&quot;]}}}</code
        >
      </details>
    </section>
  </CollapsibleSection>
</template>

<script setup lang="ts">
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { useOpenApiTest } from '../../composables/useOpenApiTest'
import CollapsibleSection from './CollapsibleSection.vue'

const { settings, saveSettings } = useSettings()
const { t } = useI18n()

const {
  openApiPaneId,
  openApiData,
  openApiMode,
  openApiRawJson,
  openApiRawError,
  openApiResult,
  openApiResultOk,
  openApiSending,
  apiBaseUrl,
  openApiCanSend,
  switchOpenApiMode,
  sendOpenApiTest,
} = useOpenApiTest()
</script>

<style scoped>
.api-test {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-surface);
  margin-top: 8px;
}
.api-method-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.mode-tabs {
  margin-left: auto;
  display: flex;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.mode-tabs button {
  background: none;
  border: none;
  color: var(--fg-muted);
  font-size: 11px;
  padding: 2px 10px;
  cursor: pointer;
}
.mode-tabs button.active {
  background: var(--fg-muted);
  color: var(--bg);
}
.raw-editor {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font-family: monospace;
  font-size: 12px;
  resize: vertical;
  line-height: 1.5;
}
.method-badge {
  background: var(--success);
  color: var(--bg);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 3px;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
.api-url {
  font-family: monospace;
  font-size: 12px;
  color: var(--fg);
}
.api-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.api-field label {
  width: 110px;
  flex-shrink: 0;
  font-size: 12px;
  font-family: monospace;
  color: var(--fg-muted);
}
.api-field .required {
  color: var(--danger);
}
.api-field input,
.api-field select {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font-size: 12px;
  font-family: monospace;
}
.api-field input::placeholder {
  color: var(--fg-muted);
}
.api-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
}
.send-btn {
  background: var(--success);
  color: var(--bg);
  border: none;
  border-radius: 4px;
  padding: 5px 16px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.send-btn:hover {
  opacity: 0.85;
}
.send-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.api-result {
  font-size: 12px;
  font-family: monospace;
}
.api-result.ok {
  color: var(--success);
}
.api-result.err {
  color: var(--danger);
}
.open-api-curl {
  font-size: 11px;
  color: var(--fg-muted);
  margin-top: 4px;
}
.open-api-curl summary {
  cursor: pointer;
}
.open-api-curl-code {
  display: block;
  margin-top: 6px;
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>

import { ref, computed, type ComputedRef } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import { unescapeData } from './useKeySequenceUtils'

// Reserved as an options bag for future inputs.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OpenApiTestOptions {
  // no inputs currently needed
}

export interface OpenApiTest {
  openApiPaneId: ReturnType<typeof ref<string>>
  openApiData: ReturnType<typeof ref<string>>
  openApiMode: ReturnType<typeof ref<'form' | 'raw'>>
  openApiRawJson: ReturnType<typeof ref<string>>
  openApiRawError: ReturnType<typeof ref<string>>
  openApiResult: ReturnType<typeof ref<string>>
  openApiResultOk: ReturnType<typeof ref<boolean>>
  openApiSending: ReturnType<typeof ref<boolean>>
  apiBaseUrl: ReturnType<typeof ref<string>>
  openApiCanSend: ComputedRef<boolean>
  switchOpenApiMode: (mode: 'form' | 'raw') => void
  sendOpenApiTest: () => Promise<void>
}

export function useOpenApiTest(_opts?: OpenApiTestOptions): OpenApiTest {
  const openApiPaneId = ref('')
  const openApiData = ref('')
  const openApiMode = ref<'form' | 'raw'>('form')
  const openApiRawJson = ref('{\n  "data": "hello\\n"\n}')
  const openApiRawError = ref('')
  const openApiResult = ref('')
  const openApiResultOk = ref(false)
  const openApiSending = ref(false)
  const apiBaseUrl = ref('')
  getApiBase().then((b) => {
    apiBaseUrl.value = b
  })

  const openApiCanSend = computed(() => {
    if (openApiMode.value === 'form') return !!openApiData.value
    try {
      JSON.parse(openApiRawJson.value)
      return true
    } catch {
      return false
    }
  })

  function switchOpenApiMode(mode: 'form' | 'raw') {
    if (mode === openApiMode.value) return
    if (mode === 'raw') {
      const obj: Record<string, string> = { data: openApiData.value }
      if (openApiPaneId.value) obj.pane_id = openApiPaneId.value
      openApiRawJson.value = JSON.stringify(obj, null, 2)
    } else {
      try {
        const obj = JSON.parse(openApiRawJson.value)
        openApiPaneId.value = obj.pane_id ?? ''
        openApiData.value = obj.data ?? ''
      } catch {}
    }
    openApiRawError.value = ''
    openApiMode.value = mode
  }

  async function sendOpenApiTest() {
    openApiResult.value = ''
    openApiResultOk.value = false
    openApiSending.value = true
    try {
      let payload: Record<string, string>
      if (openApiMode.value === 'form') {
        payload = { data: unescapeData(openApiData.value) }
        if (openApiPaneId.value) payload.pane_id = openApiPaneId.value
      } else {
        try {
          payload = JSON.parse(openApiRawJson.value)
        } catch (e: any) {
          openApiRawError.value = e.message
          openApiSending.value = false
          return
        }
      }
      await getApiBase()
      const res = await authFetch(apiUrl('/api/input'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (res.ok) {
        openApiResultOk.value = true
        openApiResult.value = 'OK'
      } else {
        openApiResult.value = json.error || `HTTP ${res.status}`
      }
    } catch (e: any) {
      openApiResult.value = e.message || 'error'
    }
    openApiSending.value = false
  }

  return {
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
  }
}

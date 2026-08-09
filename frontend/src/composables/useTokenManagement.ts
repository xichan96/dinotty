import { nextTick, onMounted, ref, type Ref } from 'vue'
import { apiUrl, authFetch, fetchServerToken, getAuthToken, setAuthToken } from './apiBase'
import { uiConfirm } from './useConfirm'
import { copyToClipboard } from '../utils/clipboard'

export interface TokenManagementOptions {
  t: (key: string) => string
  onTokenChanged: () => void
}

export interface TokenManagement {
  currentToken: Ref<string>
  tokenVisible: Ref<boolean>
  tokenCopied: Ref<boolean>
  customToken: Ref<string>
  tokenSaving: Ref<boolean>
  tokenError: Ref<string>
  tokenEditing: Ref<boolean>
  tokenInputRef: Ref<HTMLInputElement | null>
  copyToken: () => Promise<void>
  startEditToken: () => void
  cancelEditToken: () => void
  saveToken: () => Promise<void>
  regenerateToken: () => Promise<void>
}

export function useTokenManagement(opts: TokenManagementOptions): TokenManagement {
  const { t, onTokenChanged } = opts

  const currentToken = ref('')
  const tokenVisible = ref(false)
  const tokenCopied = ref(false)
  const customToken = ref('')
  const tokenSaving = ref(false)
  const tokenError = ref('')
  const tokenEditing = ref(false)
  const tokenInputRef = ref<HTMLInputElement | null>(null)

  async function copyToken() {
    await copyToClipboard(currentToken.value)
    tokenCopied.value = true
    setTimeout(() => {
      tokenCopied.value = false
    }, 2000)
  }

  function startEditToken() {
    customToken.value = ''
    tokenEditing.value = true
    tokenError.value = ''
    nextTick(() => tokenInputRef.value?.focus())
  }

  function cancelEditToken() {
    customToken.value = ''
    tokenEditing.value = false
    tokenError.value = ''
  }

  async function saveToken() {
    const val = customToken.value.trim()
    if (val.length < 8) return
    await applyNewToken(val)
    tokenEditing.value = false
    customToken.value = ''
  }

  async function regenerateToken() {
    if (
      !(await uiConfirm(t('settings.token.confirmRegenerate'), {
        title: t('settings.token.regenerate'),
        confirmText: t('settings.token.regenerate'),
        cancelText: t('filePreview.cancel'),
      }))
    )
      return
    const buf = new Uint8Array(32)
    crypto.getRandomValues(buf)
    const token = Array.from(buf)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    await applyNewToken(token)
  }

  async function applyNewToken(token: string) {
    tokenSaving.value = true
    tokenError.value = ''
    try {
      const res = await authFetch(apiUrl('/api/token'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (res.ok) {
        setAuthToken(token)
        currentToken.value = token
        onTokenChanged()
      } else {
        tokenError.value = t('settings.token.saveFailed')
      }
    } catch {
      tokenError.value = t('settings.token.saveFailed')
    } finally {
      tokenSaving.value = false
    }
  }

  onMounted(async () => {
    currentToken.value = (await fetchServerToken()) || getAuthToken()
  })

  return {
    currentToken,
    tokenVisible,
    tokenCopied,
    customToken,
    tokenSaving,
    tokenError,
    tokenEditing,
    tokenInputRef,
    copyToken,
    startEditToken,
    cancelEditToken,
    saveToken,
    regenerateToken,
  }
}

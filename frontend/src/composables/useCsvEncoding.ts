import { onMounted, ref, watch, type Ref } from 'vue'

export interface CsvEncodingOptions {
  content: Ref<string>
  filePath: Ref<string>
  rawUrl: Ref<string>
  truncated: Ref<boolean>
  t: (key: string) => string
  onFileChanged?: () => void
}

export interface CsvEncoding {
  selectedEncoding: Ref<string>
  rawBytes: Ref<ArrayBuffer | null>
  encodingLoading: Ref<boolean>
  encodingError: Ref<string>
  displayedContent: Ref<string>
  displayedContentIsTruncated: Ref<boolean>
  changeEncoding: () => Promise<void>
  loadCompleteContent: () => Promise<void>
}

export function useCsvEncoding(opts: CsvEncodingOptions): CsvEncoding {
  const { content, filePath, rawUrl, truncated, t, onFileChanged } = opts

  const selectedEncoding = ref('utf-8')
  const rawBytes = ref<ArrayBuffer | null>(null)
  const encodingLoading = ref(false)
  const encodingError = ref('')
  const displayedContent = ref(content.value)
  const displayedContentIsTruncated = ref(truncated.value)

  async function loadRawBytes(): Promise<ArrayBuffer> {
    if (rawBytes.value) return rawBytes.value
    if (!rawUrl.value) throw new Error(t('csvPreview.rawUnavailable'))
    const response = await fetch(rawUrl.value)
    if (!response.ok) throw new Error(t('csvPreview.rawLoadFailed'))
    rawBytes.value = await response.arrayBuffer()
    return rawBytes.value
  }

  async function changeEncoding(): Promise<void> {
    encodingError.value = ''

    if (selectedEncoding.value === 'utf-8') {
      if (rawBytes.value) {
        const textDecoder = new TextDecoder('utf-8')
        displayedContent.value = textDecoder.decode(rawBytes.value)
        displayedContentIsTruncated.value = false
      } else {
        displayedContent.value = content.value
        displayedContentIsTruncated.value = truncated.value
      }
      return
    }

    encodingLoading.value = true
    try {
      const bytes = await loadRawBytes()
      const textDecoder = new TextDecoder(selectedEncoding.value)
      displayedContent.value = textDecoder.decode(bytes)
      displayedContentIsTruncated.value = false
    } catch (error) {
      encodingError.value = error instanceof Error ? error.message : String(error)
    } finally {
      encodingLoading.value = false
    }
  }

  async function loadCompleteContent(): Promise<void> {
    const contentIsComplete = content.value !== '' && !truncated.value
    if (contentIsComplete || !rawUrl.value) return

    encodingLoading.value = true
    encodingError.value = ''
    try {
      const bytes = await loadRawBytes()
      const textDecoder = new TextDecoder('utf-8')
      displayedContent.value = textDecoder.decode(bytes)
      displayedContentIsTruncated.value = false
    } catch (error) {
      encodingError.value = error instanceof Error ? error.message : String(error)
    } finally {
      encodingLoading.value = false
    }
  }

  onMounted(function initializeCompleteContent() {
    void loadCompleteContent()
  })

  watch([content, filePath, truncated], function synchronizeSelectedFile(values) {
    const newContent = values[0]
    const newContentIsTruncated = values[2]
    displayedContent.value = newContent
    displayedContentIsTruncated.value = newContentIsTruncated
    rawBytes.value = null
    selectedEncoding.value = 'utf-8'
    encodingError.value = ''

    onFileChanged?.()

    if (newContent === '' || newContentIsTruncated) void loadCompleteContent()
  })

  return {
    selectedEncoding,
    rawBytes,
    encodingLoading,
    encodingError,
    displayedContent,
    displayedContentIsTruncated,
    changeEncoding,
    loadCompleteContent,
  }
}

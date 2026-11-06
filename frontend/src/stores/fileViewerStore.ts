import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SyncOpenFileViewer } from '../types/protocol'

/**
 * The one file viewer currently shown as an in-app overlay.
 *
 * Only one request is presented at a time: a newer `open_file_viewer` message
 * replaces the current one. Desktop opens a native window instead and never
 * touches this store (see `useFileViewerPresenter`).
 */
export const useFileViewerStore = defineStore('fileViewer', () => {
  const request = ref<SyncOpenFileViewer | null>(null)

  function show(next: SyncOpenFileViewer): void {
    request.value = next
  }

  function hide(): void {
    request.value = null
  }

  return { request, show, hide }
})

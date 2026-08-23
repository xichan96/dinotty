// Host singleton bridge: upload channel. `useUpload` performs authenticated
// uploads against the host's /api/uploads endpoint (cookie/bearer handled by
// the host transport); `formatMB` is a pure formatter re-exported for
// convenience.
const host = (
  window as unknown as {
    __DINOTTY_HOST__?: {
      useUpload: {
        useUpload: () => Record<string, unknown>
        formatMB: (bytes: number) => string
      }
    }
  }
).__DINOTTY_HOST__?.useUpload
if (!host) {
  throw new Error('host bridge missing: window.__DINOTTY_HOST__.useUpload not assigned')
}

export const useUpload = host.useUpload
export const formatMB = host.formatMB

export type UploadProgress = { loaded: number; total: number }

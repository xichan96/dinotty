// Host singleton bridge: the host's vue-toastification instance. Toasts
// fired from plugin code go through the same toast stack as host
// notifications. `POSITION` is the vue-toastification enum re-export (the
// host's utils/toastPosition resolves responsive positions from it).
const host = (
  window as unknown as {
    __DINOTTY_HOST__?: {
      toast: {
        useToast: () => {
          success: (msg: string, opts?: unknown) => unknown
          error: (msg: string, opts?: unknown) => unknown
          info: (msg: string, opts?: unknown) => unknown
          warning: (msg: string, opts?: unknown) => unknown
          [k: string]: unknown
        }
        POSITION: Record<string, string>
      }
    }
  }
).__DINOTTY_HOST__?.toast
if (!host) {
  throw new Error('host bridge missing: window.__DINOTTY_HOST__.toast not assigned')
}

export const useToast = host.useToast
export const POSITION = host.POSITION

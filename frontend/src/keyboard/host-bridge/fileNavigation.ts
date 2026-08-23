// Host singleton bridge: redirects plugin imports of the host's
// `composables/useFileNavigation` to the host module exposed on
// `window.__DINOTTY_HOST__`, so `selectedPath` stays the host's ref.
const host = (
  window as unknown as {
    __DINOTTY_HOST__?: {
      useFileNavigation: {
        useSelectedPath: () => { selectedPath: { value: string | null } }
      }
    }
  }
).__DINOTTY_HOST__?.useFileNavigation
if (!host) {
  throw new Error('host bridge missing: window.__DINOTTY_HOST__.useFileNavigation not assigned')
}

export const useSelectedPath = host.useSelectedPath

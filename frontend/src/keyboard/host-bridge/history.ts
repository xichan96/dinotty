// Host singleton bridge: redirects plugin imports of the host's
// `composables/useHistory` to the host module exposed on
// `window.__DINOTTY_HOST__`, so `suggestions` stays the host's ref.
const host = (
  window as unknown as {
    __DINOTTY_HOST__?: {
      useHistory: {
        useHistory: () => {
          suggestions: { command: string; frequency: number }[] & { [k: string]: unknown }
          fetchSuggestions(
            prefix?: string,
            limit?: number
          ): Promise<Array<{ command: string; frequency: number }>>
          fetchDebounced(prefix?: string): void
          deleteSuggestion(command: string): Promise<void>
        }
      }
    }
  }
).__DINOTTY_HOST__?.useHistory
if (!host) {
  throw new Error('host bridge missing: window.__DINOTTY_HOST__.useHistory not assigned')
}

export const useHistory = host.useHistory

export interface SuggestionItem {
  command: string
  frequency: number
}

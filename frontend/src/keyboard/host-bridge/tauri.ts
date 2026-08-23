// Host singleton bridge: transport mode detection (`isTauri`).
const host = (
  window as unknown as {
    __DINOTTY_HOST__?: {
      useTransport: { isTauri: () => boolean }
    }
  }
).__DINOTTY_HOST__?.useTransport
if (!host) {
  throw new Error('host bridge missing: window.__DINOTTY_HOST__.useTransport not assigned')
}

export const isTauri = host.isTauri

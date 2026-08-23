// Host singleton bridge: host UI components that plugins render inside the
// host page. Components are plain component-options objects, so passing them
// across the bridge keeps them on the host's Vue runtime.
const host = (
  window as unknown as {
    __DINOTTY_HOST__?: {
      components: {
        FilePickerModal: unknown
      }
    }
  }
).__DINOTTY_HOST__?.components
if (!host) {
  throw new Error('host bridge missing: window.__DINOTTY_HOST__.components not assigned')
}

export const FilePickerModal = host.FilePickerModal
export default FilePickerModal

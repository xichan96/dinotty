import * as useSettings from '../composables/useSettings'
import * as useHistory from '../composables/useHistory'
import * as useI18n from '../composables/useI18n'
import * as useFileNavigation from '../composables/useFileNavigation'
import * as useUpload from '../composables/useUpload'
import * as useTransport from '../composables/useTransport'
import * as useKeyboardLayout from '../composables/useKeyboardLayout'
import { useToast, POSITION } from 'vue-toastification'
import FilePickerModal from '../components/preview/FilePickerModal.vue'

/**
 * Host-side singleton bridge for externally-built plugin bundles
 * (keyboard-plugin-design.md Phase 1b). Plugin builds redirect their
 * host-module imports to _shared/host-bridge shims (dinotty-plugins repo),
 * which read the modules exposed here - so plugin code observes the exact
 * same reactive singletons (settings, history suggestions, locale,
 * selectedPath) and host infrastructure (upload channel, transport mode,
 * toast instance, keyboard layout chain, file picker) instead of a bundled
 * second copy.
 *
 * Must run at startup, before any bridged plugin loads - same contract as
 * the `window.__DINOTTY_VUE__` runtime bridge in main.ts.
 */
export function installHostBridge(): void {
  ;(window as unknown as Record<string, unknown>).__DINOTTY_HOST__ = {
    useSettings,
    useHistory,
    useI18n,
    useFileNavigation,
    useUpload,
    useTransport,
    useKeyboardLayout,
    toast: { useToast, POSITION },
    components: { FilePickerModal },
  }
}

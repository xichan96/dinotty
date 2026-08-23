import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'

// Builtin-keyboard plugin bundle: compile the single-sourced MobileKeyboard
// SFC tree into one ESM file at seed/builtin-keyboard/main.js. Host modules
// imported with @/ specifiers are redirected here to the host-bridge shims so
// the artifact carries no duplicate singletons and runs on the host's Vue
// runtime (window.__DINOTTY_VUE__ / __DINOTTY_HOST__).
const hostBridge = fileURLToPath(new URL('../host-bridge', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^vue$/, replacement: resolve(hostBridge, 'vue.ts') },
      {
        find: /^vue-toastification$/,
        replacement: resolve(hostBridge, 'toast.ts'),
      },
      {
        find: /^@\/composables\/useSettings$/,
        replacement: resolve(hostBridge, 'settings.ts'),
      },
      {
        find: /^@\/composables\/useHistory$/,
        replacement: resolve(hostBridge, 'history.ts'),
      },
      {
        find: /^@\/composables\/useI18n$/,
        replacement: resolve(hostBridge, 'i18n.ts'),
      },
      {
        find: /^@\/composables\/useFileNavigation$/,
        replacement: resolve(hostBridge, 'fileNavigation.ts'),
      },
      {
        find: /^@\/composables\/useUpload$/,
        replacement: resolve(hostBridge, 'upload.ts'),
      },
      {
        find: /^@\/composables\/useTransport$/,
        replacement: resolve(hostBridge, 'tauri.ts'),
      },
      {
        find: /^@\/composables\/useKeyboardLayout$/,
        replacement: resolve(hostBridge, 'keyboardLayout.ts'),
      },
      {
        find: /^@\/components\/preview\/FilePickerModal\.vue$/,
        replacement: resolve(hostBridge, 'components.ts'),
      },
      // Fallback for @/ specifiers pointing to source files that are bundled
      // as-is (pure helpers, local SFC leaves, icons). Must come after the
      // host-composable aliases so those take precedence.
      {
        find: '@/',
        replacement: fileURLToPath(new URL('../../../src/', import.meta.url)),
      },
    ],
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL('./entry.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'main.js',
    },
    outDir: fileURLToPath(new URL('../../../../seed/builtin-keyboard', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      output: {
        // Scoped SFC styles land in scoped.css; build-seed.mjs concatenates
        // them with the global mobile-keyboard.css into styles.css (the file
        // plugin.json ships). The data-v hashes are this build's own, so the
        // host's compiled copy cannot substitute for them.
        assetFileNames: 'scoped.css',
      },
    },
  },
})

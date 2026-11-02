import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'
import { fileURLToPath, URL } from 'node:url'

const monacoPlugin = (monacoEditorPlugin as any).default || monacoEditorPlugin

export default defineConfig({
  plugins: [
    vue(),
    monacoPlugin({
      languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/ws': {
        target: 'http://127.0.0.1:8999',
        ws: true,
      },
      '/api': {
        target: 'http://127.0.0.1:8999',
      },
      // Relay to a remote server. Carries WebSocket traffic too, so it needs
      // `ws: true` like `/ws` — without this entry relay is unreachable in dev.
      '/__srv': {
        target: 'http://127.0.0.1:8999',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      // Two HTML entries: the main window and the detached terminal window.
      // The dev server serves both from the project root (/detached.html).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        detached: fileURLToPath(new URL('./detached.html', import.meta.url)),
      },
      output: {
        manualChunks: {
          xterm: [
            '@xterm/xterm',
            '@xterm/addon-fit',
            '@xterm/addon-unicode11',
            '@xterm/addon-webgl',
          ],
          chart: ['chart.js', 'vue-chartjs'],
          marked: ['marked', 'dompurify'],
        },
      },
    },
  },
})

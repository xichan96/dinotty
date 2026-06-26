import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Toast, { POSITION, type PluginOptions } from 'vue-toastification'
import 'vue-toastification/dist/index.css'
import App from './App.vue'
import '@xterm/xterm/css/xterm.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/mission-control.css'
import './styles/mobile-keyboard.css'

const toastOptions: PluginOptions = {
  position: POSITION.TOP_RIGHT,
  timeout: 5000,
  closeOnClick: false,
  pauseOnFocusLoss: true,
  pauseOnHover: true,
  draggable: true,
  showCloseButtonOnHover: true,
  closeButton: 'button',
  icon: true,
}

const app = createApp(App)
app.use(createPinia())
app.use(Toast, toastOptions)
app.mount('#app')

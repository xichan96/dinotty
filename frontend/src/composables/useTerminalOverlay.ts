import { t } from './useI18n'

export interface OverlayHost {
  getWrapper(): HTMLElement | null
  isSsh(): boolean
  getSshHost(): string | null
  getOnReconnect(): (() => void) | null
}

export interface TerminalOverlay {
  showReconnect(): void
  hide(): void
  showExit(): void
  showError(message: string): void
  cleanup(): void
}

export function createTerminalOverlay(host: OverlayHost): TerminalOverlay {
  let overlay: HTMLElement | null = null

  function showReconnect() {
    const wrapper = host.getWrapper()
    if (!wrapper || overlay) return
    overlay = document.createElement('div')
    overlay.className = 'reconnect-overlay'

    const text = document.createElement('span')
    text.textContent = 'Connection lost. Reconnecting...'

    const btn = document.createElement('button')
    btn.className = 'reconnect-retry-btn'
    btn.textContent = 'Retry Now'
    btn.addEventListener('click', () => {
      window.location.reload()
    })

    overlay.appendChild(text)
    overlay.appendChild(btn)
    wrapper.style.position = 'relative'
    wrapper.appendChild(overlay)
  }

  function hide() {
    if (overlay) {
      overlay.remove()
      overlay = null
    }
  }

  function showExit() {
    const wrapper = host.getWrapper()
    if (!wrapper || overlay) return
    overlay = document.createElement('div')
    overlay.className = 'reconnect-overlay'

    const isSsh = host.isSsh()
    const sshHost = host.getSshHost()

    const text = document.createElement('span')
    text.textContent = isSsh ? 'Connection Lost' : 'Process exited'

    if (isSsh && sshHost) {
      const hostInfo = document.createElement('span')
      hostInfo.className = 'reconnect-host-info'
      hostInfo.textContent = sshHost
      overlay.appendChild(text)
      overlay.appendChild(hostInfo)
    } else {
      overlay.appendChild(text)
    }

    const btn = document.createElement('button')
    btn.className = 'reconnect-retry-btn'
    btn.textContent = isSsh ? 'Reconnect' : 'New Tab'
    btn.addEventListener('click', () => {
      const onReconnect = host.getOnReconnect()
      if (isSsh && onReconnect) {
        onReconnect()
      } else {
        window.location.reload()
      }
    })

    overlay.appendChild(btn)
    wrapper.style.position = 'relative'
    wrapper.appendChild(overlay)
  }

  function showError(message: string) {
    const wrapper = host.getWrapper()
    if (!wrapper) return
    hide()
    overlay = document.createElement('div')
    overlay.className = 'reconnect-overlay'

    const text = document.createElement('span')
    text.textContent = message
    overlay.appendChild(text)

    const button = document.createElement('button')
    button.className = 'reconnect-retry-btn'
    button.textContent = t('settings.title')
    button.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dinotty:open-settings'))
    })
    overlay.appendChild(button)
    wrapper.style.position = 'relative'
    wrapper.appendChild(overlay)
  }

  function cleanup() {
    hide()
  }

  return { showReconnect, hide, showExit, showError, cleanup }
}

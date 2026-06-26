import type { Tab } from '../types/pane'
import { getAllLeaves, findLeaf } from '../types/pane'
import type TerminalPane from '../components/terminal/TerminalPane.vue'
import type { TerminalInstance } from './useTerminal'

const MAX_PREVIEW_ROWS = 28

export interface TabCard {
  paneId: string
  index: number
  title: string
  type: 'terminal' | 'plugin'
  previewImage: string | null
  textContent: string
  htmlContent: string
  pluginIcon?: string
  splitCount: number
  hasNotification: boolean
}

// P2: canvas screenshot disabled by default
const ENABLE_CANVAS_PREVIEW = false

/** Convert xterm color value to CSS color string */
function colorToCss(
  colorValue: number,
  isRGB: boolean,
  isDefault: boolean,
  isPalette: boolean,
  defaultCss: string,
  themeColors?: string[],
): string {
  if (isDefault) return defaultCss
  if (isRGB) {
    const r = (colorValue >> 16) & 0xff
    const g = (colorValue >> 8) & 0xff
    const b = colorValue & 0xff
    return `rgb(${r},${g},${b})`
  }
  if (isPalette && themeColors && colorValue < themeColors.length) {
    return themeColors[colorValue]
  }
  return defaultCss
}

/** Capture terminal buffer as color-aware HTML */
function captureColoredHtml(terminal: TerminalInstance): string {
  const xterm = terminal.xterm
  if (!xterm) return ''

  const buffer = xterm.buffer.active
  const totalRows = buffer.length
  const startRow = Math.max(0, totalRows - MAX_PREVIEW_ROWS)

  // Get theme colors from xterm options
  const theme = (xterm.options as any).theme ?? {}
  const themeColors: string[] = [
    theme.black ?? '#000000',
    theme.red ?? '#e06c75',
    theme.green ?? '#98c379',
    theme.yellow ?? '#e5c07b',
    theme.blue ?? '#61afef',
    theme.magenta ?? '#c678dd',
    theme.cyan ?? '#56b6c2',
    theme.white ?? '#abb2bf',
    theme.brightBlack ?? '#5c6370',
    theme.brightRed ?? '#e06c75',
    theme.brightGreen ?? '#98c379',
    theme.brightYellow ?? '#e5c07b',
    theme.brightBlue ?? '#61afef',
    theme.brightMagenta ?? '#c678dd',
    theme.brightCyan ?? '#56b6c2',
    theme.brightWhite ?? '#ffffff',
  ]
  const defaultFg = theme.foreground ?? '#abb2bf'

  const parts: string[] = []
  let lastFg = ''

  for (let row = startRow; row < totalRows; row++) {
    const line = buffer.getLine(row)
    if (!line) continue

    const cols = line.length
    let hasContent = false

    for (let col = 0; col < cols; col++) {
      const cell = line.getCell(col)
      if (!cell) continue

      const char = cell.getChars() || ' '
      if (char !== ' ') hasContent = true

      const fgValue = cell.getFgColor()
      const fg = colorToCss(
        fgValue,
        cell.isFgRGB(),
        cell.isFgDefault(),
        cell.isFgPalette(),
        defaultFg,
        themeColors,
      )

      if (fg !== lastFg) {
        if (lastFg) parts.push('</span>')
        parts.push(`<span style="color:${fg}">`)
        lastFg = fg
      }

      // Escape HTML special chars
      if (char === '&') parts.push('&amp;')
      else if (char === '<') parts.push('&lt;')
      else if (char === '>') parts.push('&gt;')
      else parts.push(char)
    }

    if (lastFg) {
      parts.push('</span>')
      lastFg = ''
    }
    if (hasContent || row < totalRows - 1) {
      parts.push('\n')
    }
  }

  return parts.join('').trimEnd()
}

function captureCanvasPreview(terminal: TerminalInstance): string | null {
  const canvas = terminal.xterm?.element?.querySelector('canvas')
  if (!canvas) return null
  try {
    const tmpCanvas = document.createElement('canvas')
    tmpCanvas.width = 400
    tmpCanvas.height = 250
    const ctx = tmpCanvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(canvas, 0, 0, 400, 250)
    return tmpCanvas.toDataURL('image/jpeg', 0.6)
  } catch {
    return null
  }
}

function capturePreview(terminal: TerminalInstance | null): {
  image: string | null
  html: string
} {
  if (!terminal) return { image: null, html: '' }
  const html = captureColoredHtml(terminal)
  const image = ENABLE_CANVAS_PREVIEW ? captureCanvasPreview(terminal) : null
  return { image, html }
}

export function useTabPreview() {
  function captureAll(
    tabs: Tab[],
    termRefs: Record<string, InstanceType<typeof TerminalPane>>,
    indicators?: Record<string, any>,
  ): TabCard[] {
    return tabs.map((tab, index) => {
      if (tab.type === 'plugin') {
        return {
          paneId: tab.paneId,
          index: index + 1,
          title: tab.title,
          type: 'plugin',
          previewImage: null,
          textContent: '',
          htmlContent: '',
          splitCount: 0,
          hasNotification: !!(indicators?.[tab.paneId]),
        }
      }

      // Terminal tab
      const leaves = getAllLeaves(tab.layout)
      const activeLeaf = findLeaf(tab.layout, tab.activePaneId) ?? leaves[0]
      const termRef = termRefs[activeLeaf.paneId]
      const { image, html } = termRef
        ? capturePreview(termRef.getTerminal())
        : { image: null, html: '' }

      return {
        paneId: tab.paneId,
        index: index + 1,
        title: tab.customTitle || activeLeaf.title,
        type: 'terminal',
        previewImage: image,
        textContent: '',
        htmlContent: html,
        splitCount: leaves.length,
        hasNotification: !!(indicators?.[tab.paneId]),
      }
    })
  }

  return { captureAll, capturePreview }
}

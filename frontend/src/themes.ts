export interface ThemeDefinition {
  name: string
  label: string
  colors: Record<string, string>
}

interface RGB {
  r: number
  g: number
  b: number
}

export function parseHex(hex: string): RGB {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
  if (!match) return { r: 0, g: 0, b: 0 }

  const value = match[1]
  const expanded = value.length === 3 ? value.replace(/./g, (digit) => digit + digit) : value
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  }
}

export function toHex({ r, g, b }: RGB): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  return 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255)
}

export function shade(hex: string, amount: number): string {
  const color = parseHex(hex)
  const strength = Math.min(1, Math.max(0, Math.abs(amount)))
  const target = amount >= 0 ? 255 : 0
  return toHex({
    r: color.r + (target - color.r) * strength,
    g: color.g + (target - color.g) * strength,
    b: color.b + (target - color.b) * strength,
  })
}

export function mix(a: string, b: string, t: number): string {
  const first = parseHex(a)
  const second = parseHex(b)
  const amount = Math.min(1, Math.max(0, t))
  return toHex({
    r: first.r + (second.r - first.r) * amount,
    g: first.g + (second.g - first.g) * amount,
    b: first.b + (second.b - first.b) * amount,
  })
}

export const themes: ThemeDefinition[] = [
  {
    name: 'dark',
    label: 'Dark',
    colors: {
      '--bg': '#1E1E1E',
      '--bg-surface': '#252526',
      '--bg-overlay': '#1E1E1E',
      '--bg-input': '#2A2A2C',
      '--bg-hover': '#2A2A2C',
      '--bg-surface-hover': '#333333',
      '--border': '#3C3C3C',
      '--border-focus': '#8A8A8A',
      '--border-hover': '#555555',
      '--divider': '#2D2D2D',
      '--fg': '#CCCCCC',
      '--fg-bright': '#D0D0D0',
      '--fg-muted': '#858585',
      '--scrollbar-thumb': '#4A4A4A',
      '--scrollbar-thumb-hover': '#5A5A5A',
      '--accent': '#8A8A8A',
      '--accent-hover': '#9E9E9E',
      '--tab-bg': '#181818',
      '--tab-active-bg': '#1E1E1E',
      '--tab-hover-bg': '#2A2A2C',
      '--tab-text': '#858585',
      '--tab-active-text': '#D0D0D0',
      '--palette-bg': 'rgba(30, 30, 30, 0.97)',
      '--palette-border': '#3C3C3C',
      '--palette-select': '#2A2D2E',
      '--palette-text': '#CCCCCC',
      '--color-black': '#000000',
      '--color-red': '#F44747',
      '--color-green': '#6A9955',
      '--color-yellow': '#D7BA7D',
      '--color-blue': '#569CD6',
      '--color-magenta': '#C586C0',
      '--color-cyan': '#4EC9B0',
      '--color-white': '#D4D4D4',
      '--color-bright-black': '#808080',
      '--color-bright-red': '#F14C4C',
      '--color-bright-green': '#73C991',
      '--color-bright-yellow': '#CCA700',
      '--color-bright-blue': '#6796E6',
      '--color-bright-magenta': '#D670D6',
      '--color-bright-cyan': '#23D18B',
      '--color-bright-white': '#FFFFFF',
    },
  },
  {
    name: 'light',
    label: 'Light',
    colors: {
      '--bg': '#FFFFFF',
      '--bg-surface': '#F5F5F5',
      '--bg-overlay': '#FFFFFF',
      '--bg-input': '#FFFFFF',
      '--bg-hover': '#ECECEC',
      '--bg-surface-hover': '#EBEBEB',
      '--border': '#E0E0E0',
      '--border-focus': '#2563EB',
      '--border-hover': '#CCCCCC',
      '--divider': '#EEEEEE',
      '--fg': '#333333',
      '--fg-bright': '#111111',
      '--fg-muted': '#999999',
      '--scrollbar-thumb': '#C0C0C0',
      '--scrollbar-thumb-hover': '#A0A0A0',
      '--accent': '#2563EB',
      '--accent-hover': '#3B82F6',
      '--tab-bg': '#F5F5F5',
      '--tab-active-bg': '#FFFFFF',
      '--tab-hover-bg': '#EEEEEE',
      '--tab-text': '#666666',
      '--tab-active-text': '#111111',
      '--palette-bg': 'rgba(255, 255, 255, 0.97)',
      '--palette-border': '#E0E0E0',
      '--palette-select': '#E8E8E8',
      '--palette-text': '#333333',
      '--color-black': '#000000',
      '--color-red': '#C91B00',
      '--color-green': '#00A600',
      '--color-yellow': '#999900',
      '--color-blue': '#0000B2',
      '--color-magenta': '#B200B2',
      '--color-cyan': '#00A6B2',
      '--color-white': '#BFBFBF',
      '--color-bright-black': '#666666',
      '--color-bright-red': '#E50000',
      '--color-bright-green': '#00D900',
      '--color-bright-yellow': '#E5E500',
      '--color-bright-blue': '#0000FF',
      '--color-bright-magenta': '#E500E5',
      '--color-bright-cyan': '#00E5E5',
      '--color-bright-white': '#E5E5E5',
    },
  },
  {
    name: 'dracula',
    label: 'Dracula',
    colors: {
      '--bg': '#282A36',
      '--bg-surface': '#282A36',
      '--bg-overlay': '#282A36',
      '--bg-input': '#44475A',
      '--border': '#44475A',
      '--border-focus': '#BD93F9',
      '--divider': '#44475A',
      '--fg': '#F8F8F2',
      '--fg-bright': '#FFFFFF',
      '--fg-muted': '#6272A4',
      '--accent': '#BD93F9',
      '--accent-hover': '#CFA9FF',
      '--tab-bg': '#21222C',
      '--tab-active-bg': '#282A36',
      '--tab-hover-bg': '#2D2F3B',
      '--tab-text': '#6272A4',
      '--tab-active-text': '#F8F8F2',
      '--color-black': '#21222C',
      '--color-red': '#FF5555',
      '--color-green': '#50FA7B',
      '--color-yellow': '#F1FA8C',
      '--color-blue': '#BD93F9',
      '--color-magenta': '#FF79C6',
      '--color-cyan': '#8BE9FD',
      '--color-white': '#F8F8F2',
      '--color-bright-black': '#6272A4',
      '--color-bright-red': '#FF6E6E',
      '--color-bright-green': '#69FF94',
      '--color-bright-yellow': '#FFFFA5',
      '--color-bright-blue': '#D6ACFF',
      '--color-bright-magenta': '#FF92DF',
      '--color-bright-cyan': '#A4FFFF',
      '--color-bright-white': '#FFFFFF',
    },
  },
  {
    name: 'nord',
    label: 'Nord',
    colors: {
      '--bg': '#2E3440',
      '--bg-surface': '#2E3440',
      '--bg-overlay': '#2E3440',
      '--bg-input': '#3B4252',
      '--border': '#3B4252',
      '--border-focus': '#88C0D0',
      '--divider': '#3B4252',
      '--fg': '#D8DEE9',
      '--fg-bright': '#ECEFF4',
      '--fg-muted': '#4C566A',
      '--accent': '#88C0D0',
      '--accent-hover': '#8FBCBB',
      '--tab-bg': '#2E3440',
      '--tab-active-bg': '#3B4252',
      '--tab-hover-bg': '#434C5E',
      '--tab-text': '#4C566A',
      '--tab-active-text': '#ECEFF4',
      '--color-black': '#3B4252',
      '--color-red': '#BF616A',
      '--color-green': '#A3BE8C',
      '--color-yellow': '#EBCB8B',
      '--color-blue': '#81A1C1',
      '--color-magenta': '#B48EAD',
      '--color-cyan': '#88C0D0',
      '--color-white': '#E5E9F0',
      '--color-bright-black': '#4C566A',
      '--color-bright-red': '#BF616A',
      '--color-bright-green': '#A3BE8C',
      '--color-bright-yellow': '#EBCB8B',
      '--color-bright-blue': '#81A1C1',
      '--color-bright-magenta': '#B48EAD',
      '--color-bright-cyan': '#8FBCBB',
      '--color-bright-white': '#ECEFF4',
    },
  },
  {
    name: 'monokai',
    label: 'Monokai',
    colors: {
      '--bg': '#272822',
      '--bg-surface': '#272822',
      '--bg-overlay': '#272822',
      '--bg-input': '#3E3D32',
      '--border': '#3E3D32',
      '--border-focus': '#F92672',
      '--divider': '#3E3D32',
      '--fg': '#F8F8F2',
      '--fg-bright': '#FFFFFF',
      '--fg-muted': '#75715E',
      '--accent': '#F92672',
      '--accent-hover': '#FF4D8D',
      '--tab-bg': '#1E1F1C',
      '--tab-active-bg': '#272822',
      '--tab-hover-bg': '#2D2E28',
      '--tab-text': '#75715E',
      '--tab-active-text': '#F8F8F2',
      '--color-black': '#272822',
      '--color-red': '#F92672',
      '--color-green': '#A6E22E',
      '--color-yellow': '#F4BF75',
      '--color-blue': '#66D9EF',
      '--color-magenta': '#AE81FF',
      '--color-cyan': '#A1EFE4',
      '--color-white': '#F8F8F2',
      '--color-bright-black': '#75715E',
      '--color-bright-red': '#F92672',
      '--color-bright-green': '#A6E22E',
      '--color-bright-yellow': '#F4BF75',
      '--color-bright-blue': '#66D9EF',
      '--color-bright-magenta': '#AE81FF',
      '--color-bright-cyan': '#A1EFE4',
      '--color-bright-white': '#F9F8F5',
    },
  },
  {
    name: 'solarized',
    label: 'Solarized',
    colors: {
      '--bg': '#002B36',
      '--bg-surface': '#002B36',
      '--bg-overlay': '#002B36',
      '--bg-input': '#073642',
      '--border': '#073642',
      '--border-focus': '#268BD2',
      '--divider': '#073642',
      '--fg': '#839496',
      '--fg-bright': '#FDF6E3',
      '--fg-muted': '#586E75',
      '--accent': '#268BD2',
      '--accent-hover': '#2AA1E3',
      '--tab-bg': '#002B36',
      '--tab-active-bg': '#073642',
      '--tab-hover-bg': '#073642',
      '--tab-text': '#586E75',
      '--tab-active-text': '#93A1A1',
      '--color-black': '#073642',
      '--color-red': '#DC322F',
      '--color-green': '#859900',
      '--color-yellow': '#B58900',
      '--color-blue': '#268BD2',
      '--color-magenta': '#D33682',
      '--color-cyan': '#2AA198',
      '--color-white': '#EEE8D5',
      '--color-bright-black': '#586E75',
      '--color-bright-red': '#CB4B16',
      '--color-bright-green': '#859900',
      '--color-bright-yellow': '#B58900',
      '--color-bright-blue': '#268BD2',
      '--color-bright-magenta': '#6C71C4',
      '--color-bright-cyan': '#2AA198',
      '--color-bright-white': '#FDF6E3',
    },
  },
  {
    name: 'catppuccin',
    label: 'Catppuccin',
    colors: {
      '--bg': '#1E1E2E',
      '--bg-surface': '#1E1E2E',
      '--bg-overlay': '#1E1E2E',
      '--bg-input': '#313244',
      '--border': '#45475A',
      '--border-focus': '#CBA6F7',
      '--divider': '#313244',
      '--fg': '#CDD6F4',
      '--fg-bright': '#F5E0DC',
      '--fg-muted': '#6C7086',
      '--accent': '#CBA6F7',
      '--accent-hover': '#DDB6F9',
      '--tab-bg': '#181825',
      '--tab-active-bg': '#1E1E2E',
      '--tab-hover-bg': '#262637',
      '--tab-text': '#6C7086',
      '--tab-active-text': '#CDD6F4',
      '--color-black': '#45475A',
      '--color-red': '#F38BA8',
      '--color-green': '#A6E3A1',
      '--color-yellow': '#F9E2AF',
      '--color-blue': '#89B4FA',
      '--color-magenta': '#F5C2E7',
      '--color-cyan': '#94E2D5',
      '--color-white': '#BAC2DE',
      '--color-bright-black': '#585B70',
      '--color-bright-red': '#F38BA8',
      '--color-bright-green': '#A6E3A1',
      '--color-bright-yellow': '#F9E2AF',
      '--color-bright-blue': '#89B4FA',
      '--color-bright-magenta': '#F5C2E7',
      '--color-bright-cyan': '#94E2D5',
      '--color-bright-white': '#A6ADC8',
    },
  },
  {
    name: 'gruvbox',
    label: 'Gruvbox',
    colors: {
      '--bg': '#282828',
      '--bg-surface': '#282828',
      '--bg-overlay': '#282828',
      '--bg-input': '#3C3836',
      '--border': '#504945',
      '--border-focus': '#FE8019',
      '--divider': '#3C3836',
      '--fg': '#EBDBB2',
      '--fg-bright': '#FBF1C7',
      '--fg-muted': '#928374',
      '--accent': '#FE8019',
      '--accent-hover': '#FE9419',
      '--tab-bg': '#1D2021',
      '--tab-active-bg': '#282828',
      '--tab-hover-bg': '#32302F',
      '--tab-text': '#928374',
      '--tab-active-text': '#EBDBB2',
      '--color-black': '#282828',
      '--color-red': '#CC241D',
      '--color-green': '#98971A',
      '--color-yellow': '#D79921',
      '--color-blue': '#458588',
      '--color-magenta': '#B16286',
      '--color-cyan': '#689D6A',
      '--color-white': '#A89984',
      '--color-bright-black': '#928374',
      '--color-bright-red': '#FB4934',
      '--color-bright-green': '#B8BB26',
      '--color-bright-yellow': '#FABD2F',
      '--color-bright-blue': '#83A598',
      '--color-bright-magenta': '#D3869B',
      '--color-bright-cyan': '#8EC07C',
      '--color-bright-white': '#EBDBB2',
    },
  },
  {
    name: 'tokyonight',
    label: 'Tokyo Night',
    colors: {
      '--bg': '#1A1B26',
      '--bg-surface': '#1A1B26',
      '--bg-overlay': '#1A1B26',
      '--bg-input': '#24283B',
      '--border': '#3B4261',
      '--border-focus': '#7AA2F7',
      '--divider': '#292E42',
      '--fg': '#C0CAF5',
      '--fg-bright': '#F0F0FF',
      '--fg-muted': '#565F89',
      '--accent': '#7AA2F7',
      '--accent-hover': '#89B4FA',
      '--tab-bg': '#16161E',
      '--tab-active-bg': '#1A1B26',
      '--tab-hover-bg': '#1F2335',
      '--tab-text': '#565F89',
      '--tab-active-text': '#C0CAF5',
      '--color-black': '#15161E',
      '--color-red': '#F7768E',
      '--color-green': '#9ECE6A',
      '--color-yellow': '#E0AF68',
      '--color-blue': '#7AA2F7',
      '--color-magenta': '#BB9AF7',
      '--color-cyan': '#7DCFFF',
      '--color-white': '#A9B1D6',
      '--color-bright-black': '#414868',
      '--color-bright-red': '#F7768E',
      '--color-bright-green': '#9ECE6A',
      '--color-bright-yellow': '#E0AF68',
      '--color-bright-blue': '#7AA2F7',
      '--color-bright-magenta': '#BB9AF7',
      '--color-bright-cyan': '#7DCFFF',
      '--color-bright-white': '#C0CAF5',
    },
  },
  {
    name: 'onedark',
    label: 'One Dark',
    colors: {
      '--bg': '#282C34',
      '--bg-surface': '#282C34',
      '--bg-overlay': '#282C34',
      '--bg-input': '#353B45',
      '--border': '#3E4452',
      '--border-focus': '#61AFEF',
      '--divider': '#353B45',
      '--fg': '#ABB2BF',
      '--fg-bright': '#E6E6E6',
      '--fg-muted': '#545862',
      '--accent': '#61AFEF',
      '--accent-hover': '#74BBF5',
      '--tab-bg': '#21252B',
      '--tab-active-bg': '#282C34',
      '--tab-hover-bg': '#2C313A',
      '--tab-text': '#545862',
      '--tab-active-text': '#ABB2BF',
      '--color-black': '#282C34',
      '--color-red': '#E06C75',
      '--color-green': '#98C379',
      '--color-yellow': '#E5C07B',
      '--color-blue': '#61AFEF',
      '--color-magenta': '#C678DD',
      '--color-cyan': '#56B6C2',
      '--color-white': '#ABB2BF',
      '--color-bright-black': '#545862',
      '--color-bright-red': '#E06C75',
      '--color-bright-green': '#98C379',
      '--color-bright-yellow': '#E5C07B',
      '--color-bright-blue': '#61AFEF',
      '--color-bright-magenta': '#C678DD',
      '--color-bright-cyan': '#56B6C2',
      '--color-bright-white': '#C8CCD4',
    },
  },
  {
    name: 'palenight',
    label: 'Palenight',
    colors: {
      '--bg': '#292D3E',
      '--bg-surface': '#292D3E',
      '--bg-overlay': '#292D3E',
      '--bg-input': '#343A4F',
      '--border': '#434758',
      '--border-focus': '#C792EA',
      '--divider': '#343A4F',
      '--fg': '#A6ACCD',
      '--fg-bright': '#E6E6E6',
      '--fg-muted': '#676E95',
      '--accent': '#C792EA',
      '--accent-hover': '#D1A3F0',
      '--tab-bg': '#21252B',
      '--tab-active-bg': '#292D3E',
      '--tab-hover-bg': '#2E3347',
      '--tab-text': '#676E95',
      '--tab-active-text': '#A6ACCD',
      '--color-black': '#292D3E',
      '--color-red': '#F07178',
      '--color-green': '#C3E88D',
      '--color-yellow': '#FFCB6B',
      '--color-blue': '#82AAFF',
      '--color-magenta': '#C792EA',
      '--color-cyan': '#89DDFF',
      '--color-white': '#A6ACCD',
      '--color-bright-black': '#676E95',
      '--color-bright-red': '#F07178',
      '--color-bright-green': '#C3E88D',
      '--color-bright-yellow': '#FFCB6B',
      '--color-bright-blue': '#82AAFF',
      '--color-bright-magenta': '#C792EA',
      '--color-bright-cyan': '#89DDFF',
      '--color-bright-white': '#D1D5DE',
    },
  },
  {
    name: 'ayudark',
    label: 'Ayu Dark',
    colors: {
      '--bg': '#0B0E14',
      '--bg-surface': '#0B0E14',
      '--bg-overlay': '#0B0E14',
      '--bg-input': '#131720',
      '--border': '#1E2330',
      '--border-focus': '#39BAE6',
      '--divider': '#171B24',
      '--fg': '#BFBDB6',
      '--fg-bright': '#E6E1CF',
      '--fg-muted': '#4D5566',
      '--accent': '#39BAE6',
      '--accent-hover': '#5FC5F0',
      '--tab-bg': '#0D1017',
      '--tab-active-bg': '#0B0E14',
      '--tab-hover-bg': '#11151C',
      '--tab-text': '#4D5566',
      '--tab-active-text': '#BFBDB6',
      '--color-black': '#0B0E14',
      '--color-red': '#FF3333',
      '--color-green': '#C2D94C',
      '--color-yellow': '#E6B450',
      '--color-blue': '#39BAE6',
      '--color-magenta': '#F07178',
      '--color-cyan': '#95E6CB',
      '--color-white': '#BFBDB6',
      '--color-bright-black': '#4D5566',
      '--color-bright-red': '#FF6B6B',
      '--color-bright-green': '#D4E657',
      '--color-bright-yellow': '#FFD173',
      '--color-bright-blue': '#59C2FF',
      '--color-bright-magenta': '#F28779',
      '--color-bright-cyan': '#95E6CB',
      '--color-bright-white': '#CBCCC6',
    },
  },
]

// Fill in derived variables that every theme needs but may not list explicitly.
// This avoids repeating scrollbar / hover / palette tokens in every theme.
// Explicit values in the theme always win (spread order).
export function fillDefaults(t: ThemeDefinition): ThemeDefinition {
  const c = t.colors
  const bg = c['--bg']
  const fg = c['--fg']
  const dark = luminance(bg) < 0.5
  const lift = (hex: string, amount: number) => shade(hex, dark ? amount : -amount)
  const blue = c['--color-blue'] || fg
  const derived: Record<string, string> = {
    '--bg-surface': lift(bg, 0.06),
    '--bg-overlay': bg,
    '--bg-input': lift(bg, 0.09),
    '--bg-hover': lift(bg, 0.09),
    '--bg-surface-hover': lift(bg, 0.13),
    '--border': lift(bg, 0.18),
    '--border-focus': blue,
    '--border-hover': lift(bg, 0.26),
    '--divider': lift(bg, 0.12),
    '--fg-bright': fg,
    '--fg-muted': mix(fg, bg, 0.4),
    '--scrollbar-thumb': lift(bg, 0.18),
    '--scrollbar-thumb-hover': lift(bg, 0.28),
    '--accent': blue,
    '--accent-hover': shade(blue, dark ? 0.12 : -0.12),
    '--tab-bg': shade(bg, dark ? -0.06 : -0.04),
    '--tab-active-bg': bg,
    '--tab-hover-bg': lift(bg, 0.09),
    '--tab-text': mix(fg, bg, 0.4),
    '--tab-active-text': fg,
    '--palette-bg': bg,
    '--palette-border': lift(bg, 0.18),
    '--palette-select': lift(bg, 0.09),
    '--palette-text': fg,
    '--cursor': c['--fg-muted'] || fg,
  }
  return { ...t, colors: { ...derived, ...c } }
}

export function getThemeByName(name: string): ThemeDefinition {
  const raw = themes.find((t) => t.name === name) || themes[0]
  return fillDefaults(raw)
}

export function getThemeByNameStrict(name: string): ThemeDefinition | null {
  const raw = themes.find((t) => t.name === name)
  return raw ? fillDefaults(raw) : null
}

export function applyThemeToDOM(theme: ThemeDefinition) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value)
  }

  // Sync color-scheme so browser UI (scrollbars, form controls) matches theme
  const isLight = luminance(theme.colors['--bg'] || '#1e1e1e') >= 0.5
  root.style.setProperty('color-scheme', isLight ? 'light' : 'dark')

  // Sync theme-color meta tag for iOS status bar and browser chrome
  const bgColor = theme.colors['--bg'] || '#1E1E1E'
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', bgColor)
}

export function getXtermTheme(theme: ThemeDefinition) {
  const c = theme.colors
  return {
    background: c['--bg'],
    foreground: c['--fg'],
    cursor: c['--cursor'] || c['--fg-muted'],
    cursorAccent: c['--color-black'],
    selectionBackground: 'rgba(77,127,255,0.35)',
    black: c['--color-black'],
    red: c['--color-red'],
    green: c['--color-green'],
    yellow: c['--color-yellow'],
    blue: c['--color-blue'],
    magenta: c['--color-magenta'],
    cyan: c['--color-cyan'],
    white: c['--color-white'],
    brightBlack: c['--color-bright-black'],
    brightRed: c['--color-bright-red'],
    brightGreen: c['--color-bright-green'],
    brightYellow: c['--color-bright-yellow'],
    brightBlue: c['--color-bright-blue'],
    brightMagenta: c['--color-bright-magenta'],
    brightCyan: c['--color-bright-cyan'],
    brightWhite: c['--color-bright-white'],
  }
}

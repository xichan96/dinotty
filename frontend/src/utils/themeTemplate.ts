import type { ThemeColors } from '../composables/useDeviceThemeSelection'

const PALETTE_LABELS = [
  '黑   black',
  '红   red',
  '绿   green',
  '黄   yellow',
  '蓝   blue',
  '品红 magenta',
  '青   cyan',
  '白   white',
  '亮黑 bright black',
  '亮红 bright red',
  '亮绿 bright green',
  '亮黄 bright yellow',
  '亮蓝 bright blue',
  '亮品红 bright magenta',
  '亮青 bright cyan',
  '亮白 bright white',
] as const

export function serializeTheme(name: string, colors: ThemeColors): string {
  const palette = colors.ansi.flatMap((color, index) => [
    `# ${index}${index < 10 ? '  ' : ' '}${PALETTE_LABELS[index]}`,
    `palette = ${index}=${color}`,
  ])

  return [
    '# Dinotty 主题文件（兼容 ghostty 主题格式）',
    '#',
    '# 下面的 name = 行是这个主题在 Dinotty 里显示的名字，改它即可（与文件名无关）。',
    '# 颜色用 #RRGGBB 十六进制，开头的 # 可省略。',
    '# 改完后回到 外观 → 导入，选这个文件即可套用。',
    '',
    `# name = ${name}`,
    '',
    '# 前景文字色',
    `foreground = ${colors.foreground}`,
    '# 背景色',
    `background = ${colors.background}`,
    '# 光标色',
    `cursor-color = ${colors.cursor}`,
    '',
    '# 以下是 16 个 ANSI 终端色（palette 0..15）',
    ...palette,
    '',
  ].join('\n')
}

export function downloadTheme(name: string, colors: ThemeColors): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([serializeTheme(name, colors)], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const sanitizedName = name.trim().replace(/[\\/:*?"<>|\s]+/g, '-') || 'theme'
  anchor.href = url
  anchor.download = `${sanitizedName}.conf`
  document.body.appendChild(anchor)
  anchor.click()
  URL.revokeObjectURL(url)
  anchor.remove()
}

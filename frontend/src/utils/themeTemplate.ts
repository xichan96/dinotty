export const THEME_TEMPLATE_FILENAME = 'dinotty-theme-template.conf'

export function buildBlankTemplate(): string {
  const palette = Array.from({ length: 16 }, (_, index) => `palette = ${index}=`).join('\n')
  return `# Dinotty colors-only theme template
# Fill every color field below, then import this file into Dinotty.
# Values use #RRGGBB hexadecimal notation; the leading # is optional.
# Palette indexes 0..15 are the 16 ANSI colors, from 0=black through 15=bright-white.

foreground =
background =
cursor-color =
${palette}
`
}

export function downloadThemeTemplate(): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([buildBlankTemplate()], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = THEME_TEMPLATE_FILENAME
  document.body.appendChild(anchor)
  anchor.click()
  URL.revokeObjectURL(url)
  anchor.remove()
}

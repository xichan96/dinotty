import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// Assemble the seed artifact from the vite lib-build output:
//   mobile-keyboard.css (global host styles) + scoped.css (this build's SFC hashes) -> styles.css
//   plugin.json (source manifest) -> seed/builtin-keyboard/plugin.json
const here = fileURLToPath(new URL('.', import.meta.url))
const outDir = fileURLToPath(new URL('../../../../seed/builtin-keyboard', import.meta.url))

mkdirSync(outDir, { recursive: true })

// Vite's emptyOutDir is unreliable when outDir is outside project root; clean
// stale artifacts (old PWA files, previous scoped.css) while preserving this
// build's output.
for (const entry of readdirSync(outDir)) {
  if (entry === 'main.js' || entry === 'scoped.css') continue
  rmSync(`${outDir}/${entry}`, { recursive: true, force: true })
}

const globalCss = readFileSync(
  fileURLToPath(new URL('../../styles/mobile-keyboard.css', import.meta.url)),
  'utf8'
)
const scopedCss = readFileSync(`${outDir}/scoped.css`, 'utf8')
writeFileSync(
  `${outDir}/styles.css`,
  `${globalCss}\n/* scoped SFC styles (this build's data-v hashes) */\n${scopedCss}`
)

// scoped.css is an intermediate build product; the shipped styles file is styles.css.
rmSync(`${outDir}/scoped.css`, { force: true })

copyFileSync(`${here}/plugin.json`, `${outDir}/plugin.json`)

console.log(`seed/builtin-keyboard: ${outDir}`)

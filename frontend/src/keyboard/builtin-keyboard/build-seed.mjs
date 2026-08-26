import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'

// Assemble the seed artifact from the vite lib-build output:
//   scoped.css (this build's SFC hashes) -> styles.css
//   plugin.json (source manifest) -> seed/builtin-keyboard/plugin.json
function stripComments(css) {
  let output = ''
  let quote = null

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    const next = css[index + 1]

    if (quote) {
      output += char
      if (char === '\\') {
        output += next ?? ''
        index += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '\\') {
      output += char
      output += next ?? ''
      index += 1
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      output += char
    } else if (char === '/' && next === '*') {
      const end = css.indexOf('*/', index + 2)
      index = end === -1 ? css.length : end + 1
    } else {
      output += char
    }
  }

  return output
}

function stripStrings(css) {
  let output = ''
  let quote = null

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    const next = css[index + 1]

    if (quote) {
      if (char === '\\') {
        index += 1
      } else if (char === quote) {
        quote = null
        output += char
      }
      continue
    }

    if (char === '\\') {
      output += char
      output += next ?? ''
      index += 1
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      output += char
    } else {
      output += char
    }
  }

  return output
}

function stripUnquotedUrls(css) {
  let output = ''

  for (let index = 0; index < css.length; index += 1) {
    const isUrl =
      css.slice(index, index + 4).toLowerCase() === 'url(' &&
      (index === 0 || !/[\w-]/.test(css[index - 1]))

    if (!isUrl) {
      output += css[index]
      continue
    }

    const contentStart = index + 4
    let contentIndex = contentStart
    while (/\s/.test(css[contentIndex] ?? '')) contentIndex += 1

    if (css[contentIndex] === '"' || css[contentIndex] === "'") {
      output += css.slice(index, contentStart)
      index = contentStart - 1
      continue
    }

    let closingParen = contentIndex
    while (closingParen < css.length && css[closingParen] !== ')') {
      if (css[closingParen] === '\\') closingParen += 1
      closingParen += 1
    }

    output += css.slice(index, contentStart)
    if (closingParen < css.length) {
      output += ')'
      index = closingParen
    } else {
      index = css.length
    }
  }

  return output
}

// Tripwire for one specific regression: host global CSS reaching the seed broke the mobile toolbar
// because the seeded <style> is injected after the core stylesheet at equal specificity, allowing a
// host selector to override the app's own rule. This does not prove every selector is scoped; the
// universal selector is deliberately not checked because it is indistinguishable from calc()
// multiplication without a real CSS parser, which this package deliberately does not carry. The actual
// fix is that the seed no longer concatenates the host stylesheet, and this check is belt-and-braces.
// It deliberately under-detects rather than false-reject because a false reject here blocks every build.
export function assertNoHostGlobalSelectors(css) {
  const source = stripUnquotedUrls(stripStrings(stripComments(css)))
  const offenders = new Set()

  for (const token of ['#system-mobile-kb', '#mobile-kb', '#app-root', ':root']) {
    if (source.includes(token)) offenders.add(token)
  }
  for (const token of ['html', 'body']) {
    if (new RegExp(`(?<![\\w-])${token}(?![\\w-])`).test(source)) offenders.add(token)
  }
  if (offenders.size > 0) {
    throw new Error(
      `Builtin keyboard seed must contain only the plugin's own scoped SFC CSS; host-global selector tokens re-introduce host CSS into the seed payload: ${[...offenders].join(', ')}`
    )
  }
}

function buildSeed() {
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

  const scopedCss = readFileSync(`${outDir}/scoped.css`, 'utf8')
  const stylesPath = `${outDir}/styles.css`
  writeFileSync(stylesPath, scopedCss)
  assertNoHostGlobalSelectors(readFileSync(stylesPath, 'utf8'))

  // scoped.css is an intermediate build product; the shipped styles file is styles.css.
  rmSync(`${outDir}/scoped.css`, { force: true })

  copyFileSync(`${here}/plugin.json`, `${outDir}/plugin.json`)

  console.log(`seed/builtin-keyboard: ${outDir}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildSeed()
}

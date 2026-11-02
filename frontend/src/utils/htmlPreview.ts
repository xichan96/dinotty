/**
 * Helpers for the workspace HTML preview.
 *
 * The preview renders the editor buffer through an `<iframe srcdoc>`. That
 * document has no useful base URL, so `./style.css`, `<img src="logo.png">` and
 * friends would resolve against the Dinotty page instead of the HTML file's
 * directory. Rewriting those references to `/api/workspace/raw` URLs keeps
 * relative assets working while still previewing unsaved edits.
 */

/** Attributes whose value is a URL the iframe will load or navigate to. */
const URL_ATTRS: ReadonlyArray<readonly [string, string]> = [
  ['img', 'src'],
  ['script', 'src'],
  ['link', 'href'],
  ['a', 'href'],
  ['source', 'src'],
  ['video', 'src'],
  ['video', 'poster'],
  ['audio', 'src'],
  ['track', 'src'],
  ['iframe', 'src'],
  ['embed', 'src'],
  ['object', 'data'],
  ['input', 'src'],
]

/** Absolute URL, protocol-relative, root-relative, or a pure fragment. */
const NON_RELATIVE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi

/** True when the reference is a plain relative path worth remapping. */
export function isWorkspaceRelativeRef(ref: string): boolean {
  const value = ref.trim()
  return value.length > 0 && !NON_RELATIVE_RE.test(value)
}

/**
 * Resolve `ref` against the directory containing `filePath`.
 * Returns null when the reference escapes the workspace root or is empty.
 */
export function resolveRelativePath(filePath: string, ref: string): string | null {
  const withoutSuffix = ref.split('#')[0].split('?')[0]
  if (!withoutSuffix) return null
  const baseDir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
  const resolved: string[] = []
  for (const part of `${baseDir}/${withoutSuffix}`.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!resolved.length) return null
      resolved.pop()
      continue
    }
    resolved.push(part)
  }
  return resolved.length ? resolved.join('/') : null
}

function rewriteCssUrls(
  css: string,
  filePath: string,
  toRawUrl: (relativePath: string) => string
): string {
  return css.replace(CSS_URL_RE, (match, quote: string, ref: string) => {
    if (!isWorkspaceRelativeRef(ref)) return match
    const resolved = resolveRelativePath(filePath, ref)
    return resolved ? `url(${quote}${toRawUrl(resolved)}${quote})` : match
  })
}

/**
 * Rewrite relative URLs in an HTML document so they resolve through the
 * workspace raw endpoint. Uses DOMParser, which builds an inert document:
 * nothing is fetched or executed while rewriting.
 */
export function rewriteHtmlPreview(
  html: string,
  filePath: string,
  toRawUrl: (relativePath: string) => string
): string {
  if (!html || !filePath) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')

  for (const [tag, attr] of URL_ATTRS) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) {
      const ref = el.getAttribute(attr)
      if (ref == null || !isWorkspaceRelativeRef(ref)) continue
      const resolved = resolveRelativePath(filePath, ref)
      if (resolved) el.setAttribute(attr, toRawUrl(resolved))
    }
  }

  for (const el of Array.from(doc.querySelectorAll('img[srcset], source[srcset]'))) {
    const srcset = el.getAttribute('srcset')
    if (!srcset) continue
    const rewritten = srcset
      .split(',')
      .map((candidate) => {
        const [ref, ...descriptor] = candidate.trim().split(/\s+/)
        if (!ref || !isWorkspaceRelativeRef(ref)) return candidate
        const resolved = resolveRelativePath(filePath, ref)
        return resolved ? [toRawUrl(resolved), ...descriptor].join(' ') : candidate
      })
      .join(', ')
    el.setAttribute('srcset', rewritten)
  }

  for (const el of Array.from(doc.querySelectorAll('[style]'))) {
    const style = el.getAttribute('style')
    if (style) el.setAttribute('style', rewriteCssUrls(style, filePath, toRawUrl))
  }
  for (const style of Array.from(doc.getElementsByTagName('style'))) {
    if (style.textContent) style.textContent = rewriteCssUrls(style.textContent, filePath, toRawUrl)
  }

  const doctype = /^\s*<!doctype/i.test(html) ? '<!DOCTYPE html>\n' : ''
  return doctype + doc.documentElement.outerHTML
}

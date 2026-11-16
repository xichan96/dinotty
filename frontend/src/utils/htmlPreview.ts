/**
 * Helpers for the workspace HTML preview.
 *
 * The preview renders the editor buffer through an `<iframe srcdoc>`: that is
 * what makes unsaved edits visible, but it also means the document has no URL of
 * its own, so `./style.css` and `<img src="logo.png">` would resolve against the
 * Dinotty page instead of the HTML file's directory.
 *
 * Rewriting those references is not enough. The frame is sandboxed without
 * `allow-same-origin`, so its origin is opaque: it cannot present the session
 * cookie, and every asset request it makes to the authenticated API is answered
 * with 401. Worse, much of a real page's media is *built by script* at runtime
 * (`<img src>` assigned from a data table), where no string rewrite can see the
 * URL at all.
 *
 * So the frame is given a base URL instead: the host page — which *is*
 * authenticated — mints a directory-scoped token (`/api/workspace/preview-token`)
 * and injects `<base href="/preview-ws/<token>/">`. Every relative URL, static
 * or scripted, then resolves through a reader where the token in the path is the
 * credential. See `src/workspace/preview_ws.rs`.
 */

/** Absolute URL, protocol-relative, root-relative, or a pure fragment. */
const NON_RELATIVE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi

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

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * Point the framed document at `baseHref` so its relative URLs resolve there.
 *
 * A page-supplied `<base href>` would win if ours came later, so an existing one
 * is rewritten rather than duplicated. Nothing else about the document changes:
 * in particular the inline scripts that build media URLs keep working, because
 * the browser now resolves them against the preview reader.
 */
export function injectBaseHref(html: string, baseHref: string): string {
  if (!html || !baseHref) return html
  const tag = `<base href="${escapeAttribute(baseHref)}">`

  const existing = /<base\b[^>]*>/i.exec(html)
  if (existing) {
    const rewritten = existing[0].includes('href=')
      ? existing[0].replace(
          /(href\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i,
          `$1"${escapeAttribute(baseHref)}"`
        )
      : existing[0].replace(/^<base\b/i, `${tag}<base`)
    return (
      html.slice(0, existing.index) + rewritten + html.slice(existing.index + existing[0].length)
    )
  }

  const headOpen = /<head\b[^>]*>/i.exec(html)
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length
    return html.slice(0, at) + tag + html.slice(at)
  }
  const htmlOpen = /<html\b[^>]*>/i.exec(html)
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length
    return `${html.slice(0, at)}<head>${tag}</head>${html.slice(at)}`
  }
  return tag + html
}

/**
 * Rewrite relative URLs in an HTML document so they resolve through
 * `toRawUrl`. Used only when the preview token could not be minted (an older
 * server, or an SSH pane, which has no local reader): an authenticated raw URL
 * at least gives the frame a chance, where leaving the references alone would
 * point them at the Dinotty page.
 */
export function rewriteHtmlPreview(
  html: string,
  filePath: string,
  toRawUrl: (relativePath: string) => string
): string {
  if (!html || !filePath) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const mapRef = (ref: string): string | null => {
    if (!isWorkspaceRelativeRef(ref)) return null
    const resolved = resolveRelativePath(filePath, ref)
    return resolved ? toRawUrl(resolved) : null
  }
  const mapCss = (css: string): string =>
    css.replace(CSS_URL_RE, (match, quote: string, ref: string) => {
      const next = mapRef(ref)
      return next == null ? match : `url(${quote}${next}${quote})`
    })

  for (const [tag, attr] of URL_ATTRS) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) {
      const next = mapRef(el.getAttribute(attr) ?? '')
      if (next != null) el.setAttribute(attr, next)
    }
  }

  for (const el of Array.from(doc.querySelectorAll('img[srcset], source[srcset]'))) {
    const srcset = el.getAttribute('srcset')
    if (!srcset) continue
    el.setAttribute(
      'srcset',
      srcset
        .split(',')
        .map((candidate) => {
          const [ref, ...descriptor] = candidate.trim().split(/\s+/)
          if (!ref) return candidate
          const next = mapRef(ref)
          return next == null ? candidate : [next, ...descriptor].join(' ')
        })
        .join(', ')
    )
  }

  for (const el of Array.from(doc.querySelectorAll('[style]'))) {
    const style = el.getAttribute('style')
    if (style) el.setAttribute('style', mapCss(style))
  }
  for (const style of Array.from(doc.getElementsByTagName('style'))) {
    if (style.textContent) style.textContent = mapCss(style.textContent)
  }

  const doctype = /^\s*<!doctype/i.test(html) ? '<!DOCTYPE html>\n' : ''
  return doctype + doc.documentElement.outerHTML
}

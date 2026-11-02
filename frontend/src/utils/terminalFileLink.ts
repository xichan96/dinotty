/**
 * Detect file paths in terminal output so they can become clickable links.
 *
 * Agent/compiler/test output commonly looks like `src/foo.ts:42:7`,
 * `Update(src/foo.ts)` or `` `./scripts/build.sh` ``, so the detector accepts
 * bare relative paths, paths wrapped in punctuation, and `:line[:col]`
 * suffixes.
 *
 * Detection is deliberately conservative and synchronous: xterm link
 * providers run for every visible line, so we never touch the filesystem here.
 * Bare relative paths must end in a known source/text extension; a click still
 * resolves through the backend, which reports "not found" for false positives.
 */

export interface TerminalFileTarget {
  path: string
  line?: number
  column?: number
}

export interface TerminalFileLinkMatch extends TerminalFileTarget {
  /** Underlined text including any `:line[:col]` suffix. */
  raw: string
  /** 0-based start offset within the line. */
  start: number
  /** Exclusive end offset within the line. */
  end: number
}

/** Extensions that make a bare `dir/file.ext` token worth linking. */
const KNOWN_EXTENSIONS = new Set([
  'rs', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte',
  'md', 'mdx', 'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
  'py', 'pyi', 'go', 'java', 'kt', 'kts', 'scala', 'rb', 'php',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'm', 'mm', 'swift',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'xml', 'svg',
  'sql', 'graphql', 'gql', 'proto', 'lock', 'log', 'txt', 'csv', 'tsv',
  'ipynb', 'patch', 'diff', 'env',
])

/** Characters that terminate a path token. */
const TOKEN_STOP = new Set([
  ' ', '\t', '\n', '\r', '\f', '\v',
  '(', ')', '[', ']', '{', '}', '<', '>',
  ',', ';', '"', "'", '`', '|',
  // Full-width punctuation appears in CJK terminal output ("见（src/a.ts）").
  '（', '）', '【', '】', '「', '」', '《', '》', '，', '。', '；', '：',
])

/**
 * Characters that may immediately precede a path. Whitespace is handled
 * separately; these cover `Update(src/a.ts)`, `` `src/a.ts` ``, `"src/a.ts"`
 * and `--config=src/a.ts`.
 */
const TOKEN_BOUNDARY = new Set([
  '(', '[', '{', '<', '"', "'", '`', '=', '|', ':', ',', ';',
  '（', '【', '「', '《', '，', '；', '：',
])

function isBoundary(prev: string | undefined): boolean {
  return prev === undefined || /\s/.test(prev) || TOKEN_BOUNDARY.has(prev)
}

function hasKnownExtension(path: string): boolean {
  const slash = path.lastIndexOf('/')
  const base = slash === -1 ? path : path.slice(slash + 1)
  // Dotfiles such as `.env` have their name after the leading dot.
  const dot = base.startsWith('.') && !base.slice(1).includes('.') ? 0 : base.lastIndexOf('.')
  if (dot === -1 || dot === base.length - 1) return false
  return KNOWN_EXTENSIONS.has(base.slice(dot + 1).toLowerCase())
}

function isExplicitPath(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.startsWith('./') ||
    path.startsWith('../') ||
    path.startsWith('~/')
  )
}

function isPathLike(path: string): boolean {
  if (!path || path.includes('://')) return false
  // `//host/...` is the tail of a URL; the URL link provider owns it.
  if (path.startsWith('//')) return false
  // `--flag=value` is not a path. The scanner re-enters after `=` and matches
  // the value on its own.
  if (path.includes('=')) return false
  // Explicit prefixes are trusted (`./and/or` is still a path request), but a
  // bare separator (`cd /`) is not worth a link.
  if (isExplicitPath(path)) {
    return path !== '/' && path !== './' && path !== '../' && path !== '~/'
  }
  // Bare paths must end in a known source/text extension so prose such as
  // `and/or`, version strings, and flags never become links.
  return hasKnownExtension(path)
}

function parsePositionSuffix(token: string): {
  path: string
  line?: number
  column?: number
} {
  const withColumn = /^(.+):(\d+):(\d+)$/.exec(token)
  if (withColumn) {
    const line = Number(withColumn[2])
    const column = Number(withColumn[3])
    if (line >= 1 && column >= 1) {
      return { path: withColumn[1], line, column }
    }
  }
  const withLine = /^(.+):(\d+)$/.exec(token)
  if (withLine) {
    const line = Number(withLine[2])
    if (line >= 1) return { path: withLine[1], line }
  }
  return { path: token }
}

/**
 * Find every file path in one terminal buffer line.
 *
 * The returned offsets are 0-based character offsets suitable for converting
 * to xterm's 1-based cell ranges.
 */
export function findTerminalFileLinks(line: string): TerminalFileLinkMatch[] {
  const matches: TerminalFileLinkMatch[] = []
  let i = 0

  while (i < line.length) {
    if (!isBoundary(i === 0 ? undefined : line[i - 1])) {
      i += 1
      continue
    }

    let end = i
    while (end < line.length && !TOKEN_STOP.has(line[end])) end += 1
    if (end === i) {
      i += 1
      continue
    }

    // Sentence punctuation is not part of the path; a bare `src/a.ts:` or
    // `src/a.ts.` should still link.
    let token = line.slice(i, end)
    while (token.endsWith('.') || token.endsWith(':')) token = token.slice(0, -1)
    if (!token) {
      i += 1
      continue
    }

    const parsed = parsePositionSuffix(token)
    if (!isPathLike(parsed.path)) {
      i += 1
      continue
    }

    const start = i
    const tokenEnd = i + token.length
    matches.push({
      ...parsed,
      raw: token,
      start,
      end: tokenEnd,
    })
    i = tokenEnd
  }

  return matches
}

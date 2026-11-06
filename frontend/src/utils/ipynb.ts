/**
 * Jupyter notebook parsing for the preview pane.
 *
 * The preview wants a small, renderer-friendly model instead of the raw JSON:
 * cells in order, normalised outputs, and a selected mime payload per output.
 * Nothing here escapes or sanitises HTML — the component passes every payload
 * through DOMPurify before it reaches the DOM. Code is never executed.
 *
 * Both nbformat 4 (`cells[]`) and the common nbformat 3 layout
 * (`worksheets[].cells[]` with `input`) are accepted.
 */

/** Preferred mime types, most specific first. */
export const IPYNB_MIME_PREFERENCE = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'text/html',
  'application/json',
  'text/latex',
  'text/plain',
] as const

/** Hard ceiling for the one full-file fetch used by a truncated preview. */
export const IPYNB_MAX_FULL_BYTES = 16 * 1024 * 1024

export type IpynbCellType = 'markdown' | 'code' | 'raw'
export type IpynbOutputKind = 'stream' | 'error' | 'display' | 'result'
export type IpynbParseStatus = 'ok' | 'invalid-json' | 'unsupported-version' | 'unsupported-shape'

/** Raw mime bundle, kept so the component can fall back when a payload is unusable. */
export type IpynbMimeBundle = Record<string, unknown>

export interface IpynbOutput {
  kind: IpynbOutputKind
  /** Streams only: which terminal channel produced the text. */
  stream?: 'stdout' | 'stderr'
  /** Streams only. */
  text?: string
  /** Errors only. */
  ename?: string
  evalue?: string
  traceback?: string[]
  /** Display/result only: the mime chosen by {@link IPYNB_MIME_PREFERENCE}. */
  mime?: string
  /** Payload matching `mime` (string for text mimes, base64 text for images, JSON value for application/json). */
  data?: unknown
  bundle: IpynbMimeBundle
}

export interface IpynbCell {
  type: IpynbCellType
  source: string
  /** Kernel language for code cells, when the notebook declares one. */
  language?: string
  executionCount?: number | null
  outputs: IpynbOutput[]
}

export interface IpynbParseResult {
  cells: IpynbCell[]
  status: IpynbParseStatus
  /** Human-readable detail for the error statuses (English, shown as-is). */
  error?: string
  version?: number
  language?: string
}

const V3_MIME_KEYS: Record<string, string> = {
  text: 'text/plain',
  html: 'text/html',
  latex: 'text/latex',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpeg: 'image/jpeg',
  json: 'application/json',
}

// CSI escape sequences (colours, cursor moves) that IPython writes into
// tracebacks and stream output.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g

export function isIpynbFile(path: string): boolean {
  return /\.ipynb$/i.test(path.trim())
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Join notebook text, which nbformat stores as a string or an array of lines. */
export function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((part) => textOf(part)).join('')
  if (value === undefined || value === null) return ''
  return String(value)
}

/** Payload for text-like mimes and base64 image data. */
export function mimeText(value: unknown): string {
  return textOf(value)
}

/** Payload for `application/json` outputs, pretty-printed when possible. */
export function jsonText(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value)
  }
}

function selectMime(bundle: IpynbMimeBundle): string {
  for (const mime of IPYNB_MIME_PREFERENCE) {
    const value = bundle[mime]
    if (value !== undefined && value !== null) return mime
  }
  return Object.keys(bundle)[0] ?? ''
}

function notebookLanguage(metadata: Record<string, unknown>): string {
  const kernelspec = isRecord(metadata.kernelspec) ? metadata.kernelspec : null
  const languageInfo = isRecord(metadata.language_info) ? metadata.language_info : null
  return textOf(
    metadata.language ?? kernelspec?.language ?? languageInfo?.name ?? kernelspec?.name ?? ''
  )
}

function displayOutput(kind: 'display' | 'result', bundle: IpynbMimeBundle): IpynbOutput {
  const mime = selectMime(bundle)
  return { kind, mime, data: mime ? bundle[mime] : undefined, bundle }
}

/**
 * Normalise one nbformat output. Unknown output types are dropped rather than
 * guessed at: silently rendering the wrong field would be worse than omitting it.
 */
function normalizeOutput(raw: unknown): IpynbOutput | null {
  if (!isRecord(raw)) return null
  const outputType = textOf(raw.output_type)

  if (outputType === 'stream') {
    return {
      kind: 'stream',
      stream: raw.name === 'stderr' || raw.stream === 'stderr' ? 'stderr' : 'stdout',
      text: textOf(raw.text),
      bundle: {},
    }
  }

  if (outputType === 'error' || outputType === 'pyerr') {
    return {
      kind: 'error',
      ename: textOf(raw.ename),
      evalue: textOf(raw.evalue),
      traceback: Array.isArray(raw.traceback) ? raw.traceback.map((line) => textOf(line)) : [],
      bundle: {},
    }
  }

  if (outputType === 'execute_result' || outputType === 'pyout' || outputType === 'display_data') {
    const kind: 'display' | 'result' = outputType === 'display_data' ? 'display' : 'result'
    const bundle: IpynbMimeBundle = {}
    // nbformat 4 keeps payloads under `data`; nbformat 3 `pyout` and some
    // display_data writers put mime-specific keys directly on the output.
    if (isRecord(raw.data)) Object.assign(bundle, raw.data)
    for (const [key, mime] of Object.entries(V3_MIME_KEYS)) {
      if (raw[key] !== undefined) bundle[mime] = raw[key]
    }
    return displayOutput(kind, bundle)
  }

  return null
}

function cellOutputs(raw: Record<string, unknown>): IpynbOutput[] {
  if (!Array.isArray(raw.outputs)) return []
  const outputs: IpynbOutput[] = []
  for (const item of raw.outputs) {
    const output = normalizeOutput(item)
    if (output) outputs.push(output)
  }
  return outputs
}

function executionCountOf(raw: Record<string, unknown>): number | null {
  if (typeof raw.execution_count === 'number') return raw.execution_count
  return null
}

/** nbformat 4 cell. */
function parseV4Cell(raw: Record<string, unknown>, language: string): IpynbCell {
  const cellType = textOf(raw.cell_type)
  const type: IpynbCellType = cellType === 'code' ? 'code' : cellType === 'raw' ? 'raw' : 'markdown'
  return {
    type,
    source: textOf(raw.source),
    language: type === 'code' ? language || undefined : undefined,
    executionCount: type === 'code' ? executionCountOf(raw) : undefined,
    outputs: type === 'code' ? cellOutputs(raw) : [],
  }
}

/** nbformat 3 cell (`input` for code, `heading` promoted to markdown). */
function parseV3Cell(raw: Record<string, unknown>, language: string): IpynbCell {
  const cellType = textOf(raw.cell_type)
  if (cellType === 'heading') {
    const level = Math.min(6, Math.max(1, Number(raw.level) || 1))
    return {
      type: 'markdown',
      source: `${'#'.repeat(level)} ${textOf(raw.source)}`,
      outputs: [],
    }
  }
  const type: IpynbCellType = cellType === 'code' ? 'code' : cellType === 'raw' ? 'raw' : 'markdown'
  const cellLanguage = textOf(raw.language) || language
  return {
    type,
    source: type === 'code' ? textOf(raw.input) : textOf(raw.source),
    language: type === 'code' ? cellLanguage || undefined : undefined,
    executionCount: type === 'code' ? executionCountOf(raw) : undefined,
    outputs: type === 'code' ? cellOutputs(raw) : [],
  }
}

export function parseIpynb(text: string): IpynbParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return {
      cells: [],
      status: 'invalid-json',
      error: error instanceof Error ? error.message : String(error),
    }
  }

  if (!isRecord(raw)) {
    return { cells: [], status: 'unsupported-shape', error: 'Notebook root is not an object' }
  }

  const parsedVersion =
    typeof raw.nbformat === 'number'
      ? raw.nbformat
      : typeof raw.nbformat === 'string'
        ? Number(raw.nbformat)
        : undefined
  const version =
    parsedVersion !== undefined && !Number.isNaN(parsedVersion) ? parsedVersion : undefined
  if (version !== undefined && version !== 3 && version !== 4) {
    return {
      cells: [],
      status: 'unsupported-version',
      version,
      error: `Unsupported nbformat version ${version}`,
    }
  }

  const metadata = isRecord(raw.metadata) ? raw.metadata : {}
  const language = notebookLanguage(metadata)

  // nbformat 4 first; fall back to the nbformat 3 worksheets layout, including
  // notebooks that omitted (or mis-stated) `nbformat`.
  const v4Cells: unknown[] | null = Array.isArray(raw.cells) ? raw.cells : null
  let v3Cells: unknown[] | null = null
  if (Array.isArray(raw.worksheets)) {
    v3Cells = []
    for (const sheet of raw.worksheets) {
      if (isRecord(sheet) && Array.isArray(sheet.cells)) v3Cells.push(...sheet.cells)
    }
  }

  if (!v4Cells && !v3Cells) {
    return {
      cells: [],
      status: 'unsupported-shape',
      error: 'Notebook has no cells array',
    }
  }

  const useV3 = !v4Cells || (version === 3 && v3Cells !== null)
  const rawCells = useV3 ? (v3Cells ?? []) : (v4Cells ?? [])
  const cells: IpynbCell[] = []
  for (const item of rawCells) {
    if (!isRecord(item)) continue
    cells.push(useV3 ? parseV3Cell(item, language) : parseV4Cell(item, language))
  }

  return { cells, status: 'ok', version, language }
}

/** Text shown for a stream/error/plain output, with terminal escapes removed. */
export function outputText(output: IpynbOutput): string {
  if (output.kind === 'stream') return stripAnsi(output.text ?? '')
  if (output.kind === 'error') {
    const headline = output.ename
      ? `${output.ename}${output.evalue ? `: ${output.evalue}` : ''}`
      : (output.evalue ?? '')
    return stripAnsi(
      [headline, ...(output.traceback ?? [])].filter((line) => line.length > 0).join('\n')
    )
  }
  if (output.mime === 'application/json') return jsonText(output.data)
  return stripAnsi(mimeText(output.data))
}

/** `data:` URL for raster image outputs. */
export function imageDataUrl(output: IpynbOutput): string | null {
  if (output.mime !== 'image/png' && output.mime !== 'image/jpeg') return null
  // Base64 is often split into line chunks; whitespace is not significant.
  const payload = mimeText(output.data).replace(/\s+/g, '')
  return `data:${output.mime};base64,${payload}`
}

/**
 * Best text fallback when the selected payload cannot be rendered (for example
 * sanitizing an HTML/SVG payload produced nothing).
 */
export function fallbackText(output: IpynbOutput): string {
  if (output.kind === 'stream' || output.kind === 'error') return outputText(output)
  for (const mime of ['text/plain', 'text/latex'] as const) {
    const value = output.bundle[mime]
    if (value !== undefined && value !== null) return textOf(value)
  }
  return outputText(output)
}

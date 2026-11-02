/** Shared outline model for Markdown, code symbols and structured data. */
export type OutlineKind =
  | 'heading'
  | 'interface'
  | 'class'
  | 'function'
  | 'method'
  | 'property'
  | 'const'
  | 'type'
  | 'object'
  | 'array'
  | 'scalar'

export interface OutlineItem {
  /** Stable across re-renders: slug, `language:name:line`, or JSON path. */
  id: string
  label: string
  kind: OutlineKind
  /** 1-based source line. */
  line: number
  /** Markdown heading anchor (same slug the preview injects). */
  anchor?: string
  /** Short value preview for JSON leaves. */
  value?: string
  /** Heading level (1–6) for the H badge. */
  level?: number
  children?: OutlineItem[]
}

export type OutlineMode = 'markdown' | 'code' | 'json' | 'none'

export type OutlineStatus = 'ok' | 'empty' | 'error'

export interface OutlineSource {
  mode: OutlineMode
  items: OutlineItem[]
  status: OutlineStatus
  /** True while a debounced scan is still pending. */
  loading: boolean
  /** Where the items came from; `regex` is surfaced in the UI. */
  provider?: 'lexer' | 'regex' | 'monaco' | 'json'
  /** Normalized code language, when applicable. */
  language?: string
  /** Error headline or detail (JSON parse errors). */
  message?: string
  /** 1-based line of a parse error. */
  errorLine?: number
}

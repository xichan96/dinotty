/**
 * Synchronous outline builders shared by the composable fallback and the
 * parsing worker.
 *
 * Only `code` and `json` are handled here; Markdown headings come from the
 * preview's lexer pass. The `default` branch keeps this module additive so
 * other structured formats (YAML/TOML) can be layered on without moving code
 * around.
 */
import type { OutlineMode, OutlineSource } from '../types/outline'
import { collectDocumentSymbols, normalizeCodeLanguage } from './codeSymbols'
import { parseJsonOutline } from './jsonOutline'

export type OutlineWorkerMode = 'code' | 'json'

export interface OutlineBuildInput {
  mode: OutlineMode
  language?: string | null
  text: string
}

/** Message posted to the outline worker. */
export interface OutlineWorkerRequest {
  id: number
  mode: OutlineWorkerMode
  language: string | null
  text: string
}

/** Reply posted back by the outline worker. */
export interface OutlineWorkerReply {
  id: number
  source: OutlineSource
}

export function buildOutlineSync({ mode, language, text }: OutlineBuildInput): OutlineSource {
  if (mode === 'json') {
    const result = parseJsonOutline(text)
    if (result.errorLine !== undefined) {
      return {
        mode,
        items: [],
        status: 'error',
        loading: false,
        provider: 'json',
        message: result.errorMessage,
        errorLine: result.errorLine,
      }
    }
    return {
      mode,
      items: result.items,
      status: result.items.length > 0 ? 'ok' : 'empty',
      loading: false,
      provider: 'json',
    }
  }

  if (mode === 'code') {
    const normalized = normalizeCodeLanguage(language)
    const items = normalized ? collectDocumentSymbols(text, normalized) : []
    return {
      mode,
      items,
      status: items.length > 0 ? 'ok' : 'empty',
      loading: false,
      provider: 'regex',
      language: normalized ?? undefined,
    }
  }

  return { mode, items: [], status: 'empty', loading: false }
}

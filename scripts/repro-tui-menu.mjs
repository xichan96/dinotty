#!/usr/bin/env node
/**
 * Terminal fixture for the touch-menu repro.
 *
 * Mimics the shape the user hits in opencode: a long run of full-width lines
 * (the skill/tool output) followed by clickable answer options, with SGR mouse
 * tracking enabled. Every click selects an option and appends another round,
 * so the wrapped-line chain grows while the test keeps tapping.
 *
 * Run inside a Dinotty terminal:
 *   node scripts/repro-tui-menu.mjs
 *
 * Quit with `q` (or Ctrl-C).
 */

import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.stdout
const cols = () => out.columns || 80
const rows = () => out.rows || 24
const inputLog = process.env.DINOTTY_MENU_LOG || join(process.env.TEMP || tmpdir(), 'dinotty-tui-menu-input.log')

appendFileSync(inputLog, `START ${new Date().toISOString()}\n`)

let selected = 0

function fullWidthRow(text) {
  const width = cols()
  const clipped = text.length > width ? text.slice(0, width) : text
  return clipped.padEnd(width, ' ')
}

function emitChain(count) {
  // No newlines: every row exactly fills the width, so xterm marks the next row
  // as a soft-wrap continuation and the whole run becomes one logical line.
  const width = cols()
  const line = '━'.repeat(width)
  for (let i = 0; i < count; i += 1) out.write(line)
}

function emitMenu() {
  emitChain(120)
  const options = [
    '[1] Apply the generated patch',
    '[2] Run the test suite',
    '[3] Show the diff',
    '[4] Skip this step',
  ]
  for (const option of options) out.write(fullWidthRow(option))
  out.write(
    `\r\nDINOTTY-MENU ready — selections=${selected} — tap an option (log=${inputLog})\r\n`
  )
}

function redraw() {
  clearTimeout(resetTimer)
  emitMenu()
}

function shutdown() {
  out.write('\x1b[?1006l\x1b[?1000l\x1b[?25h\r\n')
  process.exit(0)
}

let resetTimer = null
let inputBuffer = ''
let lastInput = ''
process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.setEncoding('utf8')
out.write('\x1b[?1049l\x1b[?25l\x1b[?1000h\x1b[?1006h')
redraw()

process.stdin.on('data', (data) => {
  appendFileSync(inputLog, `${JSON.stringify(data)}\n`)
  lastInput = JSON.stringify(data).slice(0, 80)
  if (data === 'q' || data === '\u0003') shutdown()

  inputBuffer += data
  const mouse = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g
  let match
  let consumed = 0
  while ((match = mouse.exec(inputBuffer)) !== null) {
    consumed = mouse.lastIndex
    const button = Number(match[1])
    const [, , x, y] = match
    // Button 0 press only (wheel/other buttons ignored).
    if ((button & 3) !== 0 || match[4] !== 'M') continue
    selected += 1
    out.write(`\r\nSELECTED ${selected} at ${x},${y}\r\n`)
    resetTimer = setTimeout(redraw, 120)
    if (selected % 4 === 0) {
      // Occasionally make the next round's chain much longer, the way a real
      // agent's output grows between questions.
      emitChain(400)
    }
  }
  // Keep only an unterminated escape sequence (a report split across reads).
  inputBuffer = inputBuffer.slice(consumed)
  if (inputBuffer.length > 64) inputBuffer = ''
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

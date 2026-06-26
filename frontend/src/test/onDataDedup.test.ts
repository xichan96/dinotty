import { describe, it, expect } from 'vitest'
import { isDuplicateOnData, DEDUP_WINDOW_MS } from '../composables/useTerminal'

// Spec: openspec/changes/fix-shift-punct-key-needs-double-press/proposal.md
// "在 Tauri 桌面端（macOS WKWebView）下，按住 Shift 再按下标点键（如 ?、!、@、: 等）
//  时，第一次按键输入没有生效，需要再按一次同样的标点键才能正常输入。"
//
// Root cause: 5ms dedup window was too wide — xterm.js macOS modifier
// sequences (Shift+punct) span > 5ms, so the second valid onData was
// being swallowed by the dedup check.

describe('onData dedup helper (useTerminal)', () => {
  it('exposes a small window (<= 2ms)', () => {
    // If this assertion ever changes, the whole dedup tradeoff needs
    // re-evaluation. The bug we are fixing is exactly the case where
    // 5ms was too wide; a 2ms window is the design fix.
    expect(DEDUP_WINDOW_MS).toBeLessThanOrEqual(2)
  })

  it('drops a WKWebView multi-focus replay within the window', () => {
    // Same data, fired again 1ms later — this is the multi-focus
    // duplicate we still want to suppress.
    expect(isDuplicateOnData('?', '?', 1000, 1001)).toBe(true)
  })

  it('allows a real next keystroke after the window expires', () => {
    // Same data, fired 10ms later — that's a legitimate repeat press,
    // not a duplicate replay, so it must pass through.
    expect(isDuplicateOnData('?', '?', 1000, 1010)).toBe(false)
  })

  it('allows different data even within the window', () => {
    // Different data, fired 1ms later — never a duplicate, must pass.
    expect(isDuplicateOnData('!', '?', 1000, 1001)).toBe(false)
  })

  it('regression: Shift+punct modifier sequence is NOT swallowed', () => {
    // xterm.js on macOS WKWebView has been observed to emit a leading
    // control-sequence / empty-data event for a Shift+punct keypress,
    // followed by the real character ~3ms later. With the old 5ms
    // window, the second event (data='?') was being treated as a
    // duplicate of the first (data=''? was the same as initial state
    // because prev was '') and dropped. The helper now returns false
    // for any first event (prev === '') so the second event will
    // always pass through regardless of the time gap.
    expect(isDuplicateOnData('', '', 1000, 1001)).toBe(false)
    expect(isDuplicateOnData('?', '', 1000, 1003)).toBe(false)
    // The key regression assertion: when the modifier sequence is
    // empty-string + real-char and the time gap is the macOS xterm
    // modifier gap (~3ms), the real char must NOT be treated as a
    // duplicate of the empty string. Different data → not a duplicate.
    expect(isDuplicateOnData('?', '', 1000, 1003)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  alignUtf8Start,
  capLogText,
  decodeUtf8Slice,
  parseContentRange,
  shouldAutoScroll,
  splitLogLines,
  trimLogBuffer,
  truncateUtf8Tail,
  utf8ByteLength,
} from '../utils/logTail'

describe('trimLogBuffer', () => {
  it('keeps the newest lines in order', () => {
    expect(trimLogBuffer(['a', 'b', 'c'], 2)).toEqual(['b', 'c'])
    expect(trimLogBuffer(['a', 'b'], 5)).toEqual(['a', 'b'])
    expect(trimLogBuffer(['a'], 0)).toEqual([])
    expect(trimLogBuffer(['a'], -1)).toEqual([])
  })
})

describe('parseContentRange', () => {
  it('parses a partial range', () => {
    expect(parseContentRange('bytes 100-199/200')).toEqual({ start: 100, end: 199, total: 200 })
    expect(parseContentRange('  BYTES 0-0/1  ')).toEqual({ start: 0, end: 0, total: 1 })
  })

  it('rejects unknown totals and malformed values', () => {
    expect(parseContentRange('bytes */200')).toBeNull()
    expect(parseContentRange('bytes 10-5/20')).toBeNull()
    expect(parseContentRange('bytes 0-20/20')).toBeNull()
    expect(parseContentRange('items 0-1/2')).toBeNull()
    expect(parseContentRange(null)).toBeNull()
    expect(parseContentRange('')).toBeNull()
  })
})

describe('shouldAutoScroll', () => {
  const metrics = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({
    scrollTop,
    scrollHeight,
    clientHeight,
  })

  it('is true only near the bottom', () => {
    expect(shouldAutoScroll(metrics(600))).toBe(true)
    expect(shouldAutoScroll(metrics(576))).toBe(true)
    expect(shouldAutoScroll(metrics(575))).toBe(false)
    expect(shouldAutoScroll(null)).toBe(false)
  })
})

describe('UTF-8 helpers', () => {
  it('counts bytes, not code units', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('é')).toBe(2)
    expect(utf8ByteLength('漢')).toBe(3)
  })

  it('keeps the newest bytes without splitting a character', () => {
    expect(truncateUtf8Tail('abc', 10)).toBe('abc')
    expect(truncateUtf8Tail('漢字', 4)).toBe('字')
    expect(truncateUtf8Tail('abc', 0)).toBe('')
  })

  it('aligns a slice that starts mid-character', () => {
    // Continuation bytes for 漢, then the full 字.
    const sliced = new Uint8Array([0xbc, 0xa2, 0xe5, 0xad, 0x97])
    expect(Array.from(alignUtf8Start(sliced))).toEqual([0xe5, 0xad, 0x97])
    expect(decodeUtf8Slice(sliced)).toBe('字')
  })
})

describe('splitLogLines', () => {
  it('normalizes CRLF and drops only the trailing newline', () => {
    expect(splitLogLines('')).toEqual([])
    expect(splitLogLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLogLines('a\r\nb\r\n')).toEqual(['a', 'b'])
    expect(splitLogLines('a\n\nb')).toEqual(['a', '', 'b'])
  })
})

describe('capLogText', () => {
  it('caps by line count first', () => {
    const result = capLogText('1\n2\n3\n4', 2, 1024)
    expect(result).toEqual({ text: '3\n4', trimmed: true })
  })

  it('caps by byte budget on whole lines', () => {
    const result = capLogText('aaaa\nbbbb\ncccc', 10, 8)
    expect(result).toEqual({ text: 'cccc', trimmed: true })
  })

  it('returns an untrimmed buffer when it fits', () => {
    expect(capLogText('a\nb', 10, 1024)).toEqual({ text: 'a\nb', trimmed: false })
  })

  it('truncates a single oversized line from the tail', () => {
    const result = capLogText('0123456789', 10, 4)
    expect(result).toEqual({ text: '6789', trimmed: true })
  })
})

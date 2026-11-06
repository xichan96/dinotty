import { describe, expect, it } from 'vitest'
import { previewPathFor, targetFromPreviewPath, urlToPreviewSrc } from '../utils/previewRouting'

// base64url(origin), no padding — must match `encode_preview_target` (Rust).
const IP80 = 'aHR0cDovLzE3Mi4yNS4yNi4yNTI6ODA'
const IP8080 = 'aHR0cDovLzE3Mi4yNS4yNi4yNTI6ODA4MA'
const HTTPS443 = 'aHR0cHM6Ly8xNzIuMjUuMjYuMjUyOjQ0Mw'
const HTTPS8443 = 'aHR0cHM6Ly8xNzIuMjUuMjYuMjUyOjg0NDM'
const LOCAL5173 = 'aHR0cDovL2xvY2FsaG9zdDo1MTcz'

describe('previewPathFor', () => {
  it('encodes the origin into one segment and keeps the app path visible', () => {
    expect(previewPathFor('http://172.25.26.252')).toBe(`/preview/${IP80}/`)
    expect(previewPathFor('http://172.25.26.252:8080/app?a=1')).toBe(
      `/preview/${IP8080}/app?a=1`
    )
  })

  it('keeps multi-segment routes intact', () => {
    expect(previewPathFor('http://10.70.11.20:8089/slaves/04403aa6fc000a00/workflow-manage')).toBe(
      '/preview/aHR0cDovLzEwLjcwLjExLjIwOjgwODk/slaves/04403aa6fc000a00/workflow-manage'
    )
  })

  it('carries https so intranet TLS targets are dialed with TLS', () => {
    expect(previewPathFor('https://172.25.26.252')).toBe(`/preview/${HTTPS443}/`)
    expect(previewPathFor('https://172.25.26.252:8443/x')).toBe(`/preview/${HTTPS8443}/x`)
  })

  it('routes loopback hosts through the same canonical form', () => {
    expect(previewPathFor('http://localhost:5173/')).toBe(`/preview/${LOCAL5173}/`)
  })

  it('leaves public hosts on the external proxy', () => {
    expect(previewPathFor('https://example.com/a')).toBeNull()
    expect(urlToPreviewSrc('https://example.com/a')).toBe(
      `/api/proxy?url=${encodeURIComponent('https://example.com/a')}`
    )
  })
})

describe('urlToPreviewSrc', () => {
  it('returns a same-origin path so the caller can add the relay prefix', () => {
    expect(urlToPreviewSrc('http://172.25.26.252')).toBe(`/preview/${IP80}/`)
  })

  it('keeps about:blank for an empty target', () => {
    expect(urlToPreviewSrc('')).toBe('about:blank')
  })
})

describe('targetFromPreviewPath', () => {
  it('round-trips the proxy route shown in the address box', () => {
    const url = 'http://10.70.11.20:8089/slaves/04403aa6fc000a00/workflow-manage'
    expect(targetFromPreviewPath(urlToPreviewSrc(url))).toBe(url)
  })

  it('accepts a route carrying the hub relay prefix', () => {
    const url = 'http://172.25.26.252:8080/app?a=1'
    const route = `/__srv/srv-a${urlToPreviewSrc(url)}`
    expect(targetFromPreviewPath(route)).toBe(url)
  })

  it('accepts the external proxy route', () => {
    expect(targetFromPreviewPath(urlToPreviewSrc('https://example.com/a'))).toBe(
      'https://example.com/a'
    )
  })

  it('does not treat ordinary input as a route', () => {
    expect(targetFromPreviewPath('10.70.11.20:8089/x')).toBeNull()
    expect(targetFromPreviewPath('/preview/not-base64!/x')).toBeNull()
  })
})

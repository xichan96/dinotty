// Service worker for PWA installability + weak-network resilience.
//
// Caching rules, and why each one is what it is:
//
//   /assets/*   cache-first, permanent. Vite content-hashes every filename, so
//               a URL's bytes never change. A new build emits new filenames, so
//               cache-first can never serve a stale version of the current app.
//
//   /icons/*    network-first. These filenames are stable (icon-192.png always
//   navigation  means "the current 192px icon"), and the HTML must stay fresh
//               because it is what points at the new hashed assets. Cache-first
//               would pin both to old bytes until a CACHE_VERSION bump; falling
//               back to the last good copy is what makes the app open at all on
//               a flaky connection instead of hanging.
//
//   everything  not touched. API calls, WebSockets and SSE must never be
//   else        served from cache.
//
// CACHE_VERSION must be bumped whenever these rules change; `activate` deletes
// every cache that is not the current one, which is the escape hatch that keeps
// users from being pinned to an old strategy.
const CACHE_VERSION = 'v2'
const ASSET_CACHE = `dinotty-assets-${CACHE_VERSION}`
const SHELL_CACHE = `dinotty-shell-${CACHE_VERSION}`
const KEEP = [ASSET_CACHE, SHELL_CACHE]

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)))
      await self.clients.claim()
    })()
  )
})

// Lets the page trigger an immediate update instead of waiting for a reload.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

// Only /assets/ is content-hashed, so only /assets/ may be cached permanently.
// /icons/ deliberately excluded: its filenames are stable, so cache-first would
// serve stale icons indefinitely.
function isHashedAsset(url) {
  return url.pathname.startsWith('/assets/')
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const resp = await fetch(request)
  // Only store complete, successful, same-origin responses. Opaque or partial
  // responses would poison the cache with unusable entries.
  if (resp && resp.status === 200 && resp.type === 'basic') {
    cache.put(request, resp.clone())
  }
  return resp
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const resp = await fetch(request)
    if (resp && resp.status === 200 && resp.type === 'basic') {
      cache.put(request, resp.clone())
    }
    return resp
  } catch (err) {
    const hit = await cache.match(request)
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // Cross-origin (including /preview proxy targets) is left alone.
  if (url.origin !== self.location.origin) return

  // Never interfere with live connections or the API surface.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws') ||
    url.pathname.startsWith('/preview/') ||
    request.headers.get('accept')?.includes('text/event-stream')
  ) {
    return
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
    return
  }

  // Stable-named icons and the app shell: keep a fallback copy for offline /
  // flaky-network starts, but always prefer fresh bytes.
  if (url.pathname.startsWith('/icons/') || request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE))
  }
})

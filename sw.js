/* Testudo service worker — caches app shell + wasm for offline use */
const CACHE = 'testudo-fea-v3'
const BASE = self.registration.scope

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    const shell = [
      './',
      './index.html',
      './manifest.json',
      './icons/icon-192.png',
      './icons/icon-512.png',
      './icons/testudo.svg',
      './apple-touch-icon.png',
      './favicon.ico',
      './occt-import-js.wasm',
      './occt-import-js.js',
    ].map((p) => new URL(p, BASE).href)
    await cache.addAll(shell).catch(() => {})
    self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Network-first for HTML navigations; cache-first for assets/wasm
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')
  const isAsset = /\.(js|css|wasm|png|jpg|svg|woff2?)(\?|$)/i.test(url.pathname)

  if (isNav) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req)
        const cache = await caches.open(CACHE)
        cache.put(req, net.clone())
        return net
      } catch {
        const cached = await caches.match(req) || await caches.match(new URL('./index.html', BASE).href)
        return cached || new Response('Offline', { status: 503 })
      }
    })())
    return
  }

  if (isAsset) {
    event.respondWith((async () => {
      const cached = await caches.match(req)
      if (cached) return cached
      try {
        const net = await fetch(req)
        if (net.ok) {
          const cache = await caches.open(CACHE)
          cache.put(req, net.clone())
        }
        return net
      } catch {
        return cached || Response.error()
      }
    })())
  }
})

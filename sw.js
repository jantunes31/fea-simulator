/* JANTVS Testudo service worker — caches app shell + wasm for offline use */
const CACHE = 'jantvs-testudo-v21'
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
      './icons/icon-maskable-192.png',
      './icons/icon-maskable-512.png',
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

// Offline warm-up (requested by the page once it has loaded): fetch the
// large mesher / CAD-import runtimes in the background so the installed app
// can import and mesh with no network.
const WARM = [
  './gmsh/gmsh.mjs', './gmsh/gmsh-core.mjs', './gmsh/gmsh-core.wasm', './gmsh/gmsh-descriptor.mjs', './gmsh/runtime.mjs',
  './occt-import-js.js', './occt-import-js.wasm', './samples/cantilever_block.step',
]
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm-cache') return
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    for (const p of WARM) {
      const url = new URL(p, BASE).href
      if (await cache.match(url)) continue
      try {
        const res = await fetch(url)
        if (res.ok) await cache.put(url, res)
      } catch { /* offline: try next time */ }
    }
  })())
})

// Cross-origin isolation (COOP/COEP) for SharedArrayBuffer: GitHub Pages
// cannot send these headers, so the service worker adds them to every
// same-origin response (the "coi-serviceworker" technique). Needed by the
// multithreaded gmsh mesher (WebAssembly pthreads) and by solver Pause/Resume.
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res
  const headers = new Headers(res.headers)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
  headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Network-first for HTML navigations; cache-first for assets/wasm
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')
  const isAsset = /\.(m?js|css|wasm|png|jpg|svg|woff2?)(\?|$)/i.test(url.pathname)

  if (isNav) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req)
        const cache = await caches.open(CACHE)
        cache.put(req, net.clone())
        return isolate(net)
      } catch {
        const cached = await caches.match(req) || await caches.match(new URL('./index.html', BASE).href)
        return cached ? isolate(cached) : new Response('Offline', { status: 503 })
      }
    })())
    return
  }

  event.respondWith((async () => {
    const cached = isAsset ? await caches.match(req) : null
    if (cached) return isolate(cached)
    try {
      const net = await fetch(req)
      if (isAsset && net.ok) {
        const cache = await caches.open(CACHE)
        cache.put(req, net.clone())
      }
      return isolate(net)
    } catch {
      // Offline: fall back to any cached copy (manifest.json, samples, …)
      const any = await caches.match(req, { ignoreSearch: true })
      return any ? isolate(any) : Response.error()
    }
  })())
})

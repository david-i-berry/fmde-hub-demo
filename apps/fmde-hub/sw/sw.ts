// FMDEhub's service worker: makes the app installable and usable offline.
// - install: cache every file of this build (the list is injected by build/service-worker.ts)
// - fetch:   answer same-origin GET requests from that cache, else from the network; page
//            navigations get the cached index.html (the app routes client-side)
// - update:  a new build installs alongside and waits; the page asks the user, then sends
//            SKIP_WAITING (never reload under the user: an in-memory database would be lost)
// - activate: delete the caches of earlier builds
// Everything else (config.json, map tiles, the broker) goes to the network untouched.

// a module (export {}), so `self` can be declared with the service worker's type
export {}
declare const self: ServiceWorkerGlobalScope
/** Replaced at build time: the build's files, relative to the scope, and a hash of their contents. */
declare const __FMDEHUB_PRECACHE__: string[]
declare const __FMDEHUB_CACHE_VERSION__: string

const PREFIX = 'fmde-hub-'
const CACHE = `${PREFIX}${__FMDEHUB_CACHE_VERSION__}`
const inScope = (path: string) => new URL(path, self.registration.scope).href
const INDEX = inScope('index.html')

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(__FMDEHUB_PRECACHE__.map(inScope))))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))),
  )
})

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return
  const cached = request.mode === 'navigate' ? caches.match(INDEX, { cacheName: CACHE }) : caches.match(request, { cacheName: CACHE })
  event.respondWith(cached.then((response) => response ?? fetch(request)))
})

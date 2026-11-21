// Registers sw.js (production builds only) and reports when a new version is waiting. The page
// reloads only after the user chose to update: never under them (an in-memory database would be lost).
import { ref } from 'vue'

export function useServiceWorker() {
  const needRefresh = ref(false)
  let waiting: ServiceWorker | null = null
  let updateRequested = false

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const offer = (worker: ServiceWorker | null) => {
      // no controller yet: this is the first install, not an update
      if (worker && navigator.serviceWorker.controller) {
        waiting = worker
        needRefresh.value = true
      }
    }
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).then((registration) => {
      offer(registration.waiting)
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') offer(worker)
        })
      })
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateRequested) location.reload()
    })
  }

  /** Activate the waiting version; the page reloads when it takes over. */
  function update() {
    updateRequested = true
    waiting?.postMessage({ type: 'SKIP_WAITING' })
  }

  return { needRefresh, update }
}

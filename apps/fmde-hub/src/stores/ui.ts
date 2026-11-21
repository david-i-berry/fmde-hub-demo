import { mapboxBasemap } from '@fmde-hub/components'
import type { IngestEvent, SourceStatus } from '@fmde-hub/ingest'
import { computed, reactive, ref, shallowRef, triggerRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { onDataChange, onHubEvent, sendControl } from '../db/client'

const PREFS_KEY = 'fmde-hub.prefs'
const INSPECTOR_MAX = 1000

export const WINDOWS = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '48h': 48 * 3600,
  '7d': 7 * 86400,
} as const
export type WindowKey = keyof typeof WINDOWS

interface Prefs {
  utc: boolean
  theme: 'system' | 'light' | 'dark'
  /** nodes with metadata but no data yet (e.g. retained POC1 metadata) are hidden unless this is on */
  showNeverSeen: boolean
  /** Custom basemap: a Mapbox style URL and public token; both empty for the default map. */
  mapboxStyleUrl: string
  mapboxToken: string
}
const DEFAULT_PREFS: Prefs = { utc: true, theme: 'system', showNeverSeen: false, mapboxStyleUrl: '', mapboxToken: '' }

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

// App-wide UI state: one reactive object, created on first use and shared by every component.
// Vue's reactive() unwraps the refs, so callers read ui.now and assign ui.paused = true directly.
function createUiStore() {
  const prefs = ref(loadPrefs())
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value))
    } catch {
      // per-viewer convenience only
    }
  }

  // "now" ticks every 15 s, so ages and windows move without new data. When ingest writes, it jumps
  // to the current time together with dataVersion, so a window always includes the newest data and
  // each query re-runs once per change (useQuery watches both).
  const now = ref(Date.now())
  /** Bumped when the data changes (at most every 750 ms); every useQuery re-runs on it. */
  const dataVersion = ref(0)
  setInterval(() => (now.value = Date.now()), 15_000)
  let changePending: ReturnType<typeof setTimeout> | null = null
  onDataChange(() => {
    changePending ??= setTimeout(() => {
      changePending = null
      now.value = Date.now()
      dataVersion.value++
    }, 750)
  })

  // ingest hub status and the live inspector stream
  const source = ref<SourceStatus>({ source: null, state: 'idle', received: 0 })
  const events = shallowRef<IngestEvent[]>([])
  const paused = ref(false)
  onHubEvent((e) => {
    if (e.type === 'status') source.value = e.status
    else if (!paused.value) {
      const next = events.value.concat(e.events)
      events.value = next.length > INSPECTOR_MAX ? next.slice(-INSPECTOR_MAX) : next
      triggerRef(events)
    }
  })
  sendControl({ type: 'status' })

  /** Failed queries of the components on screen, by query: shown once by the app, not per view. */
  const queryErrors = reactive(new Map<number, string>())

  /** The custom basemap, or null for the map's default. */
  const basemap = computed(() => mapboxBasemap(prefs.value.mapboxStyleUrl, prefs.value.mapboxToken))

  return reactive({ prefs, savePrefs, now, dataVersion, source, events, paused, basemap, queryErrors })
}

let store: ReturnType<typeof createUiStore> | null = null
export function useUiStore() {
  return (store ??= createUiStore())
}

/** Time window from the URL (?window=24h), ending now. Global state, shareable by link. */
export function useTimeWindow() {
  const route = useRoute()
  const router = useRouter()
  const ui = useUiStore()
  const key = computed<WindowKey>(() => {
    const q = route.query.window
    return typeof q === 'string' && q in WINDOWS ? (q as WindowKey) : '24h'
  })
  const to = computed(() => new Date(ui.now))
  const from = computed(() => new Date(ui.now - WINDOWS[key.value] * 1000))
  function set(k: WindowKey) {
    void router.replace({ query: { ...route.query, window: k === '24h' ? undefined : k } })
  }
  return { key, from, to, set }
}

import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { getDb } from '../db/client'
import { useUiStore } from '../stores/ui'

let nextQueryId = 0

/**
 * Run a query and re-run it when its SQL or params change, or when the data changes (ui.dataVersion,
 * bumped after ingest NOTIFYs). Works for metric functions, which PGlite live queries cannot track.
 * A data change also moves ui.now, so a windowed query re-runs once, with the new window.
 * Results are held in a shallowRef: never deep-reactive. SQL null: no query, and no rows.
 * A failure is also listed in ui.queryErrors (shown by the app) until the query next succeeds or is
 * disposed with its component.
 */
export function useQuery<Row, Out = Row>(
  sql: MaybeRefOrGetter<string | null>,
  params: MaybeRefOrGetter<unknown[]> = [],
  map?: (rows: Row[]) => Out[],
) {
  const ui = useUiStore()
  const queryId = nextQueryId++
  const rows = shallowRef<Out[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)
  let seq = 0

  function setError(message: string | null) {
    error.value = message
    if (message === null) ui.queryErrors.delete(queryId)
    else ui.queryErrors.set(queryId, message)
  }

  async function run() {
    const id = ++seq // also drops a run still in flight
    const text = toValue(sql)
    if (!text) {
      rows.value = []
      setError(null)
      loading.value = false
      return
    }
    try {
      const db = await getDb()
      const res = await db.query<Row>(text, toValue(params))
      if (id !== seq) return
      rows.value = map ? map(res.rows) : (res.rows as unknown as Out[])
      setError(null)
    } catch (e) {
      if (id === seq) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === seq) loading.value = false
    }
  }

  const key = computed(() => JSON.stringify([toValue(sql), toValue(params), ui.dataVersion]))
  watch(key, run, { immediate: true })
  if (getCurrentScope()) onScopeDispose(() => ui.queryErrors.delete(queryId))

  return { rows, loading, error, refresh: run }
}

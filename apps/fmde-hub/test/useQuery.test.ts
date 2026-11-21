// useQuery: rows cleared when the query is switched off, and failures listed in ui.queryErrors.
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

const query = vi.fn()
vi.mock('../src/db/client', () => ({
  getDb: async () => ({ query }),
  onDataChange: () => {},
  onHubEvent: () => {},
  sendControl: () => {},
}))
vi.mock('@fmde-hub/components', () => ({ mapboxBasemap: () => null })) // the store's only use; avoids the .vue files

const { useQuery } = await import('../src/composables/useQuery')
const { useUiStore } = await import('../src/stores/ui')

const settle = async () => {
  for (let i = 0; i < 5; i++) await nextTick()
}

describe('useQuery', () => {
  it('empties its rows when the SQL becomes null', async () => {
    query.mockResolvedValue({ rows: [{ v: 1 }] })
    const sql = ref<string | null>('select 1 as v')
    const scope = effectScope()
    const q = scope.run(() => useQuery<{ v: number }>(sql))!
    await settle()
    expect(q.rows.value).toEqual([{ v: 1 }])
    sql.value = null
    await settle()
    expect(q.rows.value).toEqual([])
    expect(q.loading.value).toBe(false)
    scope.stop()
  })

  it('lists a failure in ui.queryErrors until it succeeds, and drops it when disposed', async () => {
    const ui = useUiStore()
    query.mockRejectedValueOnce(new Error('relation "x" does not exist'))
    const scope = effectScope()
    const q = scope.run(() => useQuery('select * from x'))!
    await settle()
    expect(q.error.value).toBe('relation "x" does not exist')
    expect([...ui.queryErrors.values()]).toEqual(['relation "x" does not exist'])

    query.mockResolvedValueOnce({ rows: [] })
    await q.refresh()
    expect(q.error.value).toBeNull()
    expect(ui.queryErrors.size).toBe(0)

    query.mockRejectedValueOnce(new Error('again'))
    await q.refresh()
    expect(ui.queryErrors.size).toBe(1)
    scope.stop()
    expect(ui.queryErrors.size).toBe(0)
  })
})

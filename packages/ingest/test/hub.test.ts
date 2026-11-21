// The hub's control protocol over BroadcastChannel (available in Node), on an in-memory PGlite.
import { PGlite } from '@electric-sql/pglite'
import { migrate } from '@fmde-hub/db'
import { afterEach, expect, it, vi } from 'vitest'
import { CONTROL_CHANNEL, EVENT_CHANNEL, IngestHub, STATUS_THROTTLE_MS, type ControlMessage, type HubEvent } from '../src/hub'

// Each test starts a PGlite database (Postgres compiled to WebAssembly): 1–4 s, and more on a busy
// machine, against Vitest's 5 s default. Allow 30 s here; pure unit tests keep the default.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

let hub: IngestHub | null = null
const channels: BroadcastChannel[] = []

afterEach(async () => {
  await hub?.close()
  channels.splice(0).forEach((c) => c.close())
})

it('acks every control message with an id, and runs a re-sent one once', async () => {
  const db = await PGlite.create()
  await migrate(db)
  hub = new IngestHub(db)
  await hub.start()

  const control = new BroadcastChannel(CONTROL_CHANNEL)
  const events = new BroadcastChannel(EVENT_CHANNEL)
  channels.push(control, events)
  const received: HubEvent[] = []
  events.onmessage = (e: MessageEvent<HubEvent>) => received.push(e.data)

  const stop: ControlMessage = { type: 'stop', id: 'tab:0' }
  control.postMessage(stop)
  control.postMessage(stop) // e.g. re-sent after a leader change that this hub survived
  await expect.poll(() => received.filter((e) => e.type === 'status').length).toBe(1)
  await new Promise((r) => setTimeout(r, 200)) // a second run would publish another status

  expect(received.filter((e) => e.type === 'ack')).toEqual([
    { type: 'ack', id: 'tab:0' },
    { type: 'ack', id: 'tab:0' },
  ])
  expect(received.filter((e) => e.type === 'status')).toHaveLength(1)
  const stopped = await db.query(`select 1 from fmdehub_setting where key = 'sourceStopped'`)
  expect(stopped.rows).toHaveLength(1)
})

/** A started hub on a fresh database, with a listener on its events. */
async function startedHub() {
  const db = await PGlite.create()
  await migrate(db)
  hub = new IngestHub(db)
  await hub.start()
  const control = new BroadcastChannel(CONTROL_CHANNEL)
  const events = new BroadcastChannel(EVENT_CHANNEL)
  channels.push(control, events)
  const received: HubEvent[] = []
  events.onmessage = (e: MessageEvent<HubEvent>) => received.push(e.data)
  const statuses = () => received.flatMap((e) => (e.type === 'status' ? [e.status] : []))
  return { db, hub, control, statuses }
}

it('sends message counts at most once a second, and other status changes at once', async () => {
  const { hub, statuses } = await startedHub()
  for (let i = 1; i <= 50; i++) hub['setStatus']({ received: i, lastMessageAt: new Date().toISOString() })
  hub['setStatus']({ state: 'connected', detail: 'up' }) // sent at once, with the latest count
  await expect.poll(() => statuses().length).toBe(1)
  expect(statuses()[0]).toMatchObject({ state: 'connected', received: 50 })

  hub['setStatus']({ received: 51 })
  hub['setStatus']({ received: 52 })
  await new Promise((r) => setTimeout(r, STATUS_THROTTLE_MS + 300))
  expect(statuses().map((s) => s.received)).toEqual([50, 52])
})

it('clears the message counts on stop', async () => {
  const { hub, control, statuses } = await startedHub()
  hub['setStatus']({ source: 'mqtt', state: 'connected', received: 7, notStored: 2, lastMessageAt: new Date().toISOString() })
  control.postMessage({ type: 'stop' } satisfies ControlMessage)
  await expect.poll(() => statuses().at(-1)?.state).toBe('idle')
  expect(statuses().at(-1)).toMatchObject({ source: null, received: 0 })
  expect(statuses().at(-1)?.notStored).toBeUndefined()
  expect(statuses().at(-1)?.lastMessageAt).toBeUndefined()
})

it('writes monitored intervals in order: a close does not end the interval opened after it', async () => {
  const { db, hub } = await startedHub()
  // a reconnect's open fired before the previous close has written: not awaited, as in MqttSource's callbacks
  const writes = [hub['openInterval']('mqtt', false), hub['closeInterval'](), hub['openInterval']('mqtt', false)]
  await Promise.all(writes)
  expect(hub['intervalId']).not.toBeNull()
  const rows = await db.query(`select 1 from monitored_interval where source = 'mqtt'`)
  expect(rows.rows).toHaveLength(2)
})

it('answers every command with the error when ingest cannot start, without throwing', async () => {
  const db = await PGlite.create() // no migrations: the Ingestor's first query fails
  hub = new IngestHub(db)
  const control = new BroadcastChannel(CONTROL_CHANNEL)
  const events = new BroadcastChannel(EVENT_CHANNEL)
  channels.push(control, events)
  const received: HubEvent[] = []
  events.onmessage = (e: MessageEvent<HubEvent>) => received.push(e.data)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await expect(hub.start()).resolves.toBeUndefined()
  } finally {
    error.mockRestore()
  }

  control.postMessage({ type: 'start', id: 'tab:1', config: { kind: 'mqtt', mqtt: { url: 'wss://broker.example.org/mqtt' } } } satisfies ControlMessage)
  await expect.poll(() => received.some((e) => e.type === 'ack')).toBe(true)
  await expect.poll(() => received.filter((e) => e.type === 'status').length).toBeGreaterThanOrEqual(2)
  const last = received.filter((e) => e.type === 'status').at(-1)
  expect(last).toMatchObject({ status: { state: 'error', source: null, detail: expect.stringContaining('ingest could not start') } })
})

it('deletes what is stored for excluded groups when a source starts', async () => {
  const { db, control, statuses } = await startedHub()
  for (const key of ['wmo/a1', 'wmo/a2', 'test/b1']) {
    const [group, node] = key.split('/')
    await db.query(`insert into node (node_key, group_id, node_id, topic, first_seen_at) values ($1, $2, $3, $4, now())`, [key, group, node, `firstmile/a/${key}`])
    await db.query(
      `insert into observation (series_key, obs_time, node_key, param_key, metadata_version, definition_id, value_kind, is_empty, message_id, received_at)
       values ($1, now(), $1, 'p', 1, 1, 'num', false, 'm', now())`,
      [key],
    )
    await db.query(`insert into conformance_issue (received_at, topic, node_key, kind, code, detail) values (now(), $1, $2, 'data', 'X', '')`, [`firstmile/a/${key}`, key])
  }
  // an insecure URL is refused before connecting, after the deletion
  control.postMessage({ type: 'start', config: { kind: 'mqtt', mqtt: { url: 'ws://broker.example.org/mqtt', excludeGroups: ' wmo , other' } } } satisfies ControlMessage)
  await expect.poll(() => statuses().some((s) => s.detail?.includes('broker URL refused'))).toBe(true)

  for (const table of ['node', 'observation', 'conformance_issue']) {
    const left = await db.query<{ node_key: string }>(`select node_key from ${table}`)
    expect(left.rows.map((r) => r.node_key)).toEqual(['test/b1'])
  }
})

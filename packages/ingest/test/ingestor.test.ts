// Ingest into an in-memory PGlite with the real migrations.
import { PGlite } from '@electric-sql/pglite'
import { migrate, nodeStatus } from '@fmde-hub/db'
import { encodeMessage, encodePoc1 } from '@fmde-hub/fmde'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ingestor, type IncomingMessage } from '../src'

// Each test starts a PGlite database (Postgres compiled to WebAssembly): 1–4 s, and more on a busy
// machine, against Vitest's 5 s default. Allow 30 s here; pure unit tests keep the default.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const TOPIC = 'firstmile/a/test/node-1'
const NODE = 'test/node-1'
const DAY = 86_400_000

function metadata(name = 'Node 1'): Uint8Array {
  return encodeMessage({
    metadata: {
      node: { id: 'node-1', name },
      observers: [{ id: 1, name: 'sensor' }],
      parameterDefinitions: [
        { id: 1, description: 'temperature', parameters: [{ longName: 'air temperature', unit: 'Cel', device: { node: {} }, cellMethod: 'POINT', cellPeriodSeconds: 0 }] },
      ],
      namespaces: { cf: 'https://vocab.nerc.ac.uk/standard_name/' },
    },
  })
}

function data(at: Date, value = 21.5, seconds: string | number = Math.floor(at.getTime() / 1000)): Uint8Array {
  return encodeMessage({ data: { observations: [{ parameterDefinitionId: 1, time: { seconds }, values: [{ floatValue: value }] }] } })
}

const msg = (payload: Uint8Array, at: Date, retain = false): IncomingMessage => ({
  topic: TOPIC,
  payload,
  retain,
  receivedAt: at.toISOString(),
})

let db: PGlite
let ingestor: Ingestor

beforeEach(async () => {
  db = await PGlite.create()
  await migrate(db)
  ingestor = new Ingestor(db)
  await ingestor.init()
})

describe('Ingestor', () => {
  it('decodes data again after metadata is cleared and the same metadata republished', async () => {
    const t = Date.now() - 60_000
    await ingestor.ingest(msg(metadata(), new Date(t), true))
    await ingestor.ingest(msg(new Uint8Array(), new Date(t + 1000), true)) // retained metadata deleted
    const republished = await ingestor.ingest(msg(metadata(), new Date(t + 2000), true))
    expect(republished.newMetadataVersion).toBe(false)

    const ev = await ingestor.ingest(msg(data(new Date(t + 3000)), new Date(t + 3000)))
    expect(ev.issues.map((i) => i.code)).not.toContain('NO_METADATA')
    expect(ev.observations).toBe(1)
    const rows = await db.query(`select 1 from observation where node_key = $1`, [NODE])
    expect(rows.rows).toHaveLength(1)
  })

  it('checks the retain flag: metadata must be retained, data must not', async () => {
    const now = new Date()
    const codes = async (payload: Uint8Array, retain: boolean) => (await ingestor.ingest(msg(payload, now, retain))).issues.map((i) => i.code)
    expect(await codes(metadata(), true)).not.toContain('METADATA_NOT_RETAINED')
    expect(await codes(metadata('Renamed'), false)).toContain('METADATA_NOT_RETAINED')
    expect(await codes(data(now, 1), false)).not.toContain('DATA_RETAINED')
    expect(await codes(data(now, 2), true)).toContain('DATA_RETAINED')
  })

  it('stores a message with an out-of-range observation time and records MISSING_TIME', async () => {
    const now = new Date()
    await ingestor.ingest(msg(metadata(), now, true))
    const ev = await ingestor.ingest(msg(data(now, 1, '9223372036854775807'), now))
    expect(ev.issues.map((i) => i.code)).toContain('MISSING_TIME')
    const rows = await db.query(`select 1 from data_message where id = $1`, [ev.messageId])
    expect(rows.rows).toHaveLength(1)
  })
})

describe('a message that cannot be stored', () => {
  it('is reported in its event, not dropped silently, and the rest of the batch is stored', async () => {
    const now = new Date()
    await db.exec(`alter table observation rename to observation_unavailable`) // every data write now fails
    const [md, dt] = await ingestor.ingestBatch([msg(metadata(), now, true), msg(data(now), now)])

    expect(md?.notStored).toBeUndefined()
    expect((await db.query(`select 1 from metadata_version where node_key = $1`, [NODE])).rows).toHaveLength(1)

    expect(dt?.kind).toBe('data')
    expect(dt?.notStored).toMatch(/observation/)
    expect((await db.query(`select 1 from data_message`)).rows).toHaveLength(0)
  })
})

describe('the same series and time from two messages: the most recent wins', () => {
  const T = Math.floor(Date.now() / 1000) - 600 // observation time, 10 min ago
  const at = (offsetSeconds: number) => new Date((T + offsetSeconds) * 1000)
  /** A data message with observations of definition 1 (one parameter) at the given times. */
  const obs = (values: [time: number, value: number][]) =>
    encodeMessage({ data: { observations: values.map(([time, value]) => ({ parameterDefinitionId: 1, time: { seconds: time }, values: [{ doubleValue: value }] })) } })
  const stored = async () => (await db.query<{ value_num: number; message_id: string }>(`select value_num, message_id from observation where obs_time = $1`, [new Date(T * 1000)])).rows
  const codes = (e: { issues: { code: string }[] }) => e.issues.map((i) => i.code)

  beforeEach(async () => {
    await ingestor.ingest(msg(metadata(), at(-60), true))
  })

  it('replaces an earlier, different value and warns VALUE_REPLACED', async () => {
    await ingestor.ingest(msg(obs([[T, 20.0]]), at(10)))
    const later = await ingestor.ingest(msg(obs([[T, 21.5]]), at(20)))
    expect(codes(later)).toContain('VALUE_REPLACED')
    expect(await stored()).toEqual([{ value_num: 21.5, message_id: later.messageId }])
    // the warning is stored with the message, like its other issues
    const rows = await db.query<{ code: string }>(`select code from conformance_issue where message_id = $1`, [later.messageId])
    expect(rows.rows.map((r) => r.code)).toContain('VALUE_REPLACED')
  })

  it('keeps the stored observation when a later message repeats the same value', async () => {
    const first = await ingestor.ingest(msg(obs([[T, 20.0]]), at(10)))
    const resend = await ingestor.ingest(msg(obs([[T, 20.0], [T + 60, 20.5]]), at(70))) // regrouped, so a new message id
    expect(resend.duplicate).toBeUndefined()
    expect(codes(resend)).not.toContain('VALUE_REPLACED')
    expect(await stored()).toEqual([{ value_num: 20.0, message_id: first.messageId }])
  })

  it('never lets an older message overwrite a newer one (history replayed after live data)', async () => {
    const live = await ingestor.ingest(msg(obs([[T, 21.5]]), at(20)))
    const history = await ingestor.ingest(msg(obs([[T, 20.0]]), at(10)))
    expect(codes(history)).not.toContain('VALUE_REPLACED')
    expect(await stored()).toEqual([{ value_num: 21.5, message_id: live.messageId }])
  })

  it('stores the last of a time repeated within one message and warns DUPLICATE_OBSERVATION_TIME', async () => {
    const ev = await ingestor.ingest(msg(obs([[T, 20.0], [T, 21.5]]), at(10)))
    expect(ev.notStored).toBeUndefined()
    expect(codes(ev)).toContain('DUPLICATE_OBSERVATION_TIME')
    expect(codes(ev)).not.toContain('VALUE_REPLACED') // nothing stored earlier was replaced
    expect((await stored()).map((r) => r.value_num)).toEqual([21.5])
  })
})

describe('retained messages redelivered on reconnect', () => {
  it('reports an invalid retained message once, not once per reconnect', async () => {
    const now = new Date()
    const junk = new Uint8Array([0xff, 0xff, 0xff])
    const first = await ingestor.ingest(msg(junk, now, true))
    expect(first.issues.map((i) => i.code)).toContain('DECODE_ERROR')
    const again = await ingestor.ingest(msg(junk, new Date(now.getTime() + 60_000), true))
    expect(again.duplicate).toBe(true)
    expect(again.issues).toEqual([])
    const rows = await db.query(`select 1 from conformance_issue where code = 'DECODE_ERROR'`)
    expect(rows.rows).toHaveLength(1)
  })

  it('reports the same invalid payload each time when it is not retained', async () => {
    const now = new Date()
    const junk = new Uint8Array([0xff, 0xff, 0xff])
    await ingestor.ingest(msg(junk, now))
    const again = await ingestor.ingest(msg(junk, new Date(now.getTime() + 60_000)))
    expect(again.duplicate).toBeUndefined()
    expect(again.issues.map((i) => i.code)).toContain('DECODE_ERROR')
  })

  it('reports a retained message on a bad topic once', async () => {
    const at = (t: number): IncomingMessage => ({ topic: 'firstmile/a/too/many/levels', payload: metadata(), retain: true, receivedAt: new Date(t).toISOString() })
    await ingestor.ingest(at(Date.now()))
    expect((await ingestor.ingest(at(Date.now() + 60_000))).duplicate).toBe(true)
    const rows = await db.query(`select 1 from conformance_issue where code = 'BAD_TOPIC'`)
    expect(rows.rows).toHaveLength(1)
  })
})

describe('retention', () => {
  it('keeps the current metadata version issues, so the node stays NON_CONFORMANT', async () => {
    const now = new Date()
    const old = new Date(now.getTime() - 30 * DAY)
    await ingestor.ingest(msg(metadata(''), old, true)) // no node name: NODE_NO_NAME, an error
    await ingestor.ingest(msg(data(now), now))
    await ingestor.prune(now)

    const issues = await db.query<{ code: string }>(`select code from conformance_issue where node_key = $1`, [NODE])
    expect(issues.rows.map((r) => r.code)).toContain('NODE_NO_NAME')
    const [status] = await nodeStatus(db, new Date(now.getTime() - DAY), new Date(now.getTime() + 1000), new Date(now.getTime() + 1000))
    expect(status!.conformance).toBe('NON_CONFORMANT')
  })

  it('prunes issues of superseded metadata versions and old data', async () => {
    const now = new Date()
    await ingestor.ingest(msg(metadata(''), new Date(now.getTime() - 30 * DAY), true))
    await ingestor.ingest(msg(data(new Date(now.getTime() - 20 * DAY)), new Date(now.getTime() - 20 * DAY)))
    await ingestor.ingest(msg(metadata('Node 1'), new Date(now.getTime() - 10 * DAY), true)) // fixed: new version
    await ingestor.prune(now)

    const issues = await db.query<{ code: string }>(`select code from conformance_issue where node_key = $1`, [NODE])
    expect(issues.rows.map((r) => r.code)).not.toContain('NODE_NO_NAME')
    const msgs = await db.query(`select 1 from data_message`)
    expect(msgs.rows).toHaveLength(0)
  })

  it('treats retentionDays 0 as 1 day instead of deleting everything', async () => {
    const now = new Date()
    await ingestor.ingest(msg(metadata(), now, true))
    await ingestor.ingest(msg(data(new Date(now.getTime() - 3_600_000)), new Date(now.getTime() - 3_600_000)))
    await db.query(`update fmdehub_setting set value = '0' where key = 'retentionDays'`)
    await ingestor.prune(now)
    const msgs = await db.query(`select 1 from data_message`)
    expect(msgs.rows).toHaveLength(1)
  })
})

describe('POC1', () => {
  it('decodes legacy firstmile/poc1 metadata and data, with POC1 warnings', async () => {
    const now = new Date()
    const at = (topic: string, payload: Uint8Array, retain = false): IncomingMessage => ({ topic, payload, retain, receivedAt: now.toISOString() })
    const md = await ingestor.ingest(
      at(
        'firstmile/poc1/test/metadata/node-2',
        encodePoc1('metadata', {
          node: { id: 'node-2' },
          observers: [{ id: 1, name: 'sensor' }],
          parameterDefinitions: [{ id: 1, description: 'temperature', parameters: [{ longName: 'air temperature', unit: 'Cel', device: { node: {} }, cellMethod: 'POINT' }] }],
          namespaces: { cf: 'https://vocab.nerc.ac.uk/standard_name/' },
        }),
        true,
      ),
    )
    expect(md.profile).toBe('poc1')
    expect(md.issues.map((i) => i.code)).toContain('POC1_LEGACY_ENCODING')
    expect(md.issues.map((i) => i.code)).not.toContain('NODE_NO_NAME')

    const seconds = Math.floor(now.getTime() / 1000)
    const ev = await ingestor.ingest(
      at('firstmile/poc1/test/data/node-2', encodePoc1('data', { observations: [{ parameterDefinitionId: 1, time: { seconds }, values: [{ floatValue: 12.5 }] }] })),
    )
    expect(ev.nodeKey).toBe('test/node-2')
    expect(ev.observations).toBe(1)
    expect(ev.issues.map((i) => i.code)).not.toContain('NO_METADATA')
  })

  it('keeps the metadata when the retained message on the data topic is cleared', async () => {
    const now = new Date()
    const at = (topic: string, payload: Uint8Array, retain = false): IncomingMessage => ({ topic, payload, retain, receivedAt: now.toISOString() })
    const parameterDefinitions = [{ id: 1, description: 'temperature', parameters: [{ longName: 'air temperature', unit: 'Cel', device: { node: {} }, cellMethod: 'POINT' }] }]
    await ingestor.ingest(at('firstmile/poc1/test/metadata/node-3', encodePoc1('metadata', { node: { id: 'node-3' }, observers: [{ id: 1, name: 'sensor' }], parameterDefinitions, namespaces: {} }), true))

    const cleared = await ingestor.ingest(at('firstmile/poc1/test/data/node-3', new Uint8Array(), true))
    expect(cleared.kind).toBe('cleared')
    expect(cleared.issues.map((i) => i.code)).not.toContain('METADATA_CLEARED')

    const seconds = Math.floor(now.getTime() / 1000)
    const ev = await ingestor.ingest(at('firstmile/poc1/test/data/node-3', encodePoc1('data', { observations: [{ parameterDefinitionId: 1, time: { seconds }, values: [{ floatValue: 3 }] }] })))
    expect(ev.issues.map((i) => i.code)).not.toContain('NO_METADATA')
    expect(ev.observations).toBe(1)
  })

  it('clears the metadata when the retained message on the POC1 metadata topic is cleared', async () => {
    const now = new Date()
    const ev = await ingestor.ingest({ topic: 'firstmile/poc1/test/metadata/node-4', payload: new Uint8Array(), retain: true, receivedAt: now.toISOString() })
    expect(ev.issues.map((i) => i.code)).toContain('METADATA_CLEARED')
  })
})

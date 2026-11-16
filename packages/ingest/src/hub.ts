// The ingest hub: runs in the leader tab's worker only, next to PGlite.
// Tabs control it and receive its events over BroadcastChannels, so only one tab ever
// subscribes and writes.
import { CHANGE_CHANNEL, type Db } from '@fmde-hub/db'
import { Ingestor } from './ingestor'
import { MqttSource } from './mqtt'
import type { IncomingMessage, IngestEvent, SourceConfig, SourceStatus } from './types'

export const CONTROL_CHANNEL = 'fmde-hub-control'
export const EVENT_CHANNEL = 'fmde-hub-events'

export type ControlMessage = (
  | { type: 'start'; config: SourceConfig; /** keep in settings so a new leader resumes it */ persist?: boolean }
  | { type: 'stop' }
  | { type: 'status' }
  | { type: 'reset' }
) & {
  /** Set by tabs: the hub acks it on receipt, and the tab re-sends it to a new leader until then. */
  id?: string
}

export type HubEvent =
  | { type: 'status'; status: SourceStatus }
  | { type: 'ingested'; events: IngestEvent[] }
  /** Receipt of a control message with an id. */
  | { type: 'ack'; id: string }

const BATCH_DELAY_MS = 200
const BATCH_MAX = 500
const HEARTBEAT_MS = 30_000
const PRUNE_MS = 3_600_000
/** Message-count updates are sent to the tabs at most this often; every other status change at once. */
export const STATUS_THROTTLE_MS = 1000
/** Status fields that change on every message: throttled. */
const COUNTERS = new Set<keyof SourceStatus>(['received', 'lastMessageAt'])
export class IngestHub {
  private ingestor: Ingestor
  private source: MqttSource | null = null
  private status: SourceStatus = { source: null, state: 'idle', received: 0 }
  private queue: IncomingMessage[] = []
  private flushing: Promise<void> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private intervalId: number | null = null
  /** Interval writes run one at a time, in order: a close cannot finish after the next open. */
  private intervalChain: Promise<void> = Promise.resolve()
  private statusTimer: ReturnType<typeof setTimeout> | null = null
  private timers: ReturnType<typeof setInterval>[] = []
  /** Control messages run one at a time, in arrival order. */
  private controlChain: Promise<void> = Promise.resolve()
  /** Recent control message ids, so a message re-sent to this hub runs once. */
  private seen = new Set<string>()
  private control = new BroadcastChannel(CONTROL_CHANNEL)
  private events = new BroadcastChannel(EVENT_CHANNEL)
  /** Why ingest could not start; the database still serves the views. */
  private failed: string | null = null

  constructor(private readonly db: Db) {
    this.ingestor = new Ingestor(db)
  }

  /**
   * Never throws: if ingest cannot start, the hub answers every command with the error instead, so
   * the worker still returns the database and the views keep showing what is stored.
   */
  async start(): Promise<void> {
    // listen first, so the tabs' status polls are answered even if what follows fails
    this.control.onmessage = (e: MessageEvent<ControlMessage>) => this.receiveControl(e.data)
    let config: SourceConfig | undefined
    try {
      await this.ingestor.init()
      await this.ingestor.prune()
      const saved = await this.db.query<{ value: SourceConfig }>(`select value from fmdehub_setting where key = 'source'`)
      config = saved.rows[0]?.value
    } catch (e) {
      this.failed = `ingest could not start: ${e instanceof Error ? e.message : String(e)}`
      console.error(this.failed, e)
      this.setStatus({ source: null, state: 'error', detail: this.failed })
      return
    }
    this.timers.push(setInterval(() => void this.heartbeat(), HEARTBEAT_MS))
    this.timers.push(setInterval(() => void this.ingestor.prune().catch((e) => console.error('prune:', e)), PRUNE_MS))
    if (config?.kind === 'mqtt') {
      // resume through the control queue, so a command sent meanwhile waits for (or supersedes) it
      this.controlChain = this.controlChain.then(() => this.startSource(config)).catch((e) => this.setStatus({ state: 'error', detail: e instanceof Error ? e.message : String(e) }))
      await this.controlChain
    } else this.publishStatus()
  }

  private receiveControl(msg: ControlMessage) {
    if (msg.id) {
      this.events.postMessage({ type: 'ack', id: msg.id } satisfies HubEvent)
      if (this.seen.has(msg.id)) return
      this.seen.add(msg.id)
      if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value!)
    }
    if (msg.type === 'status' || this.failed) {
      // answered at once: tabs poll it until the hub is up. After a failed start, every command
      // gets the error back instead of running.
      this.publishStatus()
      return
    }
    this.controlChain = this.controlChain.then(() => this.onControl(msg))
  }

  private async onControl(msg: ControlMessage) {
    try {
      switch (msg.type) {
        case 'start':
          await this.db.query("delete from fmdehub_setting where key = 'sourceStopped'")
          if (msg.persist) {
            await this.db.query(
              `insert into fmdehub_setting (key, value) values ('source', $1::jsonb)
               on conflict (key) do update set value = excluded.value`,
              [JSON.stringify(msg.config)],
            )
          }
          await this.startSource(msg.config)
          break
        case 'stop':
          await this.db.query(`delete from fmdehub_setting where key = 'source'`)
          // remembered so a deployment's auto-connect does not override the user's choice
          await this.db.query("insert into fmdehub_setting (key, value) values ('sourceStopped', 'true') on conflict (key) do nothing")
          await this.stopSource()
          this.setStatus({ source: null, state: 'idle', detail: undefined, received: 0, notStored: undefined, lastMessageAt: undefined })
          break
        case 'reset':
          await this.stopSource()
          await this.db.exec(`truncate observation, data_message, conformance_issue, monitored_interval,
            parameter, observer_device, metadata_version, node`)
          this.ingestor = new Ingestor(this.db)
          await this.ingestor.init()
          await this.db.query(`select pg_notify($1, 'reset')`, [CHANGE_CHANNEL])
          this.setStatus({ source: null, state: 'idle', received: 0, detail: 'database cleared' })
          break
      }
    } catch (e) {
      this.setStatus({ state: 'error', detail: e instanceof Error ? e.message : String(e) })
    }
  }

  private async startSource(config: SourceConfig) {
    await this.stopSource()
    this.status = { source: 'mqtt', state: 'idle', received: 0 }
    const src = new MqttSource(config.mqtt)
    src.onConnect = (sessionPresent) => void this.openInterval('mqtt', sessionPresent).catch((e) => this.intervalFailed(e))
    src.onDisconnect = () => void this.closeInterval().catch((e) => this.intervalFailed(e))
    this.source = src
    await src.start((m) => this.enqueue(m), (s) => this.setStatus(s))
  }

  private async stopSource() {
    const s = this.source
    this.source = null
    if (s) await s.stop()
    await this.flush()
    await this.closeInterval()
  }

  private enqueue(m: IncomingMessage) {
    this.queue.push(m)
    if (this.queue.length >= BATCH_MAX) void this.flush()
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), BATCH_DELAY_MS)
  }

  /** Write everything queued. Resolves only once the queue is empty and written, even if a flush was already running. */
  private async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    while (this.flushing) await this.flushing
    if (this.queue.length === 0) return
    this.flushing = this.drain().finally(() => (this.flushing = null))
    await this.flushing
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, BATCH_MAX)
        const events = await this.ingestor.ingestBatch(batch)
        this.events.postMessage({ type: 'ingested', events } satisfies HubEvent)
        const notStored = events.filter((e) => e.notStored).length
        if (notStored > 0) this.setStatus({ notStored: (this.status.notStored ?? 0) + notStored })
      }
      await this.touchInterval()
    } catch (e) {
      this.setStatus({ state: 'error', detail: `ingest failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  // --- monitored intervals ---

  /** Run an interval write after the ones before it. A failed write does not block the next. */
  private serialInterval(task: () => Promise<void>): Promise<void> {
    const run = this.intervalChain.then(task)
    this.intervalChain = run.catch(() => {})
    return run
  }

  private intervalFailed(e: unknown) {
    console.error('monitored interval:', e)
  }

  private openInterval(source: string, sessionPresent: boolean): Promise<void> {
    return this.serialInterval(async () => {
      // A resumed persistent session means the broker queued messages while we were away:
      // treat the gap as monitored by extending the last interval.
      if (sessionPresent) {
        const last = await this.db.query<{ id: number }>(`select id from monitored_interval where source = $1 order by to_ts desc limit 1`, [source])
        if (last.rows[0]) {
          this.intervalId = Number(last.rows[0].id)
          await this.updateInterval()
          return
        }
      }
      const now = new Date()
      const res = await this.db.query<{ id: number }>(
        `insert into monitored_interval (source, from_ts, to_ts) values ($1, $2, $2) returning id`,
        [source, now],
      )
      this.intervalId = Number(res.rows[0]!.id)
    })
  }

  private touchInterval(): Promise<void> {
    return this.serialInterval(() => this.updateInterval())
  }

  private closeInterval(): Promise<void> {
    return this.serialInterval(async () => {
      await this.updateInterval()
      this.intervalId = null
    })
  }

  /** Only called inside serialInterval. */
  private async updateInterval() {
    if (this.intervalId === null) return
    await this.db.query(`update monitored_interval set to_ts = greatest(to_ts, $2) where id = $1`, [this.intervalId, new Date()])
  }

  private async heartbeat() {
    if (this.status.state === 'connected') await this.touchInterval().catch((e) => this.intervalFailed(e))
  }

  // --- status ---

  private setStatus(s: Partial<SourceStatus>) {
    this.status = { ...this.status, ...s }
    // MqttSource reports the message count on every message: send those at most once a second,
    // so a busy broker does not flood every tab. Anything else (state, detail, notStored) at once.
    const countersOnly = (Object.keys(s) as (keyof SourceStatus)[]).every((k) => COUNTERS.has(k))
    if (!countersOnly) this.publishStatus()
    else this.statusTimer ??= setTimeout(() => this.publishStatus(), STATUS_THROTTLE_MS)
  }

  /** Send the current status now (it includes the latest counts, so a pending throttled send is dropped). */
  private publishStatus() {
    if (this.statusTimer) clearTimeout(this.statusTimer)
    this.statusTimer = null
    this.events.postMessage({ type: 'status', status: this.status } satisfies HubEvent)
  }

  async close() {
    await this.stopSource()
    this.timers.forEach(clearInterval)
    if (this.statusTimer) clearTimeout(this.statusTimer)
    this.statusTimer = null
    this.control.close()
    this.events.close()
  }
}

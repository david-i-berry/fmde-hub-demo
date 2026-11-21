// Tab-side database access. Each open tab creates its own PGliteWorker (a Web Worker). The workers
// elect one leader with a Web Lock; only the leader opens PGlite and runs the ingest hub (the MQTT
// subscription). The other tabs' workers forward their queries to the leader. If the leader tab
// closes, another tab's worker takes over: this file re-sends hub commands that were not
// acknowledged, and refreshes the views, when that happens.
import { live } from '@electric-sql/pglite/live'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { CHANGE_CHANNEL } from '@fmde-hub/db'
import { CONTROL_CHANNEL, EVENT_CHANNEL, type ControlMessage, type HubEvent } from '@fmde-hub/ingest'
import FMDEhubWorker from './fmde-hub.worker.ts?worker'

export type Vfs = 'idb' | 'opfs-ahp' | 'memory'

const VFS_KEY = 'fmde-hub.vfs'

export const VFS_DATA_DIR: Record<Vfs, string> = {
  idb: 'idb://fmde-hub',
  'opfs-ahp': 'opfs-ahp://fmde-hub',
  memory: 'memory://',
}

/** OPFS access handle pool: Chromium and Firefox in a worker; not Safari. */
export function opfsAhpSupported(): boolean {
  const ua = navigator.userAgent
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)
  return !safari && typeof navigator.storage?.getDirectory === 'function'
}

/** The VFS chosen at start-up: ?memory in the URL, else the saved choice, else IndexedDB. */
export function currentVfs(): Vfs {
  if (new URLSearchParams(location.search).has('memory')) return 'memory'
  try {
    const saved = localStorage.getItem(VFS_KEY) as Vfs | null
    if (saved === 'opfs-ahp' && !opfsAhpSupported()) return 'idb'
    if (saved && Object.hasOwn(VFS_DATA_DIR, saved)) return saved
  } catch {
    // storage unavailable: fall through to the default
  }
  return 'idb'
}

/** Takes effect on reload. Each VFS is a separate database: use backup/restore to move data. */
export function setVfs(vfs: Vfs): void {
  try {
    localStorage.setItem(VFS_KEY, vfs)
  } catch {
    // ignore
  }
}

export type FMDEhubDb = Awaited<ReturnType<typeof createDb>>

async function createDb() {
  const vfs = currentVfs()
  const dataDir = VFS_DATA_DIR[vfs]
  return PGliteWorker.create(new FMDEhubWorker(), {
    id: `fmde-hub-${vfs}`,
    dataDir,
    meta: { dataDir },
    extensions: { live },
  })
}

let dbPromise: Promise<FMDEhubDb> | null = null

export function getDb(): Promise<FMDEhubDb> {
  dbPromise ??= createDb()
  return dbPromise
}

// --- change notifications: ingest NOTIFYs after each batch -------------------------------------
// The leader's worker LISTENs (packages/ingest/src/worker.ts) and forwards every notification to
// every tab, so a tab only filters them: no query, nothing to fail or to redo after a leader change.

const changeListeners = new Set<() => void>()
let watching: Promise<void> | null = null

function changed(): void {
  changeListeners.forEach((l) => l())
}

function watchDb(): void {
  watching ??= getDb().then(
    (db) => {
      db.onNotification((channel) => {
        if (channel === CHANGE_CHANNEL) changed()
      })
      db.onLeaderChange(() => {
        waitForHub()
        // notifications sent during the handover are lost: refresh once reconnected
        void db.waitReady.then(changed)
      })
    },
    (e: unknown) => {
      watching = null // try again on the next subscription
      console.error('FMDEhub: database unavailable', e)
    },
  )
}

/** Calls cb after each ingest batch or other data change. Returns the unsubscribe function. */
export function onDataChange(cb: () => void): () => void {
  changeListeners.add(cb)
  watchDb()
  return () => changeListeners.delete(cb)
}

// --- control of the leader's ingest hub ----------------------------------------------------------

const control = new BroadcastChannel(CONTROL_CHANNEL)
const events = new BroadcastChannel(EVENT_CHANNEL)

// Each command carries an id; the hub acks it on receipt. Commands are kept until acked and are
// (re-)sent, in order, whenever a hub is known to be listening. So a command is not lost while
// the leader starts up (PGlite opening and migrating), or when the leader tab closes and another
// tab's worker takes over.
const tabId = crypto.randomUUID()
let seq = 0
const unacked = new Map<string, ControlMessage>()
let hubUp = false
let poll: ReturnType<typeof setInterval> | null = null

/** No hub known (start-up or new leader): ask for its status until it answers. */
function waitForHub(): void {
  hubUp = false
  poll ??= setInterval(() => control.postMessage({ type: 'status' } satisfies ControlMessage), 500)
}

events.addEventListener('message', (e: MessageEvent<HubEvent>) => {
  if (e.data.type === 'ack') unacked.delete(e.data.id)
  if (hubUp) return
  // any event proves a hub is listening: stop asking, send what it has not acked
  hubUp = true
  if (poll) clearInterval(poll)
  poll = null
  unacked.forEach((m) => control.postMessage(m))
})
waitForHub()
watchDb()

export function sendControl(msg: ControlMessage): void {
  const id = `${tabId}:${seq++}`
  const withId = { ...msg, id }
  unacked.set(id, withId)
  if (hubUp) control.postMessage(withId)
}

export function onHubEvent(cb: (e: Exclude<HubEvent, { type: 'ack' }>) => void): () => void {
  const handler = (e: MessageEvent<HubEvent>) => {
    if (e.data.type !== 'ack') cb(e.data)
  }
  events.addEventListener('message', handler)
  return () => events.removeEventListener('message', handler)
}

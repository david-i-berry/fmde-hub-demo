// Worker entry for PGliteWorker: only the elected leader tab's worker runs init(), so PGlite
// and ingest exist exactly once per origin. Import from a Web Worker module:
//   import { runFMDEhubWorker } from '@fmde-hub/ingest/worker'; runFMDEhubWorker()
import { PGlite } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'
import { worker } from '@electric-sql/pglite/worker'
import { CHANGE_CHANNEL, migrate } from '@fmde-hub/db'
import { IngestHub } from './hub'

export interface FMDEhubWorkerMeta {
  /** idb://fmde-hub (default), opfs-ahp://fmde-hub, or memory:// */
  dataDir: string
}

export function runFMDEhubWorker(): void {
  void worker({
    async init(options) {
      const meta = (options.meta ?? {}) as Partial<FMDEhubWorkerMeta>
      const dataDir = meta.dataDir ?? 'idb://fmde-hub'
      // Durable writes: each write completes only once it is flushed to IndexedDB/OPFS. With relaxed
      // durability, writes in the last moments before a tab closed or reloaded were lost. Ingest batches
      // messages into one transaction (hub.ts), so the cost is one flush per batch.
      const db = await PGlite.create({ dataDir, relaxedDurability: false, extensions: { live } })
      await migrate(db)
      // Listen here, not in the tabs: the leader forwards every notification to every tab, and a new
      // leader's PGlite starts with no LISTENs, so a LISTEN made from a tab would end with its leader.
      await db.exec(`LISTEN ${CHANGE_CHANNEL}`)
      // never throws: a hub that cannot start reports it as its status, and the views still work
      await new IngestHub(db).start()
      return db
    },
  })
}

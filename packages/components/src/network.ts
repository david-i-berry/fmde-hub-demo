// Inputs shared by the topology graph and the map: one entry per node, in model types.
import type { MetadataVersion, NodeStatus, SeriesKey } from '@fmde-hub/fmde'

export interface NetworkNode {
  status: NodeStatus
  /** Current metadata version; null when none has been received. */
  metadata: MetadataVersion | null
  /** Latest battery voltage, when a battery parameter is identifiable (healthParameter). */
  battery?: { value: number; unit: string; time: string } | null
}

export interface NetworkExtras {
  /** emptyValue count per series in the window. */
  emptyBySeries?: Record<SeriesKey, number>
  /** Label of the broker (its host name). */
  brokerLabel?: string
}

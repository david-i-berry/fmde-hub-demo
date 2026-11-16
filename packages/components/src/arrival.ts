// How the arrival strip draws a data message. Kept apart from the component so it can be tested.

export interface ArrivalPoint {
  /** data_message.id: selections refer to it, not to a position that shifts as the window moves */
  id: string
  receivedAt: string
  /** received − newest observation time; null when the message has no decoded observation time */
  latencySeconds: number | null
  /** received − oldest observation time */
  spanSeconds: number | null
  observations: number
  payloadBytes: number
}

/**
 * - noTime: no decoded observation time (e.g. data before metadata, or every time missing)
 * - future: the newest observation is more than futureToleranceSeconds after its receipt (the node's
 *   clock is ahead); within the tolerance it counts as live, at the 1 s floor, as the hub's checks do
 * - backlog: the oldest observation is more than backlogSeconds old (a node catching up)
 * - live: everything else
 */
export type ArrivalKind = 'live' | 'backlog' | 'noTime' | 'future'

export function arrivalKind(m: ArrivalPoint, backlogSeconds: number, futureToleranceSeconds = 60): ArrivalKind {
  if (m.latencySeconds === null) return 'noTime'
  if (m.latencySeconds < -futureToleranceSeconds) return 'future'
  return (m.spanSeconds ?? 0) > backlogSeconds ? 'backlog' : 'live'
}

/** The height on the log axis (from 1 s): latency, or the 1 s floor for messages without one. */
export function arrivalHeight(m: ArrivalPoint): number {
  return m.latencySeconds !== null && m.latencySeconds > 1 ? m.latencySeconds : 1
}

import type { ConformanceIssue, NodeKey } from '@fmde-hub/fmde'

/** One message as received from the broker. */
export interface IncomingMessage {
  topic: string
  payload: Uint8Array
  /**
   * MQTT retain flag as the publisher set it: MqttSource subscribes with MQTT 5 Retain As Published
   * (a broker otherwise clears it on live delivery).
   */
  retain: boolean
  receivedAt: string
}

/** Summary of one ingested message, broadcast to every tab for the message inspector. */
export interface IngestEvent {
  receivedAt: string
  topic: string
  nodeKey: NodeKey | null
  kind: 'metadata' | 'data' | 'cleared' | 'unknown'
  /** topic hierarchy: firstmile/a, or the legacy POC1 */
  profile?: 'a' | 'poc1'
  messageId: string | null
  payloadBytes: number
  retain: boolean
  /** Data: observation count. Metadata: version (new or unchanged). */
  observations?: number
  metadataVersion?: number | null
  newMetadataVersion?: boolean
  /** Already stored (data), or an invalid retained message redelivered by the broker: skipped. */
  duplicate?: boolean
  /** Set when the message could not be stored (a fault in the hub, not the node): nothing of it is in the database. */
  notStored?: string
  issues: ConformanceIssue[]
}

export type SourceState = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

export interface SourceStatus {
  source: 'mqtt' | null
  state: SourceState
  detail?: string
  received: number
  lastMessageAt?: string
  /** Messages received but not stored since the source started (see IngestEvent.notStored). */
  notStored?: number
}

export interface MqttSourceConfig {
  /** wss://host:port/path */
  url: string
  username?: string
  password?: string
  /** Stable client id: required for a persistent session to resume after reconnect. */
  clientId?: string
  /** Topic filter(s), comma-separated; defaults to firstmile/a/# and firstmile/poc1/# */
  topic?: string
  /**
   * Groups to ignore, comma-separated (the <group> level of firstmile/a/<group>/<node> and POC1 topics);
   * defaults to `wmo`, and '' excludes nothing.
   * MQTT filters cannot exclude, so their messages are dropped on arrival and what is stored is deleted.
   */
  excludeGroups?: string
  /** MQTT 5 with a session expiry so QoS 1 messages queue while no tab is open. */
  persistentSessionSeconds?: number
}

/** The saved source (fmdehub_setting 'source'). */
export type SourceConfig = { kind: 'mqtt'; mqtt: MqttSourceConfig }

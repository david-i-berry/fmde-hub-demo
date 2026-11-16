// FMDEhub's own domain model: the normalised form of FMDE messages plus what the hub adds
// (keys, metadata versions, conformance, node state). FMDE's own message shapes and
// enumerations are in fmde.ts.
// Components and stores work against these types, never against raw protobuf or a hub API.
import type { CellMethod, ReferenceSurface, ValueKind } from './fmde'

/** `${group}/${nodeId}`, derived from the topic. */
export type NodeKey = string

/**
 * Positional key of one parameter within one metadata version:
 * `${nodeKey}/${definitionId}/${valueIndex}`.
 * Its meaning can change between metadata versions (values are positional), so it is
 * always paired with `metadataVersion`. Use `SeriesKey` to follow a quantity over time.
 */
export type ParamKey = string

/**
 * Stable identity of a measured quantity across metadata versions:
 * `${nodeKey}|${device}|${longName}|${cellMethod}|${cellPeriodSeconds}`.
 * Survives parameter reordering and definition renumbering; time series are keyed by it.
 */
export type SeriesKey = string

export interface Location {
  latitude?: number
  longitude?: number
  heightMetres: number
  referenceSurface: ReferenceSurface
}

export interface NodeRecord {
  key: NodeKey
  group: string
  nodeId: string
  topic: string
  /** Node.id from the metadata message; should equal nodeId (NODE_ID_MISMATCH otherwise). */
  declaredId?: string
  name: string
  serialNumber?: string
  firmwareVersion?: string
  url?: string
  location?: Location
  /** Hub-assigned; increments only when the metadata content changes. Null until metadata is seen. */
  metadataVersion: number | null
  metadataReceivedAt: string | null
  firstSeenAt: string
  hubConfig: NodeHubConfig
}

export interface ObserverDevice {
  nodeKey: NodeKey
  metadataVersion: number
  id: number
  name: string
  serialNumber?: string
  firmwareVersion?: string
  url?: string
  location?: Location
}

export type DeviceTarget = { kind: 'node' } | { kind: 'observer'; observerId: number } | { kind: 'unspecified' }

export interface Parameter {
  key: ParamKey
  seriesKey: SeriesKey
  nodeKey: NodeKey
  metadataVersion: number
  definitionId: number
  definitionDescription: string
  valueIndex: number
  longName: string
  unit: string
  /** prefix -> name; resolve the prefix via the metadata namespaces. */
  standardNames: Record<string, string>
  device: DeviceTarget
  cellMethod: CellMethod
  cellPeriodSeconds: number
}

export interface MetadataVersion {
  nodeKey: NodeKey
  version: number
  receivedAt: string
  contentHash: string
  node: Omit<NodeRecord, 'metadataVersion' | 'metadataReceivedAt' | 'firstSeenAt' | 'hubConfig'>
  observers: ObserverDevice[]
  parameters: Parameter[]
  namespaces: Record<string, string>
  rawBytes: number
}

/** null = emptyValue */
export type ObsValue = number | string | boolean | null

export interface Observation {
  seriesKey: SeriesKey
  paramKey: ParamKey
  nodeKey: NodeKey
  definitionId: number
  time: string
  value: ObsValue
  kind: ValueKind
  /** Exact decimal text for 64-bit integers, which may exceed Number precision. */
  exact?: string
  messageId: string
  metadataVersion: number
  receivedAt: string
}

export interface DataMessageLog {
  id: string
  nodeKey: NodeKey
  topic: string
  receivedAt: string
  firstObsTime: string | null
  lastObsTime: string | null
  observations: number
  values: number
  emptyValues: number
  /** receivedAt - lastObsTime: delivery delay of the newest observation in the message. */
  latencySeconds: number | null
  /** receivedAt - firstObsTime: how far back the message reaches (store-and-forward backlog). */
  spanSeconds: number | null
  payloadBytes: number
  metadataVersion: number | null
  conformance: ConformanceIssue[]
}

/** Every conformance code; see CODE_INFO in ats.ts for its ATS test, requirement and severity. */
export const CONFORMANCE_CODES = [
  // FMDE abstract test suite: message encoding
  'DECODE_ERROR', 'EMPTY_MESSAGE', 'LOCATION_NO_REFERENCE_SURFACE', 'REFERENCE_SURFACE_UNKNOWN',
  'METADATA_NO_NODE', 'METADATA_NO_OBSERVERS', 'METADATA_NO_DEFINITIONS', 'METADATA_NO_NAMESPACES',
  'NODE_NO_NAME', 'OBSERVER_NO_NAME', 'DUPLICATE_OBSERVER_ID',
  'DEFINITION_NO_DESCRIPTION', 'DEFINITION_NO_PARAMETERS', 'DUPLICATE_DEFINITION_ID',
  'PARAMETER_NO_LONG_NAME', 'UNIT_NOT_IN_CODELIST', 'CELL_METHOD_UNSPECIFIED', 'CELL_METHOD_UNKNOWN', 'CELL_PERIOD_INCONSISTENT',
  'DEVICE_REF_MISSING', 'UNKNOWN_OBSERVER',
  'DATA_NO_OBSERVATIONS', 'OBSERVATION_NO_VALUES', 'MISSING_TIME', 'VALUE_NOT_SET',
  // parameter standard names
  'UNKNOWN_NAMESPACE', 'NAMESPACE_PREFIX_INVALID',
  // transmission
  'TOPIC_CONVENTIONS', 'GROUP_NODE_ID_INVALID',
  // hub checks (requirements without an ATS test, and heuristics)
  'BAD_TOPIC', 'NO_METADATA', 'METADATA_NOT_RETAINED', 'DATA_RETAINED', 'UNKNOWN_DEFINITION',
  'VALUE_COUNT_MISMATCH', 'TIME_IN_FUTURE', 'VALUE_REPLACED', 'DUPLICATE_OBSERVATION_TIME', 'NODE_ID_MISMATCH', 'METADATA_CLEARED', 'CF_NAMESPACE_URI',
  // legacy POC1 hierarchy (poc1.ts)
  'POC1_LEGACY_ENCODING', 'POC1_TOPIC_LEVEL',
] as const
export type ConformanceCode = (typeof CONFORMANCE_CODES)[number]

export interface ConformanceIssue {
  code: ConformanceCode
  detail: string
}

/**
 * Hub-side settings FMDE does not carry. Expected reporting frequency
 * is deliberately absent for now: availability and timeliness are deferred.
 */
export interface NodeHubConfig {
  wigosId?: string
  /** Parameters (long name or series key) whose empty values are expected and do not degrade the node. */
  expectedEmpty?: string[]
  /** Override the global last-seen thresholds for this node. */
  lateAfterSeconds?: number
  silentAfterSeconds?: number
  /** Node-health parameters by series key, where the heuristic in health.ts does not find them. */
  healthParamMap?: {
    batteryVoltage?: SeriesKey
    solarVoltage?: SeriesKey
    loggerTemperature?: SeriesKey
  }
}

/** Operational state: is the node working? (conformance is separate) */
export const NODE_STATES = ['NO_METADATA', 'NEVER_SEEN', 'SILENT', 'LATE', 'DEGRADED', 'OK'] as const
export type NodeState = (typeof NODE_STATES)[number]

/** Does the node meet FMDE? Current metadata version plus data messages in the window. */
export const CONFORMANCE_LEVELS = ['NON_CONFORMANT', 'WARNINGS', 'CONFORMANT'] as const
export type Conformance = (typeof CONFORMANCE_LEVELS)[number]

/** One row of the fmdehub_node_status() SQL function (packages/db). */
export interface NodeStatus {
  nodeKey: NodeKey
  group: string
  nodeId: string
  name: string | null
  state: NodeState
  conformance: Conformance
  metadataVersion: number | null
  firstSeenAt: string
  lastSeenAt: string | null
  lastSeenAgeSeconds: number | null
  messages: number
  observations: number
  /** emptyValue count in the window, excluding parameters in hubConfig.expectedEmpty */
  emptyValues: number
  expectedEmptyValues: number
  /** data that could not be decoded or stored in the window: one per message and cause (DECODE_ERROR, NO_METADATA, UNKNOWN_DEFINITION, VALUE_COUNT_MISMATCH, MISSING_TIME) */
  lostData: number
  conformanceErrors: number
  conformanceWarnings: number
  medianLatencySeconds: number | null
  maxSpanSeconds: number | null
}

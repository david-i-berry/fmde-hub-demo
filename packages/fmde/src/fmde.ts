// Types defined by the FMDE standard (wmo-im/fmde, message_encoding.proto): the enumerations it
// specifies and the shape of a FirstMileMessage as decoded by proto.ts.
// FMDEhub's own model, which these are normalised into, is in model.ts.

// --- Enumerations ---

export const REFERENCE_SURFACES = ['UNSPECIFIED', 'MSL', 'GEOID', 'GL', 'REFERENCE_ELLIPSOID', 'PRESSURE_1000_HPA'] as const
export type ReferenceSurface = (typeof REFERENCE_SURFACES)[number]

export const CELL_METHODS = [
  'UNSPECIFIED', 'POINT', 'SUM', 'MAXIMUM', 'MAXIMUM_ABSOLUTE_VALUE', 'MEDIAN', 'MID_RANGE', 'MINIMUM',
  'MINIMUM_ABSOLUTE_VALUE', 'MEAN', 'MEAN_ABSOLUTE_VALUE', 'MEAN_OF_UPPER_DECILE', 'MODE', 'RANGE',
  'ROOT_MEAN_SQUARE', 'STANDARD_DEVIATION', 'SUM_OF_SQUARES', 'VARIANCE',
] as const
export type CellMethod = (typeof CELL_METHODS)[number]

/** True if a decoded enum field holds one of `names` (an undefined value decodes as a number). */
export function isEnumName<T extends string>(names: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (names as readonly string[]).includes(value)
}

/** The protobuf `Value` oneof case, kept for the inspector. */
export type ValueKind =
  | 'floatValue' | 'doubleValue' | 'int32Value' | 'uint32Value' | 'int64Value' | 'uint64Value'
  | 'stringValue' | 'boolValue' | 'emptyValue'

// --- Decoded messages ---

// Shapes produced by decodeMessage() in proto.ts (protobufjs toObject). Fields at their proto3 default
// are omitted, so everything is optional; 64-bit integers are decimal strings. Enum fields are names,
// except a value the schema does not define (e.g. from a newer FMDE version), which stays a number.

export interface RawTimestamp { seconds?: string; nanos?: number }

export interface RawLocation {
  latitude?: number
  longitude?: number
  heightMetres?: number
  referenceSurface?: string | number
}

export interface RawNode {
  id?: string
  name?: string
  location?: RawLocation
  url?: string
  serialNumber?: string
  firmwareVersion?: string
}

export interface RawObserverDevice extends Omit<RawNode, 'id'> { id?: number }

export interface RawDeviceRef { node?: object; observerId?: number; target?: 'node' | 'observerId' }

export interface RawParameter {
  longName?: string
  unit?: string
  standardNames?: Record<string, string>
  device?: RawDeviceRef
  cellMethod?: string | number
  cellPeriodSeconds?: number
}

export interface RawParameterDefinition { id?: number; description?: string; parameters?: RawParameter[] }

export interface RawMetadata {
  node?: RawNode
  observers?: RawObserverDevice[]
  parameterDefinitions?: RawParameterDefinition[]
  namespaces?: Record<string, string>
}

export interface RawValue {
  kind?: string
  floatValue?: number
  doubleValue?: number
  int32Value?: number
  uint32Value?: number
  int64Value?: string
  uint64Value?: string
  stringValue?: string
  boolValue?: boolean
  emptyValue?: object
}

export interface RawObservation { parameterDefinitionId?: number; time?: RawTimestamp; values?: RawValue[] }

export interface RawData { observations?: RawObservation[] }

export interface RawFirstMileMessage {
  content?: 'metadata' | 'data'
  metadata?: RawMetadata
  data?: RawData
}

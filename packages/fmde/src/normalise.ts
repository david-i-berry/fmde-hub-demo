// Raw FMDE protobuf objects -> normalised model, with conformance checks.
import {
  CELL_METHODS,
  REFERENCE_SURFACES,
  type CellMethod,
  type RawData,
  type RawLocation,
  type RawMetadata,
  type RawValue,
  type ValueKind,
  isEnumName,
} from './fmde'
import { timestampToIso } from './proto'
import type {
  ConformanceIssue,
  DeviceTarget,
  Location,
  MetadataVersion,
  NodeKey,
  Observation,
  ObsValue,
  Parameter,
} from './model'

/** JSON with sorted object keys, so equal content always serialises identically (used for content hashing). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function location(raw: RawLocation | undefined): Location | undefined {
  if (!raw) return undefined
  const surface = raw.referenceSurface
  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    heightMetres: raw.heightMetres ?? 0,
    // unknown values (numbers) and the unspecified default normalise to 'UNSPECIFIED'; ats.ts reports them
    referenceSurface: isEnumName(REFERENCE_SURFACES, surface) ? surface : 'UNSPECIFIED',
  }
}

function cellMethod(raw: string | number | undefined): CellMethod {
  return isEnumName(CELL_METHODS, raw) ? raw : 'UNSPECIFIED'
}

export function deviceLabel(d: DeviceTarget): string {
  return d.kind === 'observer' ? `obs${d.observerId}` : d.kind
}

/**
 * Parameters the metadata does not tell apart (same device, long name, cell method and period) would
 * share a series key. Give every one of them a positional key instead (suffix #d<definition>v<index>),
 * so which is which never depends on their order in the metadata. Declaring each sensor as an
 * observer device gives them distinct, stable keys.
 */
function disambiguateSeries(parameters: Parameter[]): void {
  const count = new Map<string, number>()
  for (const p of parameters) count.set(p.seriesKey, (count.get(p.seriesKey) ?? 0) + 1)
  for (const p of parameters) {
    if (count.get(p.seriesKey)! > 1) p.seriesKey += `#d${p.definitionId}v${p.valueIndex}`
  }
}

export interface MetadataContext {
  nodeKey: NodeKey
  group: string
  nodeId: string
  topic: string
  version: number
  receivedAt: string
  contentHash: string
  rawBytes: number
}

export function normaliseMetadata(raw: RawMetadata, ctx: MetadataContext): { metadata: MetadataVersion; issues: ConformanceIssue[] } {
  const issues: ConformanceIssue[] = []
  const n = raw.node ?? {}
  const namespaces = { ...(raw.namespaces ?? {}) }

  if (n.id && n.id !== ctx.nodeId) {
    issues.push({ code: 'NODE_ID_MISMATCH', detail: `Node.id "${n.id}" differs from topic node "${ctx.nodeId}"` })
  }

  const observers = (raw.observers ?? []).map((o) => ({
    nodeKey: ctx.nodeKey,
    metadataVersion: ctx.version,
    id: o.id ?? 0,
    name: o.name ?? '',
    serialNumber: o.serialNumber,
    firmwareVersion: o.firmwareVersion,
    url: o.url,
    location: location(o.location),
  }))
  const observerIds = new Set(observers.map((o) => o.id))

  const parameters: Parameter[] = []
  const seenDefinitions = new Set<number>()
  const unknownPrefixes = new Set<string>()

  for (const def of raw.parameterDefinitions ?? []) {
    const definitionId = def.id ?? 0
    if (seenDefinitions.has(definitionId)) {
      issues.push({ code: 'DUPLICATE_DEFINITION_ID', detail: `parameterDefinition id ${definitionId} appears more than once` })
      continue
    }
    seenDefinitions.add(definitionId)

    ;(def.parameters ?? []).forEach((p, valueIndex) => {
      const device: DeviceTarget =
        p.device?.observerId !== undefined
          ? { kind: 'observer', observerId: p.device.observerId }
          : p.device?.node !== undefined
            ? { kind: 'node' }
            : { kind: 'unspecified' }
      if (device.kind === 'observer' && !observerIds.has(device.observerId)) {
        issues.push({ code: 'UNKNOWN_OBSERVER', detail: `definition ${definitionId}[${valueIndex}] references observer ${device.observerId}` })
      }
      const standardNames = { ...(p.standardNames ?? {}) }
      for (const prefix of Object.keys(standardNames)) {
        // own keys only: `in` would also find inherited names such as "toString" or "constructor"
        if (!Object.hasOwn(namespaces, prefix)) unknownPrefixes.add(prefix)
      }

      const method = cellMethod(p.cellMethod)
      const period = p.cellPeriodSeconds ?? 0
      const longName = p.longName ?? ''
      const seriesKey = [ctx.nodeKey, deviceLabel(device), longName, method, period].join('|')

      parameters.push({
        key: `${ctx.nodeKey}/${definitionId}/${valueIndex}`,
        seriesKey,
        nodeKey: ctx.nodeKey,
        metadataVersion: ctx.version,
        definitionId,
        definitionDescription: def.description ?? '',
        valueIndex,
        longName,
        unit: p.unit ?? '',
        standardNames,
        device,
        cellMethod: method,
        cellPeriodSeconds: period,
      })
    })
  }

  disambiguateSeries(parameters)

  for (const prefix of unknownPrefixes) {
    issues.push({ code: 'UNKNOWN_NAMESPACE', detail: `standardNames prefix "${prefix}" has no entry in namespaces` })
  }

  return {
    metadata: {
      nodeKey: ctx.nodeKey,
      version: ctx.version,
      receivedAt: ctx.receivedAt,
      contentHash: ctx.contentHash,
      node: {
        key: ctx.nodeKey,
        group: ctx.group,
        nodeId: ctx.nodeId,
        topic: ctx.topic,
        declaredId: n.id || undefined,
        name: n.name ?? '',
        serialNumber: n.serialNumber,
        firmwareVersion: n.firmwareVersion,
        url: n.url,
        location: location(n.location),
      },
      observers,
      parameters,
      namespaces,
      rawBytes: ctx.rawBytes,
    },
    issues,
  }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * The shortest decimal that is the same 32-bit float. A floatValue decodes to the float's exact
 * 64-bit value (18.6 -> 18.600000381469727); this returns 18.6, as the node meant. 9 significant
 * digits always suffice for a 32-bit float.
 */
export function shortestFloat32(f: number): number {
  if (!Number.isFinite(f) || f === 0) return f
  for (let digits = 1; digits < 9; digits++) {
    const d = Number(f.toPrecision(digits))
    if (Math.fround(d) === f) return d
  }
  return Number(f.toPrecision(9))
}

export function convertValue(v: RawValue): { value: ObsValue; kind: ValueKind; exact?: string } {
  const kind = (v.kind ?? 'emptyValue') as ValueKind
  switch (kind) {
    case 'floatValue':
      return { value: shortestFloat32(v.floatValue ?? 0), kind }
    case 'doubleValue':
    case 'int32Value':
    case 'uint32Value':
      return { value: v[kind] ?? 0, kind }
    case 'int64Value':
    case 'uint64Value': {
      const s = v[kind] ?? '0'
      const big = BigInt(s)
      const unsafe = big > MAX_SAFE || big < -MAX_SAFE
      return { value: Number(s), kind, exact: unsafe ? s : undefined }
    }
    case 'stringValue':
      return { value: v.stringValue ?? '', kind }
    case 'boolValue':
      return { value: v.boolValue ?? false, kind }
    default:
      // emptyValue, or a Value with no member set: no value for that slot
      return { value: null, kind: 'emptyValue' }
  }
}

export interface DataContext {
  nodeKey: NodeKey
  messageId: string
  receivedAt: string
  /** Metadata in force at receipt; null if none is known. */
  metadata: MetadataVersion | null
  /** Clock tolerance for TIME_IN_FUTURE. */
  futureToleranceSeconds?: number
}

export interface DecodedData {
  observations: Observation[]
  issues: ConformanceIssue[]
  firstObsTime: string | null
  lastObsTime: string | null
  observationCount: number
  valueCount: number
  emptyValueCount: number
}

/** "0, 3, 7" — at most 10 items, then "… (n more)", so one bad message cannot produce a huge detail. */
function list(items: (number | string)[]): string {
  const shown = items.slice(0, 10).join(', ')
  return items.length > 10 ? `${shown}, … (${items.length - 10} more)` : shown
}

/**
 * Decode a data message against the metadata in force at receipt (positional values).
 * Without metadata, nothing is decoded (NO_METADATA); counts and times are still reported.
 */
export function decodeData(raw: RawData, ctx: DataContext): DecodedData {
  const issues: ConformanceIssue[] = []
  const observations: Observation[] = []
  const rawObs = raw.observations ?? []
  if (rawObs.length === 0) issues.push({ code: 'DATA_NO_OBSERVATIONS', detail: 'data message has no observations' })
  const tolerance = (ctx.futureToleranceSeconds ?? 60) * 1000
  const receivedMs = Date.parse(ctx.receivedAt)

  let first: number | null = null
  let last: number | null = null
  let valueCount = 0
  let emptyValueCount = 0
  let futureCount = 0
  let noValues = 0
  let unset = 0
  const noTime: number[] = []
  const outOfRange: number[] = []
  const countMismatch: string[] = []
  const unknownDefs = new Set<number>()

  const defs = new Map<number, Parameter[]>()
  for (const p of ctx.metadata?.parameters ?? []) {
    const list = defs.get(p.definitionId) ?? []
    list[p.valueIndex] = p
    defs.set(p.definitionId, list)
  }
  if (!ctx.metadata) issues.push({ code: 'NO_METADATA', detail: 'data received with no metadata known for this node' })

  rawObs.forEach((o, i) => {
    const time = timestampToIso(o.time)
    const values = o.values ?? []
    if (values.length === 0) noValues++
    // a Value with no type set is an encoding error (VALUE_NOT_SET), not an empty value from the sensor
    unset += values.filter((v) => v.kind === undefined).length
    valueCount += values.length
    emptyValueCount += values.filter((v) => v.kind === 'emptyValue').length
    if (!time) {
      ;(o.time ? outOfRange : noTime).push(i)
      return
    }
    const ms = Date.parse(time)
    first = first === null ? ms : Math.min(first, ms)
    last = last === null ? ms : Math.max(last, ms)
    if (ms - receivedMs > tolerance) futureCount++

    if (!ctx.metadata) return
    const definitionId = o.parameterDefinitionId ?? 0
    const params = defs.get(definitionId)
    if (!params) {
      unknownDefs.add(definitionId)
      return
    }
    if (values.length !== params.length) {
      countMismatch.push(`${i} (definition ${definitionId}: ${values.length} values for ${params.length} parameters)`)
      return
    }
    values.forEach((v, idx) => {
      if (v.kind === undefined) return // VALUE_NOT_SET: nothing to store
      const p = params[idx]!
      const { value, kind, exact } = convertValue(v)
      observations.push({
        seriesKey: p.seriesKey,
        paramKey: p.key,
        nodeKey: ctx.nodeKey,
        definitionId,
        time,
        value,
        kind,
        exact,
        messageId: ctx.messageId,
        metadataVersion: ctx.metadata!.version,
        receivedAt: ctx.receivedAt,
      })
    })
  })

  // one issue per cause per message, listing the observations it affects
  if (noTime.length > 0) issues.push({ code: 'MISSING_TIME', detail: `${noTime.length} observation(s) with no time: ${list(noTime)}` })
  if (outOfRange.length > 0) {
    issues.push({ code: 'MISSING_TIME', detail: `${outOfRange.length} observation(s) with a time outside years 0001-9999: ${list(outOfRange)}` })
  }
  if (countMismatch.length > 0) {
    issues.push({ code: 'VALUE_COUNT_MISMATCH', detail: `${countMismatch.length} observation(s) with the wrong number of values: ${list(countMismatch)}` })
  }
  for (const id of unknownDefs) {
    issues.push({ code: 'UNKNOWN_DEFINITION', detail: `parameterDefinitionId ${id} is not in metadata version ${ctx.metadata?.version}` })
  }
  if (noValues > 0) issues.push({ code: 'OBSERVATION_NO_VALUES', detail: `${noValues} observation(s) with no values` })
  if (unset > 0) issues.push({ code: 'VALUE_NOT_SET', detail: `${unset} value(s) set no type; use emptyValue for missing data` })
  if (futureCount > 0) {
    issues.push({ code: 'TIME_IN_FUTURE', detail: `${futureCount} observation(s) later than receipt time` })
  }

  return {
    observations,
    issues,
    firstObsTime: first === null ? null : new Date(first).toISOString(),
    lastObsTime: last === null ? null : new Date(last).toISOString(),
    observationCount: rawObs.length,
    valueCount,
    emptyValueCount,
  }
}

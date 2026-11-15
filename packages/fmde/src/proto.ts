// FMDE protobuf encode/decode. generated/fmde.json is the protobufjs JSON descriptor of the FMDE schema
// (vendor/fmde, from wmo-im/fmde); regenerate it with `npm run generate:fmde -w packages/fmde`.
import protobuf from 'protobufjs/light.js'
import descriptor from './generated/fmde.json'
import type { RawFirstMileMessage, RawTimestamp } from './fmde'

export const FMDE_PACKAGE = 'int.wmo.wis.spec.fmde.v1.conf.message_encoding'

const root = protobuf.Root.fromJSON(descriptor as protobuf.INamespace)
const FirstMileMessageType = root.lookupType(`${FMDE_PACKAGE}.FirstMileMessage`)

const TO_OBJECT: protobuf.IConversionOptions = {
  longs: String,
  enums: String,
  defaults: false,
  oneofs: true,
}

/** Decode a FirstMileMessage. Throws on malformed input. */
export function decodeMessage(bytes: Uint8Array): RawFirstMileMessage {
  const msg = FirstMileMessageType.decode(bytes)
  return FirstMileMessageType.toObject(msg, TO_OBJECT) as RawFirstMileMessage
}

/**
 * Encode a FirstMileMessage from a plain object (oneof members set directly, enums as names,
 * Empty as `{}`, Timestamp seconds as number or string).
 */
export function encodeMessage(obj: RawFirstMileMessage | Record<string, unknown>): Uint8Array {
  return FirstMileMessageType.encode(FirstMileMessageType.fromObject(obj)).finish()
}

/** Years 0001–9999, the range of protobuf's google.protobuf.Timestamp (and of plain ISO 8601 / PostgreSQL input). */
const MIN_TIMESTAMP_MS = -62_135_596_800_000
const MAX_TIMESTAMP_MS = 253_402_300_799_999

/** ISO 8601 time of a Timestamp; null if absent or outside years 0001–9999 (a corrupt logger clock). */
export function timestampToIso(ts: RawTimestamp | undefined): string | null {
  if (!ts) return null
  const ms = Number(ts.seconds ?? 0) * 1000 + Math.floor((ts.nanos ?? 0) / 1e6)
  if (!Number.isFinite(ms) || ms < MIN_TIMESTAMP_MS || ms > MAX_TIMESTAMP_MS) return null
  return new Date(ms).toISOString()
}

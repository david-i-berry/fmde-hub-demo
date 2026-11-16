// normaliseMetadata, decodeData, convertValue and canonicalJson, on the official FMDE examples
// (vendor/fmde) and messages built to exercise one behaviour each.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RawData, RawMetadata } from '../src/fmde'
import type { MetadataVersion } from '../src/model'
import { canonicalJson, convertValue, decodeData, normaliseMetadata, shortestFloat32 } from '../src/normalise'
import { decodeMessage, encodeMessage } from '../src/proto'

const example = (path: string) =>
  decodeMessage(new Uint8Array(readFileSync(new URL(`../vendor/fmde/examples/${path}.binpb`, import.meta.url))))

/** Metadata/data after an encode/decode round trip, as the hub would receive it. */
const receivedMetadata = (metadata: Record<string, unknown>): RawMetadata => decodeMessage(encodeMessage({ metadata })).metadata!
const receivedData = (data: Record<string, unknown>): RawData => decodeMessage(encodeMessage({ data })).data!

const ctx = { nodeKey: 'test/node1', group: 'test', nodeId: 'node1', topic: 'firstmile/a/test/node1', version: 1, receivedAt: '2025-08-21T08:51:00.000Z', contentHash: 'h', rawBytes: 0 }
const normalise = (raw: RawMetadata) => normaliseMetadata(raw, ctx)
const decode = (raw: RawData, metadata: MetadataVersion | null) =>
  decodeData(raw, { nodeKey: ctx.nodeKey, messageId: 'm1', receivedAt: ctx.receivedAt, metadata })

const param = (p: Record<string, unknown>) => ({ unit: 'Cel', cellMethod: 'POINT', ...p })

describe('normaliseMetadata: official examples', () => {
  it('meteostation: series keys from device, long name, cell method and period; no issues', () => {
    const { metadata, issues } = normalise(example('meteostation/metadata').metadata!)
    expect(issues).toEqual([])
    expect(metadata.parameters).toHaveLength(9)
    expect(metadata.parameters[0]).toMatchObject({
      key: 'test/node1/1/0',
      seriesKey: 'test/node1|obs1|Air Temperature|POINT|0',
      device: { kind: 'observer', observerId: 1 },
      standardNames: { cf: 'air_temperature' },
    })
    expect(metadata.parameters[6]).toMatchObject({ key: 'test/node1/2/0', seriesKey: 'test/node1|node|Battery Voltage|POINT|0', device: { kind: 'node' } })
    expect(metadata.node.location).toEqual({ latitude: 44.90192, longitude: 15.60844, heightMetres: 1.5, referenceSurface: 'GL' })
    // the example has no Node.id: nothing to compare with the topic
    expect(metadata.node.declaredId).toBeUndefined()
  })
})

describe('normaliseMetadata: series keys', () => {
  const twoThermometers = (device: object) => ({
    observers: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
    parameterDefinitions: [{ id: 1, description: 'd', parameters: [param({ longName: 'T', device: device }), param({ longName: 'T', device: device })] }],
  })

  it('gives parameters on different observer devices distinct, plain keys', () => {
    const { metadata } = normalise(receivedMetadata({
      observers: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
      parameterDefinitions: [{ id: 1, description: 'd', parameters: [param({ longName: 'T', device: { observerId: 1 } }), param({ longName: 'T', device: { observerId: 2 } })] }],
    }))
    expect(metadata.parameters.map((p) => p.seriesKey)).toEqual(['test/node1|obs1|T|POINT|0', 'test/node1|obs2|T|POINT|0'])
  })

  it('gives every parameter the metadata cannot tell apart a positional key, with no warning', () => {
    const { metadata, issues } = normalise(receivedMetadata(twoThermometers({ node: {} })))
    expect(metadata.parameters.map((p) => p.seriesKey)).toEqual(['test/node1|node|T|POINT|0#d1v0', 'test/node1|node|T|POINT|0#d1v1'])
    expect(issues).toEqual([])
  })

  it('keys ambiguous parameters by position, so reordering definitions does not swap them', () => {
    const defs = [
      { id: 1, description: 'a', parameters: [param({ longName: 'T', device: { node: {} } })] },
      { id: 2, description: 'b', parameters: [param({ longName: 'T', device: { node: {} } })] },
    ]
    const keys = (d: object[]) => Object.fromEntries(normalise(receivedMetadata({ parameterDefinitions: d })).metadata.parameters.map((p) => [p.definitionId, p.seriesKey]))
    expect(keys(defs)).toEqual(keys([...defs].reverse()))
  })
})

describe('normaliseMetadata: standard names', () => {
  it('reports a prefix missing from namespaces, including names every object inherits', () => {
    const { issues } = normalise(receivedMetadata({
      parameterDefinitions: [{ id: 1, description: 'd', parameters: [param({ longName: 'T', standardNames: { cf: 'air_temperature', toString: 'x', constructor: 'y' } })] }],
      namespaces: { cf: 'https://vocab.nerc.ac.uk/standard_name/' },
    }))
    expect(issues.filter((i) => i.code === 'UNKNOWN_NAMESPACE').map((i) => i.detail)).toEqual([
      'standardNames prefix "toString" has no entry in namespaces',
      'standardNames prefix "constructor" has no entry in namespaces',
    ])
  })
})

describe('decodeData', () => {
  const metadata = normalise(example('meteostation/metadata').metadata!).metadata

  it('meteostation example: values matched to parameters by position, emptyValue stored as null', () => {
    const d = decode(example('meteostation/data').data!, metadata)
    expect(d.issues).toEqual([])
    expect(d.observationCount).toBe(2)
    expect(d.valueCount).toBe(9)
    expect(d.emptyValueCount).toBe(1)
    expect(d.observations.map((o) => [o.seriesKey, o.value])).toEqual([
      ['test/node1|obs1|Air Temperature|POINT|0', 18.6],
      ['test/node1|obs1|Relative Humidity|POINT|0', 72.3],
      ['test/node1|obs1|Barometric Pressure|POINT|0', null],
      ['test/node1|obs1|Wind Speed (10min mean)|MEAN|600', 3.4],
      ['test/node1|obs1|Wind Direction (10min mean)|MEAN|600', 215],
      ['test/node1|obs1|Precipitation|SUM|600', 0.4],
      ['test/node1|node|Battery Voltage|POINT|0', 12.4],
      ['test/node1|node|Solar Panel Voltage|POINT|0', 17.6],
      ['test/node1|node|Internal Logger Temperature|POINT|0', 29.3],
    ])
    expect(d.observations[2]?.kind).toBe('emptyValue')
  })

  it('reports a Value with no type set as VALUE_NOT_SET only: not counted or stored as an empty value', () => {
    const d = decode(receivedData({
      observations: [{ parameterDefinitionId: 2, time: { seconds: 1755766200 }, values: [{ doubleValue: 12.4 }, {}, { emptyValue: {} }] }],
    }), metadata)
    expect(d.issues.map((i) => i.code)).toEqual(['VALUE_NOT_SET'])
    expect(d.emptyValueCount).toBe(1)
    expect(d.observations.map((o) => [o.paramKey, o.value])).toEqual([['test/node1/2/0', 12.4], ['test/node1/2/2', null]])
  })

  it('reports each cause once per message, listing the observations affected', () => {
    const bad = Array.from({ length: 12 }, () => ({ parameterDefinitionId: 2, values: [{ doubleValue: 1 }] }))
    const d = decode(receivedData({
      observations: [
        ...bad.map((o, i) => ({ ...o, time: { seconds: 1755766200 + i } })), // 12 with too few values
        { parameterDefinitionId: 2, values: [{ doubleValue: 1 }, { doubleValue: 2 }, { doubleValue: 3 }] }, // no time
      ],
    }), metadata)
    expect(d.issues.map((i) => i.code)).toEqual(['MISSING_TIME', 'VALUE_COUNT_MISMATCH'])
    expect(d.issues[0]?.detail).toBe('1 observation(s) with no time: 12')
    expect(d.issues[1]?.detail).toBe(
      '12 observation(s) with the wrong number of values: ' +
        Array.from({ length: 10 }, (_, i) => `${i} (definition 2: 1 values for 3 parameters)`).join(', ') + ', … (2 more)',
    )
  })
})

describe('convertValue', () => {
  it('returns a floatValue as the shortest decimal of the 32-bit float', () => {
    const [v] = receivedData({ observations: [{ values: [{ floatValue: 18.6 }] }] }).observations![0]!.values!
    expect(v?.floatValue).toBe(Math.fround(18.6)) // 18.600000381469727 as decoded
    expect(convertValue(v!)).toEqual({ value: 18.6, kind: 'floatValue' })
  })

  it('keeps doubleValue exactly', () => {
    expect(convertValue({ kind: 'doubleValue', doubleValue: 18.600000381469727 }).value).toBe(18.600000381469727)
  })

  it('keeps the exact text of 64-bit integers beyond 2^53', () => {
    expect(convertValue({ kind: 'int64Value', int64Value: '42' })).toEqual({ value: 42, kind: 'int64Value', exact: undefined })
    expect(convertValue({ kind: 'uint64Value', uint64Value: '18446744073709551615' })).toMatchObject({ kind: 'uint64Value', exact: '18446744073709551615' })
  })
})

describe('shortestFloat32', () => {
  it('returns the shortest decimal that is the same 32-bit float', () => {
    for (const x of [18.6, 0.1, 3.42, -273.15, 1e-7, 3.4e38, 1013.25, 16777217]) {
      const f = Math.fround(x)
      const s = shortestFloat32(f)
      expect(Math.fround(s), String(x)).toBe(f)
      expect(String(s).replace(/^-|\.|e.*$/g, '').replace(/^0+/, '').length, String(x)).toBeLessThanOrEqual(9)
    }
    expect(shortestFloat32(Math.fround(18.6))).toBe(18.6)
    expect(shortestFloat32(Math.fround(0.1))).toBe(0.1)
    expect(shortestFloat32(Math.fround(16777217))).toBe(16777216) // not representable: nearest float
  })

  it('passes through 0, infinities and NaN', () => {
    expect(shortestFloat32(0)).toBe(0)
    expect(shortestFloat32(Infinity)).toBe(Infinity)
    expect(shortestFloat32(NaN)).toBeNaN()
  })
})

describe('canonicalJson', () => {
  it('gives the same text whatever the key order, at any depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }))
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}')
  })

  it('keeps array order (parameter positions are meaningful) and drops undefined fields', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('gives decoded metadata the same text when only its key order differs', () => {
    const raw = example('meteostation/metadata').metadata!
    // every object's keys in reverse order, at every depth; arrays unchanged
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverseKeys)
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]))
          : v
    const reordered = reverseKeys(raw)
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(raw))
    expect(canonicalJson(reordered)).toBe(canonicalJson(raw))
  })
})

describe('decodeData: repeated observation times', () => {
  const metadata = normalise(example('meteostation/metadata').metadata!).metadata
  const logger = (time: number, values: number[]) => ({ parameterDefinitionId: 2, time: { seconds: time }, values: values.map((v) => ({ doubleValue: v })) })

  it('warns DUPLICATE_OBSERVATION_TIME for a definition observed twice at the same time', () => {
    const d = decode(receivedData({ observations: [logger(1755766200, [12.4, 17.6, 29.3]), logger(1755766200, [12.5, 17.6, 29.3])] }), metadata)
    expect(d.issues).toEqual([
      {
        code: 'DUPLICATE_OBSERVATION_TIME',
        detail: '1 time(s) repeated for the same definition (the last observation is stored): definition 2 at 2025-08-21T08:50:00.000Z: observations 0, 1',
      },
    ])
  })

  it('warns even when the repeated observation has the same values', () => {
    const d = decode(receivedData({ observations: [logger(1755766200, [12.4, 17.6, 29.3]), logger(1755766200, [12.4, 17.6, 29.3])] }), metadata)
    expect(d.issues.map((i) => i.code)).toEqual(['DUPLICATE_OBSERVATION_TIME'])
  })

  it('does not warn for different times, or for different definitions at the same time', () => {
    const d = decode(example('meteostation/data').data!, metadata) // definitions 1 and 2, both at 08:50
    expect(d.issues).toEqual([])
    const twoTimes = decode(receivedData({ observations: [logger(1755766200, [1, 2, 3]), logger(1755766260, [1, 2, 3])] }), metadata)
    expect(twoTimes.issues).toEqual([])
  })

  it('detects repeats without metadata too (a property of the message alone)', () => {
    const d = decode(receivedData({ observations: [logger(1755766200, [1, 2, 3]), logger(1755766200, [1, 2, 3])] }), null)
    expect(d.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['NO_METADATA', 'DUPLICATE_OBSERVATION_TIME']))
  })
})

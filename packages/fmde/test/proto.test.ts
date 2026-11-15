// decodeMessage() against the official FMDE schema and examples (vendor/fmde, from wmo-im/fmde).
// The *.binpb files were encoded from the .textproto examples by protoc, not by protobufjs, so these
// tests catch a wrong generated/fmde.json or a decoder whose output no longer matches the Raw* types
// in fmde.ts (they are not checked at runtime).
import { readFileSync } from 'node:fs'
import protobuf from 'protobufjs'
import { describe, expect, it } from 'vitest'
import descriptor from '../src/generated/fmde.json'
import { decodeMessage, encodeMessage, FMDE_PACKAGE } from '../src/proto'

const fixture = (path: string) => readFileSync(new URL(`../vendor/fmde/${path}`, import.meta.url))
const example = (path: string) => decodeMessage(new Uint8Array(fixture(`examples/${path}.binpb`)))

describe('generated/fmde.json', () => {
  it('matches the official FMDE schema', () => {
    const official = protobuf.parse(fixture('schemas/first-mile-message-encoding.proto').toString('utf8'), { keepCase: true }).root
    // fmde.json also bundles google.protobuf.Empty and Timestamp (protobufjs/light has no built-in types),
    // so compare the FMDE package only
    const fmde = (root: protobuf.Root) => root.lookup(FMDE_PACKAGE)!.toJSON()
    expect(fmde(protobuf.Root.fromJSON(descriptor as protobuf.INamespace))).toEqual(fmde(official))
  })
})

describe('decodeMessage: official examples', () => {
  it('hydrostation metadata', () => {
    expect(example('hydrostation/metadata')).toEqual({
      content: 'metadata',
      metadata: {
        node: { name: 'Hydro-Station-02', serialNumber: 'HYDSTN002-2025' },
        observers: [
          { id: 1, name: 'Geolux LX-80 Radar Level Sensor' },
          { id: 2, name: 'OTT Pluvio² Rain Gauge' },
        ],
        parameterDefinitions: [
          {
            id: 1,
            description: 'Hydrological parameters',
            parameters: [
              { longName: 'Water Level', unit: 'm', device: { target: 'observerId', observerId: 1 }, cellMethod: 'MEAN', cellPeriodSeconds: 10 },
              { longName: 'Rainfall Intensity', unit: 'mm/h', device: { target: 'observerId', observerId: 2 }, cellMethod: 'MEAN', cellPeriodSeconds: 600 },
            ],
          },
        ],
      },
    })
  })

  it('hydrostation data: a value of 0.0 is kept (it is inside a oneof)', () => {
    const msg = example('hydrostation/data')
    expect(msg.content).toBe('data')
    expect(msg.data?.observations).toEqual([
      { parameterDefinitionId: 1, time: { seconds: '1755765000' }, values: [{ kind: 'doubleValue', doubleValue: 3.42 }, { kind: 'doubleValue', doubleValue: 0 }] },
      { parameterDefinitionId: 1, time: { seconds: '1755765600' }, values: [{ kind: 'doubleValue', doubleValue: 3.43 }, { kind: 'doubleValue', doubleValue: 0 }] },
      { parameterDefinitionId: 1, time: { seconds: '1755766200' }, values: [{ kind: 'doubleValue', doubleValue: 3.52 }, { kind: 'doubleValue', doubleValue: 3.1 }] },
    ])
  })

  it('meteostation metadata: locations, node device, standard names, namespaces', () => {
    const m = example('meteostation/metadata').metadata
    expect(m?.node).toEqual({
      name: 'Campbell CR3000 Datalogger',
      serialNumber: 'CR3K-2025-99384',
      location: { latitude: 44.90192, longitude: 15.60844, heightMetres: 1.5, referenceSurface: 'GL' },
      firmwareVersion: 'OS25.04',
    })
    expect(m?.observers?.[0]?.location).toEqual({ latitude: 44.90192, longitude: 15.60844, heightMetres: 2, referenceSurface: 'GL' })

    const [weather, logger] = m?.parameterDefinitions ?? []
    expect(weather?.parameters?.map((p) => p.longName)).toEqual([
      'Air Temperature', 'Relative Humidity', 'Barometric Pressure',
      'Wind Speed (10min mean)', 'Wind Direction (10min mean)', 'Precipitation',
    ])
    expect(weather?.parameters?.[0]).toEqual({
      longName: 'Air Temperature',
      unit: '°C',
      device: { target: 'observerId', observerId: 1 },
      cellMethod: 'POINT',
      standardNames: { cf: 'air_temperature' },
    })
    expect(weather?.parameters?.[5]).toMatchObject({ unit: 'mm', cellMethod: 'SUM', cellPeriodSeconds: 600 })
    // device { node {} }; cellPeriodSeconds: 0 is the proto3 default, so absent
    expect(logger?.parameters?.[0]).toEqual({ longName: 'Battery Voltage', unit: 'V', device: { target: 'node', node: {} }, cellMethod: 'POINT' })
    expect(m?.namespaces).toEqual({ cf: 'https://vocab.nerc.ac.uk/standard_name/' })
  })

  it('meteostation data: emptyValue decodes as {}', () => {
    const [weather, logger] = example('meteostation/data').data?.observations ?? []
    expect(weather?.values?.[2]).toEqual({ kind: 'emptyValue', emptyValue: {} })
    expect(weather?.values?.map((v) => v.doubleValue)).toEqual([18.6, 72.3, undefined, 3.4, 215, 0.4])
    expect(logger).toEqual({
      parameterDefinitionId: 2,
      time: { seconds: '1755766200' },
      values: [
        { kind: 'doubleValue', doubleValue: 12.4 },
        { kind: 'doubleValue', doubleValue: 17.6 },
        { kind: 'doubleValue', doubleValue: 29.3 },
      ],
    })
  })
})

// Cases the official examples do not cover; these round-trip through encodeMessage().
describe('decodeMessage: edge cases', () => {
  it('keeps 64-bit integers exact as decimal strings', () => {
    const msg = decodeMessage(encodeMessage({
      data: { observations: [{ values: [{ int64Value: '9007199254740993' }, { uint64Value: '18446744073709551615' }] }] },
    }))
    expect(msg.data?.observations?.[0]?.values).toEqual([
      { kind: 'int64Value', int64Value: '9007199254740993' },
      { kind: 'uint64Value', uint64Value: '18446744073709551615' },
    ])
  })

  it('keeps latitude/longitude 0 (proto3 optional) but omits other fields at their default', () => {
    const msg = decodeMessage(encodeMessage({
      metadata: { node: { location: { latitude: 0, longitude: 0, heightMetres: 0 } }, observers: [{ id: 0, name: 'Logger' }] },
    }))
    // the equator / prime meridian must not be lost
    expect(msg.metadata?.node?.location).toEqual({ latitude: 0, longitude: 0 })
    // observer id 0 is the proto3 default: absent after decoding
    expect(msg.metadata?.observers?.[0]).toEqual({ name: 'Logger' })
  })

  it('returns an enum value unknown to the schema as a number, not a name', () => {
    // e.g. a cell method added in a newer FMDE version (hence string | number in fmde.ts)
    const msg = decodeMessage(encodeMessage({ metadata: { parameterDefinitions: [{ id: 1, parameters: [{ longName: 'X', cellMethod: 99 }] }] } }))
    expect(msg.metadata?.parameterDefinitions?.[0]?.parameters?.[0]?.cellMethod).toBe(99)
  })

  it('throws on truncated bytes', () => {
    const bytes = new Uint8Array(fixture('examples/meteostation/metadata.binpb'))
    expect(() => decodeMessage(bytes.subarray(0, bytes.length - 10))).toThrow()
  })
})

// ATS checks against the official FMDE examples (vendor/fmde) and targeted broken variants.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ATS_TESTS, checkMetadata, checkTopic, CODE_INFO, evaluateAts, isKnownUnit } from '../src/ats'
import type { RawMetadata } from '../src/fmde'
import { decodeMessage, encodeMessage } from '../src/proto'

const exampleMetadata = (station: string): RawMetadata =>
  decodeMessage(new Uint8Array(readFileSync(new URL(`../vendor/fmde/examples/${station}/metadata.binpb`, import.meta.url)))).metadata!

/** Metadata after an encode/decode round trip, as the hub would receive it. */
const received = (metadata: Record<string, unknown>): RawMetadata => decodeMessage(encodeMessage({ metadata })).metadata!

const codes = (raw: RawMetadata) => checkMetadata(raw).map((i) => i.code)

/** A minimal metadata message that passes every check; tests break one thing at a time. */
const valid = {
  node: { name: 'Node', location: { latitude: 46.2, longitude: 6.1, heightMetres: 400, referenceSurface: 'MSL' } },
  observers: [{ id: 1, name: 'Thermometer' }],
  parameterDefinitions: [
    { id: 1, description: 'Weather', parameters: [{ longName: 'Air temperature', unit: 'Cel', device: { observerId: 1 }, cellMethod: 'MEAN', cellPeriodSeconds: 60 }] },
  ],
  namespaces: { cf: 'https://vocab.nerc.ac.uk/standard_name/' },
}
const withParameter = (p: Record<string, unknown>) => ({
  ...valid,
  parameterDefinitions: [{ id: 1, description: 'Weather', parameters: [{ ...valid.parameterDefinitions[0]!.parameters[0], ...p }] }],
})
const withNodeLocation = (location: Record<string, unknown>) => ({ ...valid, node: { name: 'Node', location } })

describe('checkMetadata: official examples', () => {
  it('meteostation passes every check', () => {
    expect(checkMetadata(exampleMetadata('meteostation'))).toEqual([])
  })

  it('hydrostation only warns about its empty namespaces map (permitted when no standard names are used)', () => {
    expect(codes(exampleMetadata('hydrostation'))).toEqual(['METADATA_NO_NAMESPACES'])
  })
})

describe('checkMetadata: cellMethod', () => {
  it('passes a valid message', () => {
    expect(codes(received(valid))).toEqual([])
  })

  it('reports a missing cellMethod', () => {
    expect(codes(received(withParameter({ cellMethod: undefined })))).toEqual(['CELL_METHOD_UNSPECIFIED'])
  })

  it('reports a cellMethod value outside the enumeration, without a period check on it', () => {
    const issues = checkMetadata(received(withParameter({ cellMethod: 99 })))
    expect(issues.map((i) => i.code)).toEqual(['CELL_METHOD_UNKNOWN'])
    expect(issues[0]?.detail).toContain('99')
  })

  it('still checks the period of a known cellMethod', () => {
    expect(codes(received(withParameter({ cellMethod: 'POINT', cellPeriodSeconds: 60 })))).toEqual(['CELL_PERIOD_INCONSISTENT'])
  })
})

describe('checkMetadata: referenceSurface', () => {
  it('reports a location without a referenceSurface', () => {
    expect(codes(received(withNodeLocation({ latitude: 46.2, longitude: 6.1, heightMetres: 400 })))).toEqual(['LOCATION_NO_REFERENCE_SURFACE'])
  })

  it('reports a referenceSurface value outside the enumeration', () => {
    const issues = checkMetadata(received(withNodeLocation({ latitude: 46.2, longitude: 6.1, heightMetres: 400, referenceSurface: 99 })))
    expect(issues.map((i) => i.code)).toEqual(['REFERENCE_SURFACE_UNKNOWN'])
    expect(issues[0]?.detail).toContain('99')
  })
})

describe('isKnownUnit', () => {
  it('accepts C-6 notations and abbreviations, with ° or ˚', () => {
    for (const unit of ['Cel', '°C', '˚C', 'hPa', '%', 'm/s', 'mm', 'V']) expect(isKnownUnit(unit), unit).toBe(true)
  })

  it('accepts an abbreviation published with surrounding whitespace, trimmed', () => {
    expect(isKnownUnit('mol mol^-1')).toBe(true)
  })

  it('rejects blank units and SI prefixes, which the C-6 snapshot lists as entries', () => {
    for (const unit of ['', ' ', '(y)', '(Y)', '(z)', '(Z)']) expect(isKnownUnit(unit), JSON.stringify(unit)).toBe(false)
  })

  it('reports a blank or prefix unit as UNIT_NOT_IN_CODELIST', () => {
    expect(codes(received(withParameter({ unit: ' ' })))).toEqual(['UNIT_NOT_IN_CODELIST'])
    expect(codes(received(withParameter({ unit: '(y)' })))).toEqual(['UNIT_NOT_IN_CODELIST'])
  })
})

describe('evaluateAts', () => {
  const topic = { topic: 'firstmile/a/test/node', group: 'test', nodeId: 'node' }

  it('fails the parameter and location tests on values outside the enumerations', () => {
    const metadata = received({
      ...withParameter({ cellMethod: 99 }),
      node: { name: 'Node', location: { heightMetres: 400, referenceSurface: 99 } },
    })
    const status = Object.fromEntries(evaluateAts({ topic, metadata, dataIssues: [], dataMessages: 0 }).map((r) => [r.test.id, r.status]))
    expect(status['/conf/message-encoding/parameter']).toBe('fail')
    expect(status['/conf/message-encoding/location']).toBe('fail')
  })
})

describe('CODE_INFO', () => {
  it('ties every code with a test to a test in ATS_TESTS', () => {
    const ids = new Set(ATS_TESTS.map((t) => t.id))
    for (const [code, info] of Object.entries(CODE_INFO)) {
      if (info.test) expect(ids.has(info.test), `${code} -> ${info.test}`).toBe(true)
    }
  })
})

describe('checkTopic', () => {
  const topicCodes = (topic: string, group = 'test', nodeId = 'node-1') => checkTopic(topic, group, nodeId).map((i) => i.code)

  it('passes a conforming topic', () => {
    expect(topicCodes('firstmile/a/test/node-1')).toEqual([])
  })

  it('rejects upper case, dots and characters beyond ASCII', () => {
    expect(topicCodes('firstmile/a/Test/node-1')).toContain('TOPIC_CONVENTIONS')
    expect(topicCodes('firstmile/a/test/node.1')).toContain('TOPIC_CONVENTIONS')
    expect(topicCodes('firstmile/a/tést/node-1')).toContain('TOPIC_CONVENTIONS')
  })

  it('rejects control characters, showing them escaped in the detail', () => {
    for (const c of ['\x01', '\x07', '\t', '\n', '\x1f', '\x7f']) {
      const issues = checkTopic(`firstmile/a/test/node${c}1`, 'test', 'node-1')
      expect(issues.map((i) => i.code), JSON.stringify(c)).toEqual(['TOPIC_CONVENTIONS'])
      expect(issues[0]?.detail).toContain(JSON.stringify(`firstmile/a/test/node${c}1`))
    }
  })

  it('checks group-id and node-id: lowercase alphanumerics and hyphens, not at either end', () => {
    expect(topicCodes('firstmile/a/test/-node', 'test', '-node')).toEqual(['GROUP_NODE_ID_INVALID'])
    expect(topicCodes('firstmile/a/test_1/node-1', 'test_1')).toEqual(['GROUP_NODE_ID_INVALID'])
  })
})

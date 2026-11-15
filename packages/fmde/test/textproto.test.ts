// toTextProto() on the official FMDE examples (vendor/fmde), compared with golden files in
// test/textproto/. test/textproto/verify.sh checks with protoc that each golden file encodes to
// exactly the official example's bytes, so the rendering is valid text format with the same meaning.
// After a deliberate change to the rendering: `npx vitest run -u packages/fmde`, then run verify.sh.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normaliseMetadata } from '../src/normalise'
import { decodeMessage } from '../src/proto'
import { toTextProto } from '../src/textproto'

const example = (path: string) =>
  decodeMessage(new Uint8Array(readFileSync(new URL(`../vendor/fmde/examples/${path}.binpb`, import.meta.url))))

const metadataOf = (station: string) =>
  normaliseMetadata(example(`${station}/metadata`).metadata!, {
    nodeKey: `test/${station}`, group: 'test', nodeId: station, topic: `firstmile/a/test/${station}`,
    version: 1, receivedAt: '2025-08-21T09:00:00.000Z', contentHash: 'h', rawBytes: 0,
  }).metadata

describe('toTextProto: official examples', () => {
  for (const station of ['meteostation', 'hydrostation']) {
    it(`${station} metadata`, async () => {
      await expect(`${toTextProto(example(`${station}/metadata`))}\n`).toMatchFileSnapshot(`./textproto/${station}-metadata.textproto`)
    })

    it(`${station} data, annotated with parameter names and units from the metadata`, async () => {
      await expect(`${toTextProto(example(`${station}/data`), metadataOf(station))}\n`).toMatchFileSnapshot(`./textproto/${station}-data.textproto`)
    })
  }
})

describe('toTextProto', () => {
  it('annotates times with ISO 8601 and an empty value without a unit', () => {
    const text = toTextProto(example('meteostation/data'), metadataOf('meteostation'))
    expect(text).toContain('time { seconds: 1755766200 }  # 2025-08-21T08:50:00.000Z')
    expect(text).toContain('values { doubleValue: 18.6 }  # Air Temperature [°C]')
    expect(text).toContain('values { emptyValue {} }  # Barometric Pressure')
  })

  it('writes 64-bit integers unquoted and enum values outside the schema as numbers', () => {
    const text = toTextProto({
      content: 'metadata',
      metadata: { parameterDefinitions: [{ id: 1, parameters: [{ longName: 'X', cellMethod: 99 }] }] },
    })
    expect(text).toContain('cellMethod: 99')
    expect(toTextProto({ content: 'data', data: { observations: [{ values: [{ kind: 'int64Value', int64Value: '9007199254740993' }] }] } }))
      .toContain('values { int64Value: 9007199254740993 }')
  })
})

import { describe, expect, it } from 'vitest'
import { decodeData, timestampToIso } from '../src'

describe('timestampToIso', () => {
  it('converts seconds and nanos', () => {
    expect(timestampToIso({ seconds: '1700000000', nanos: 500_000_000 })).toBe('2023-11-14T22:13:20.500Z')
  })

  it('returns null for times outside years 0001-9999 instead of throwing', () => {
    expect(timestampToIso({ seconds: '9223372036854775807' })).toBeNull()
    expect(timestampToIso({ seconds: '253402300800' })).toBeNull() // 10000-01-01
    expect(timestampToIso({ seconds: '-62135596801' })).toBeNull() // before 0001-01-01
    expect(timestampToIso({ seconds: '253402300799' })).toBe('9999-12-31T23:59:59.000Z')
  })
})

describe('decodeData', () => {
  it('reports an out-of-range time as MISSING_TIME and keeps going', () => {
    const d = decodeData(
      {
        observations: [
          { parameterDefinitionId: 1, time: { seconds: '9223372036854775807' }, values: [{ kind: 'floatValue', floatValue: 1 }] },
          { parameterDefinitionId: 1, time: { seconds: '1700000000' }, values: [{ kind: 'floatValue', floatValue: 2 }] },
        ],
      },
      { nodeKey: 'g/n', messageId: 'm', receivedAt: '2023-11-14T22:14:00.000Z', metadata: null },
    )
    expect(d.issues.find((i) => i.code === 'MISSING_TIME')?.detail).toMatch(/outside years 0001-9999: 0$/)
    expect(d.firstObsTime).toBe('2023-11-14T22:13:20.000Z')
  })
})

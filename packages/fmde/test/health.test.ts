// Node-health parameters: found by the hub configuration's healthParamMap, else by name and unit.
import { describe, expect, it } from 'vitest'
import { healthParameter, type MetadataVersion, type Parameter } from '../src'

const param = (seriesKey: string, longName: string, unit: string, device: Parameter['device'] = { kind: 'node' }): Parameter =>
  ({ seriesKey, key: seriesKey, longName, unit, device } as Parameter)
const metadata = (parameters: Parameter[]) => ({ parameters }) as MetadataVersion

describe('healthParameter', () => {
  const md = metadata([
    param('t', 'air temperature', 'Cel'),
    param('b', 'Battery voltage', 'V'),
    param('s', 'solar panel voltage', 'V'),
    param('l', 'logger temperature', 'Cel'),
  ])

  it('finds node-level health parameters by name and unit', () => {
    expect(healthParameter(md, 'batteryVoltage')?.seriesKey).toBe('b')
    expect(healthParameter(md, 'solarVoltage')?.seriesKey).toBe('s')
    expect(healthParameter(md, 'loggerTemperature')?.seriesKey).toBe('l')
  })

  it('ignores a matching name with the wrong unit, or on an observer device', () => {
    expect(healthParameter(metadata([param('b', 'battery voltage', 'mV')]), 'batteryVoltage')).toBeNull()
    expect(healthParameter(metadata([param('b', 'battery voltage', 'V', { kind: 'observer', observerId: 1 })]), 'batteryVoltage')).toBeNull()
  })

  it('uses the hub configuration first, and only it when set', () => {
    expect(healthParameter(md, 'batteryVoltage', { healthParamMap: { batteryVoltage: 's' } })?.seriesKey).toBe('s')
    expect(healthParameter(md, 'batteryVoltage', { healthParamMap: { batteryVoltage: 'missing' } })).toBeNull()
  })
})

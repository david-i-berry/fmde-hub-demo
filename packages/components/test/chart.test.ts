// Chart labels and tooltip times: zero-padded, the same in UTC and local time, and as formatTime.
import { describe, expect, it } from 'vitest'
import { chartTokens, stamp, timeLabel } from '../src/chart'
import { formatTime } from '../src/format'

describe('timeLabel', () => {
  it('shows MM-DD at midnight, zero-padded, in UTC', () => {
    expect(timeLabel(Date.UTC(2026, 10, 5), true)).toBe('11-05')
    expect(timeLabel(Date.UTC(2026, 0, 9), true)).toBe('01-09')
  })

  it('shows MM-DD at midnight, zero-padded, in local time', () => {
    expect(timeLabel(new Date(2026, 10, 5).getTime(), false)).toBe('11-05')
    expect(timeLabel(new Date(2026, 0, 9).getTime(), false)).toBe('01-09')
  })

  it('shows HH:MM otherwise, zero-padded', () => {
    expect(timeLabel(Date.UTC(2026, 10, 5, 8, 5), true)).toBe('08:05')
    expect(timeLabel(new Date(2026, 10, 5, 0, 30).getTime(), false)).toBe('00:30')
  })
})

describe('stamp', () => {
  it('matches formatTime in UTC and in local time', () => {
    const ms = Date.UTC(2026, 10, 16, 8, 50, 30)
    expect(stamp(ms, true)).toBe('2026-11-16 08:50Z')
    expect(stamp(ms, false)).toBe(formatTime(new Date(ms).toISOString(), false))
    expect(stamp(ms, false)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('chartTokens', () => {
  it('defines every colour as hex for both modes', () => {
    for (const dark of [false, true]) {
      for (const [name, colour] of Object.entries(chartTokens(dark))) expect(colour, name).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

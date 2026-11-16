// Arrival strip: which mark a data message gets, and where it sits on the log axis.
import { describe, expect, it } from 'vitest'
import { arrivalHeight, arrivalKind, type ArrivalPoint } from '../src/arrival'

const msg = (latencySeconds: number | null, spanSeconds: number | null = latencySeconds): ArrivalPoint => ({
  id: 'm',
  receivedAt: '2026-11-16T08:00:00Z',
  latencySeconds,
  spanSeconds,
  observations: 1,
  payloadBytes: 40,
})

describe('arrivalKind', () => {
  it('tells live messages from backlog flushes', () => {
    expect(arrivalKind(msg(30), 3600)).toBe('live')
    expect(arrivalKind(msg(30, 7200), 3600)).toBe('backlog')
  })

  it('marks a message without an observation time, instead of drawing it as the most timely', () => {
    expect(arrivalKind(msg(null, null), 3600)).toBe('noTime')
  })

  it('marks observation times in the future beyond the tolerance, as the hub checks do', () => {
    expect(arrivalKind(msg(-300), 3600)).toBe('future')
    expect(arrivalKind(msg(-300, 7200), 3600)).toBe('future') // a clock fault outranks a backlog
    expect(arrivalKind(msg(-5), 3600)).toBe('live') // within 60 s: a clock slightly ahead
    expect(arrivalKind(msg(-5), 3600, 0)).toBe('future')
  })
})

describe('arrivalHeight', () => {
  it('is the latency, with the log axis floor of 1 s for small, negative or missing latencies', () => {
    expect(arrivalHeight(msg(90))).toBe(90)
    expect(arrivalHeight(msg(0.2))).toBe(1)
    expect(arrivalHeight(msg(-300))).toBe(1)
    expect(arrivalHeight(msg(null))).toBe(1)
  })
})

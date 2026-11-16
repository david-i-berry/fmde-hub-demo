// Which broker URLs FMDEhub connects to: encrypted, except to this machine.
import { describe, expect, it } from 'vitest'
import { brokerUrlProblem } from '../src/urls'

describe('brokerUrlProblem', () => {
  it('accepts wss:// to any host', () => {
    expect(brokerUrlProblem('wss://broker.example.org:8884/mqtt')).toBeNull()
  })

  it('accepts unencrypted ws:// only to this machine', () => {
    expect(brokerUrlProblem('ws://localhost:8080/mqtt')).toBeNull()
    expect(brokerUrlProblem('ws://127.0.0.1:8080')).toBeNull()
    expect(brokerUrlProblem('ws://[::1]:8080')).toBeNull()
    expect(brokerUrlProblem('ws://broker.example.org:8080/mqtt')).toMatch(/wss/)
    expect(brokerUrlProblem('ws://localhost.example.org:8080')).toMatch(/wss/)
  })

  it('refuses other schemes and malformed URLs', () => {
    expect(brokerUrlProblem('mqtt://broker.example.org:1883')).toMatch(/wss/)
    expect(brokerUrlProblem('https://broker.example.org')).toMatch(/wss/)
    expect(brokerUrlProblem('')).toBe('not a valid URL')
    expect(brokerUrlProblem('broker.example.org')).toBe('not a valid URL')
  })
})

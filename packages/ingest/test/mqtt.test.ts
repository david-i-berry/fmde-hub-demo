// MqttSource against a fake mqtt.js client: connection options, subscription results and refusals.
import { EventEmitter } from 'node:events'
import type { IClientOptions, MqttClient } from 'mqtt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PACKET_BYTES, MqttSource, REFUSAL_RETRY_MS } from '../src/mqtt'
import type { MqttSourceConfig, SourceStatus } from '../src/types'

class FakeClient extends EventEmitter {
  subscriptions: Record<string, { qos: number; rap?: boolean }> | null = null
  private subscribed: ((err: Error | null, granted?: { topic: string; qos: number }[]) => void) | null = null
  reconnect = vi.fn()
  endAsync = vi.fn(async () => {})

  subscribe(map: Record<string, { qos: number; rap?: boolean }>, callback: FakeClient['subscribed']) {
    this.subscriptions = map
    this.subscribed = callback
  }

  /** The broker's SUBACK: one granted QoS (or failure reason code) per filter. */
  grant(qos: number[]) {
    this.subscribed?.(null, Object.keys(this.subscriptions ?? {}).map((topic, i) => ({ topic, qos: qos[i] ?? qos[0]! })))
  }
}

const BASE: MqttSourceConfig = { url: 'wss://broker.example.org:8884/mqtt', clientId: 'fmde-hub-test' }

async function started(config: Partial<MqttSourceConfig> = {}) {
  const client = new FakeClient()
  let options: IClientOptions | undefined
  const statuses: Partial<SourceStatus>[] = []
  const source = new MqttSource({ ...BASE, ...config }, (_url, o) => {
    options = o
    return client as unknown as MqttClient
  })
  await source.start(() => {}, (s) => statuses.push(s))
  const last = () => statuses.at(-1)
  return { source, client, options: options!, statuses, last }
}

/** An mqtt.js connection error carrying an MQTT 5 reason code (as its ErrorWithReasonCode does). */
const refusal = (code: number, reason: string) => Object.assign(new Error(`Connection refused: ${reason}`), { code })

describe('MqttSource: connection options', () => {
  it('connects with MQTT 5, a maximum packet size, and no automatic retry after a refusal', async () => {
    const { options } = await started()
    expect(options).toMatchObject({ protocolVersion: 5, reconnectOnConnackError: false, clean: true })
    expect(options.properties).toEqual({ maximumPacketSize: MAX_PACKET_BYTES })
  })

  it('asks for a persistent session when configured', async () => {
    const { options } = await started({ persistentSessionSeconds: 86_400 })
    expect(options.clean).toBe(false)
    expect(options.properties).toEqual({ maximumPacketSize: MAX_PACKET_BYTES, sessionExpiryInterval: 86_400 })
  })

  it('refuses an unencrypted broker URL without connecting', async () => {
    const connect = vi.fn()
    const statuses: Partial<SourceStatus>[] = []
    await new MqttSource({ url: 'ws://broker.example.org/mqtt' }, connect).start(() => {}, (s) => statuses.push(s))
    expect(connect).not.toHaveBeenCalled()
    expect(statuses.at(-1)).toMatchObject({ state: 'error' })
  })
})

describe('MqttSource: subscription', () => {
  it('subscribes to every filter with QoS 1 and Retain As Published', async () => {
    const { client } = await started({ topic: 'firstmile/a/#, firstmile/poc1/#' })
    client.emit('connect', { sessionPresent: false })
    expect(client.subscriptions).toEqual({ 'firstmile/a/#': { qos: 1, rap: true }, 'firstmile/poc1/#': { qos: 1, rap: true } })
  })

  it('reports a refused subscription', async () => {
    const { client, last } = await started()
    client.emit('connect', { sessionPresent: false })
    client.grant([135])
    expect(last()).toMatchObject({ state: 'error', detail: expect.stringContaining('refused') })
  })

  it('warns when the broker downgrades a persistent session to QoS 0', async () => {
    const { client, last } = await started({ persistentSessionSeconds: 86_400, topic: 'firstmile/a/#, firstmile/poc1/#' })
    client.emit('connect', { sessionPresent: false })
    client.grant([1, 0])
    expect(last()).toMatchObject({ state: 'connected', detail: expect.stringContaining('QoS 0 for firstmile/poc1/#') })
  })

  it('does not warn about QoS 0 without a persistent session', async () => {
    const { client, statuses } = await started()
    client.emit('connect', { sessionPresent: false })
    const before = statuses.length
    client.grant([0])
    expect(statuses).toHaveLength(before)
  })
})

describe('MqttSource: refused connections', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('stops on bad credentials and says what to do', async () => {
    const { client, last } = await started()
    client.emit('error', refusal(134, 'Bad User Name or Password'))
    expect(last()).toMatchObject({ state: 'error', detail: expect.stringContaining('check the broker settings') })
    vi.advanceTimersByTime(10 * REFUSAL_RETRY_MS)
    expect(client.reconnect).not.toHaveBeenCalled()
  })

  it('retries a transient refusal (server busy) after a minute, once', async () => {
    const { client, last } = await started()
    client.emit('error', refusal(137, 'Server busy'))
    client.emit('error', refusal(137, 'Server busy')) // a second report does not stack a second retry
    expect(last()).toMatchObject({ state: 'error', detail: expect.stringContaining('retrying in 60 s') })
    vi.advanceTimersByTime(REFUSAL_RETRY_MS - 1)
    expect(client.reconnect).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(client.reconnect).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending retry when stopped', async () => {
    const { source, client } = await started()
    client.emit('error', refusal(136, 'Server unavailable'))
    await source.stop()
    vi.advanceTimersByTime(REFUSAL_RETRY_MS)
    expect(client.reconnect).not.toHaveBeenCalled()
    expect(client.endAsync).toHaveBeenCalled()
  })

  it('passes other errors through unchanged', async () => {
    const { client, last } = await started()
    client.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
    expect(last()).toEqual({ state: 'error', detail: 'connect ECONNREFUSED' })
  })
})

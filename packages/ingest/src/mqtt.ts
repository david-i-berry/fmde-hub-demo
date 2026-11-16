// MqttSource: mqtt.js over WSS with read-only credentials, subscribing to firstmile/a/# and the legacy
// firstmile/poc1/#.
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt'
import { POC1_TOPIC_FILTER, TOPIC_FILTER } from '@fmde-hub/fmde'
import type { IncomingMessage, MqttSourceConfig, SourceStatus } from './types'
import { brokerUrlProblem } from './urls'

/** Default: the FMDE hierarchy and the legacy POC1 one the test devices still use. */
export const DEFAULT_TOPIC_FILTERS = `${TOPIC_FILTER}, ${POC1_TOPIC_FILTER}`

/**
 * Largest packet the broker may send us (MQTT 5 Maximum Packet Size; the broker must not send larger).
 * FMDE messages are small (the official examples are under 1 KB); anyone who can publish on the
 * topics controls the payload, so this bounds what reaches the browser and its database.
 */
export const MAX_PACKET_BYTES = 1024 * 1024

/**
 * CONNACK reason codes for a refusal that may pass (MQTT 5, 3.2.2.2): server unavailable, server busy,
 * quota exceeded, connection rate exceeded. FMDEhub retries these; any other refusal (bad user name
 * or password, not authorized, banned, …) is final until the user reconnects.
 */
const TRANSIENT_REFUSALS = new Set([136, 137, 151, 159])
export const REFUSAL_RETRY_MS = 60_000

/** mqtt.connect, replaceable in tests. */
export type Connect = (url: string, options: IClientOptions) => MqttClient

export class MqttSource {
  private client: MqttClient | null = null
  private retry: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly config: MqttSourceConfig,
    private readonly connect: Connect = (url, options) => mqtt.connect(url, options),
  ) {}

  /** Called on every (re)connect: sessionPresent = the broker kept our session, so queued messages follow. */
  onConnect: ((sessionPresent: boolean) => void) | null = null
  onDisconnect: (() => void) | null = null

  async start(onMessage: (m: IncomingMessage) => void, onStatus: (s: Partial<SourceStatus>) => void): Promise<void> {
    // checked here as well as in Settings: a saved config is restarted without going through the form
    const problem = brokerUrlProblem(this.config.url)
    if (problem) {
      onStatus({ state: 'error', detail: `broker URL refused: ${problem}` })
      return
    }
    const persistent = (this.config.persistentSessionSeconds ?? 0) > 0
    const options: IClientOptions = {
      protocolVersion: 5,
      clientId: this.config.clientId || `fmde-hub-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')}`,
      username: this.config.username || undefined,
      password: this.config.password || undefined,
      clean: !persistent,
      properties: {
        maximumPacketSize: MAX_PACKET_BYTES,
        ...(persistent ? { sessionExpiryInterval: this.config.persistentSessionSeconds } : {}),
      },
      // lost connections are retried every 5 s; refused ones are handled in 'error' below
      reconnectPeriod: 5000,
      reconnectOnConnackError: false,
      connectTimeout: 15_000,
    }
    // comma-separated filters
    const topic = this.config.topic || DEFAULT_TOPIC_FILTERS
    const filters = topic.split(',').map((t) => t.trim()).filter(Boolean)
    onStatus({ state: 'connecting', detail: this.config.url })
    const client = this.connect(this.config.url, options)
    this.client = client
    let received = 0

    client.on('connect', (connack) => {
      onStatus({ state: 'connected', detail: `${this.config.url} (${topic})` })
      this.onConnect?.(connack.sessionPresent)
      // Retain As Published: the broker keeps the publisher's retain flag on live delivery, so
      // METADATA_NOT_RETAINED can be checked. QoS 1 so a persistent session queues messages.
      client.subscribe(Object.fromEntries(filters.map((t) => [t, { qos: 1 as const, rap: true }])), (err, granted) => {
        if (err) onStatus({ state: 'error', detail: `subscribe failed: ${err.message}` })
        else if (granted?.some((g) => g.qos >= 128)) onStatus({ state: 'error', detail: `subscription to ${topic} refused (check the ACL)` })
        else if (persistent && granted?.some((g) => g.qos === 0)) {
          // the broker downgraded to QoS 0: a persistent session then queues nothing while disconnected
          const downgraded = granted.filter((g) => g.qos === 0).map((g) => g.topic).join(', ')
          onStatus({ state: 'connected', detail: `${this.config.url}: the broker granted QoS 0 for ${downgraded}, so messages are not queued while disconnected` })
        }
      })
    })
    client.on('message', (msgTopic, payload, packet) => {
      received++
      const receivedAt = new Date().toISOString()
      onMessage({
        topic: msgTopic,
        payload: new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength).slice(),
        // as published: the subscription uses MQTT 5 Retain As Published (rap), so the broker does not
        // clear the flag on live delivery and METADATA_NOT_RETAINED / DATA_RETAINED can be checked
        retain: packet.retain,
        receivedAt,
      })
      onStatus({ received, lastMessageAt: receivedAt })
    })
    client.on('reconnect', () => onStatus({ state: 'connecting', detail: `reconnecting to ${this.config.url}` }))
    client.on('close', () => this.onDisconnect?.())
    client.on('offline', () => onStatus({ state: 'connecting', detail: 'offline' }))
    client.on('error', (err) => {
      const code = (err as { code?: unknown }).code
      if (typeof code === 'number' && TRANSIENT_REFUSALS.has(code)) {
        // mqtt.js does not retry a refused connection (reconnectOnConnackError: false): retry these ourselves
        onStatus({ state: 'error', detail: `${err.message}; retrying in ${REFUSAL_RETRY_MS / 1000} s` })
        this.retry ??= setTimeout(() => {
          this.retry = null
          if (this.client === client) client.reconnect()
        }, REFUSAL_RETRY_MS)
      } else if (typeof code === 'number' && code >= 128) {
        // a final refusal (bad credentials, not authorized, banned, …): mqtt.js stops; say what to do
        onStatus({ state: 'error', detail: `${err.message}: check the broker settings, then connect again` })
      } else {
        onStatus({ state: 'error', detail: err.message })
      }
    })
  }

  async stop(): Promise<void> {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    const c = this.client
    this.client = null
    if (c) await c.endAsync()
  }
}

<script setup lang="ts">
import { formatTime, mapboxStyleUrlProblem, mapboxTokenProblem } from '@fmde-hub/components'
import type { MqttSourceConfig } from '@fmde-hub/ingest'
import { brokerUrlProblem, DEFAULT_EXCLUDE_GROUPS, DEFAULT_TOPIC_FILTERS } from '@fmde-hub/ingest'
import { computed, onMounted, ref } from 'vue'
import { currentVfs, getDb, opfsAhpSupported, sendControl, setVfs, type Vfs } from '../db/client'
import { runtimeConfig } from '../runtime-config'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()

// --- source: MQTT ---
// 8 random hex digits: "fmde-hub-" + 8 stays within the 23 characters every MQTT broker must accept
const shortId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')
/**
 * A client ID per database: tabs on different storage (e.g. ?memory beside a normal tab) each run a
 * hub, and two connections with one client ID would keep taking the session from each other.
 * IndexedDB keeps the original key, so existing sessions resume; in-memory gets a new ID each load.
 */
function stableClientId(): string {
  const vfs = currentVfs()
  if (vfs === 'memory') return `fmde-hub-${shortId()}`
  const key = vfs === 'idb' ? 'fmde-hub.clientId' : `fmde-hub.clientId.${vfs}`
  try {
    let id = localStorage.getItem(key)
    if (!id) {
      id = `fmde-hub-${shortId()}`
      localStorage.setItem(key, id)
    }
    return id
  } catch {
    return `fmde-hub-${shortId()}`
  }
}
const mqtt = ref<MqttSourceConfig>({ url: '', username: '', password: '', topic: DEFAULT_TOPIC_FILTERS, excludeGroups: DEFAULT_EXCLUDE_GROUPS, clientId: stableClientId(), persistentSessionSeconds: 86400 })
const persistent = ref(true)

// --- thresholds and storage ---
const settings = ref<Record<string, number>>({})
const vfs = ref<Vfs>(currentVfs())
const activeVfs = currentVfs()
const usage = ref<{ usage?: number; quota?: number; persisted?: boolean }>({})
const busy = ref(false)

// --- basemap: a Mapbox style (raster tiles), kept in this browser's preferences ---
const mapboxStyleUrl = ref(ui.prefs.mapboxStyleUrl)
const mapboxToken = ref(ui.prefs.mapboxToken)
const mapboxProblems = computed(() => ({ url: mapboxStyleUrlProblem(mapboxStyleUrl.value), token: mapboxTokenProblem(mapboxToken.value) }))

function saveBasemap(use: boolean) {
  if (use && (mapboxProblems.value.url || mapboxProblems.value.token)) return
  ui.prefs.mapboxStyleUrl = use ? mapboxStyleUrl.value.trim() : ''
  ui.prefs.mapboxToken = use ? mapboxToken.value.trim() : ''
  if (!use) mapboxStyleUrl.value = mapboxToken.value = ''
  ui.savePrefs()
  message.value = use ? 'The maps now use the Mapbox basemap.' : 'The maps use the default basemap again.'
}
const message = ref<string | null>(null)

onMounted(async () => {
  // a deployment's broker settings (config.json) as the starting point; a saved source wins
  const cfg = await runtimeConfig()
  if (cfg?.mqtt) mqtt.value = { ...mqtt.value, ...cfg.mqtt }
  const db = await getDb()
  const res = await db.query<{ key: string; value: unknown }>(`select key, value from fmdehub_setting`)
  for (const r of res.rows) {
    if (typeof r.value === 'number') settings.value[r.key] = r.value
    if (r.key === 'source' && (r.value as { kind: string }).kind === 'mqtt') {
      mqtt.value = { ...mqtt.value, ...(r.value as { mqtt: MqttSourceConfig }).mqtt }
    }
  }
  await refreshUsage()
})

async function refreshUsage() {
  if (!navigator.storage) return
  const est = await navigator.storage.estimate()
  usage.value = { usage: est.usage, quota: est.quota, persisted: await navigator.storage.persisted?.() }
}

async function requestPersist() {
  const ok = await navigator.storage?.persist?.()
  message.value = ok ? 'Storage is persistent: the browser will not evict it under pressure.' : 'The browser declined persistent storage.'
  await refreshUsage()
}

function connect() {
  sendControl({
    type: 'start',
    persist: true,
    config: {
      kind: 'mqtt',
      mqtt: { ...mqtt.value, persistentSessionSeconds: persistent.value ? mqtt.value.persistentSessionSeconds : 0 },
    },
  })
}

/** Accepted values: an empty field or 0 must never reach the database (retentionDays 0 would empty it). */
const SETTING_LIMITS: Record<string, { min: number; integer?: boolean }> = {
  silentAfterSeconds: { min: 60 },
  retentionDays: { min: 1, integer: true },
  futureToleranceSeconds: { min: 0 },
}

async function saveSetting(key: string) {
  const value = settings.value[key] as unknown
  const limit = SETTING_LIMITS[key] ?? { min: 0 }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < limit.min || (limit.integer && !Number.isInteger(value))) {
    message.value = `${key} must be ${limit.integer ? 'a whole number' : 'a number'} of at least ${limit.min}.`
    return
  }
  const db = await getDb()
  await db.query(`update fmdehub_setting set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
  message.value = `Saved ${key}.`
}

async function backup() {
  busy.value = true
  try {
    const db = await getDb()
    const blob = await db.dumpDataDir('gzip')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fmde-hub-${new Date().toISOString().slice(0, 10)}.tar.gz`
    a.click()
    URL.revokeObjectURL(a.href)
  } finally {
    busy.value = false
  }
}

function reset() {
  if (confirm('Delete all nodes, metadata, observations and messages from this browser? This cannot be undone.')) sendControl({ type: 'reset' })
}

function switchVfs() {
  setVfs(vfs.value)
  location.reload()
}

const mb = (n?: number) => (n === undefined ? '—' : `${(n / 1024 / 1024).toFixed(1)} MB`)
</script>

<template>
  <v-snackbar :model-value="!!message" timeout="4000" @update:model-value="message = null">{{ message }}</v-snackbar>

  <v-row>
    <v-col cols="12" lg="6">
      <v-card variant="outlined" class="mb-4">
        <v-card-title>Source status</v-card-title>
        <v-card-text>
          <div><b>{{ ui.source.source ?? 'none' }}</b> · {{ ui.source.state }} · {{ ui.source.received }} message(s)</div>
          <div v-if="ui.source.notStored" class="text-warning">
            {{ ui.source.notStored }} message(s) could not be stored (see the message inspector and the browser console)
          </div>
          <div v-if="ui.source.detail" class="text-medium-emphasis">{{ ui.source.detail }}</div>
          <div v-if="ui.source.lastMessageAt" class="text-medium-emphasis">last message {{ formatTime(ui.source.lastMessageAt, ui.prefs.utc) }}</div>
        </v-card-text>
        <v-card-actions>
          <v-btn variant="tonal" prepend-icon="mdi-stop" :disabled="!ui.source.source" @click="sendControl({ type: 'stop' })">Stop source</v-btn>
        </v-card-actions>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title>MQTT broker</v-card-title>
        <v-card-subtitle>MQTT 5 over WebSockets (wss://). Use read-only credentials limited to subscribing on {{ DEFAULT_TOPIC_FILTERS }} (the FMDE hierarchy and the legacy POC1 one).</v-card-subtitle>
        <v-card-text>
          <v-text-field
            v-model="mqtt.url"
            label="Broker URL"
            placeholder="wss://broker.example.org:8884/mqtt"
            density="compact"
            :error-messages="mqtt.url && brokerUrlProblem(mqtt.url) ? [brokerUrlProblem(mqtt.url)!] : []"
          />
          <v-row dense>
            <v-col cols="12" sm="6"><v-text-field v-model="mqtt.username" label="Username" density="compact" autocomplete="username" /></v-col>
            <v-col cols="12" sm="6"><v-text-field v-model="mqtt.password" label="Password or token" type="password" density="compact" autocomplete="current-password" /></v-col>
          </v-row>
          <v-text-field v-model="mqtt.topic" label="Topic filters (comma-separated)" density="compact" />
          <v-text-field
            v-model="mqtt.excludeGroups"
            label="Exclude groups (comma-separated)"
            hint="Messages from these groups are ignored, and what is already stored for them is deleted on connect"
            persistent-hint
            density="compact"
            class="mt-2"
          />
          <v-switch v-model="persistent" label="Persistent session (broker queues QoS 1 messages while no tab is open)" color="primary" density="compact" hide-details />
          <v-text-field v-model="mqtt.clientId" label="Client ID (stable, so the session can resume)" density="compact" class="mt-2" />
          <v-alert type="info" variant="tonal" density="compact" class="mt-2">
            The connection settings, including the password, are stored in this browser's database so that a new leader tab can reconnect.
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-lan-connect" :disabled="brokerUrlProblem(mqtt.url) !== null" @click="connect">Connect</v-btn>
        </v-card-actions>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title>Basemap</v-card-title>
        <v-card-subtitle>Optional: a Mapbox style instead of the default OpenFreeMap map.</v-card-subtitle>
        <v-card-text>
          <v-text-field
            v-model="mapboxStyleUrl"
            label="Mapbox style URL"
            placeholder="mapbox://styles/<user>/<style>"
            :error-messages="mapboxStyleUrl && mapboxProblems.url ? [mapboxProblems.url] : []"
            density="compact"
          />
          <v-text-field
            v-model="mapboxToken"
            label="Mapbox public access token (pk.…)"
            type="password"
            autocomplete="off"
            :error-messages="mapboxToken && mapboxProblems.token ? [mapboxProblems.token] : []"
            density="compact"
          />
          <v-alert type="info" variant="tonal" density="compact">
            Stored in this browser only, and sent to Mapbox with every map tile. Anyone using this browser can read it,
            so use a public token restricted to this site's URL in your Mapbox account.
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-map-outline" :disabled="!!mapboxProblems.url || !!mapboxProblems.token" @click="saveBasemap(true)">Use this basemap</v-btn>
          <v-btn variant="tonal" :disabled="!ui.prefs.mapboxStyleUrl" @click="saveBasemap(false)">Use the default</v-btn>
        </v-card-actions>
      </v-card>

    </v-col>

    <v-col cols="12" lg="6">
      <v-card variant="outlined" class="mb-4">
        <v-card-title>Node state thresholds</v-card-title>
        <v-card-subtitle>A node is Silent when no data message arrived for longer than silentAfterSeconds, else OK. A node's hub configuration can override it.</v-card-subtitle>
        <v-card-text>
          <v-text-field v-for="k in ['silentAfterSeconds', 'retentionDays', 'futureToleranceSeconds']" :key="k" v-model.number="settings[k]" :label="k" type="number" density="compact">
            <template #append><v-btn size="small" variant="tonal" @click="saveSetting(k)">Save</v-btn></template>
          </v-text-field>
        </v-card-text>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title>Display</v-card-title>
        <v-card-text>
          <v-switch v-model="ui.prefs.utc" label="Show times in UTC" color="primary" density="compact" hide-details @update:model-value="ui.savePrefs()" />
        </v-card-text>
      </v-card>

      <v-card variant="outlined">
        <v-card-title>Storage</v-card-title>
        <v-card-text>
          <div>In use: <b>{{ activeVfs }}</b> · {{ mb(usage.usage) }} of {{ mb(usage.quota) }} · {{ usage.persisted ? 'persistent' : 'may be evicted' }}</div>
          <v-radio-group v-model="vfs" density="compact" hide-details class="mt-2">
            <v-radio label="IndexedDB (default, all browsers)" value="idb" />
            <v-radio label="OPFS access handle pool (faster; Chromium and Firefox)" value="opfs-ahp" :disabled="!opfsAhpSupported()" />
            <v-radio label="In memory (lost on reload)" value="memory" />
          </v-radio-group>
          <div class="text-caption text-medium-emphasis">Each storage option is a separate database. Switching reloads the app.</div>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn variant="tonal" :disabled="vfs === activeVfs" @click="switchVfs">Switch</v-btn>
          <v-btn variant="tonal" :disabled="usage.persisted" @click="requestPersist">Request persistence</v-btn>
          <v-btn variant="tonal" prepend-icon="mdi-download" :loading="busy" @click="backup">Backup</v-btn>
          <v-btn variant="text" color="error" prepend-icon="mdi-delete-outline" @click="reset">Clear data</v-btn>
        </v-card-actions>
      </v-card>
    </v-col>
  </v-row>
</template>

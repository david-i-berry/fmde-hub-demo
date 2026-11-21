<script setup lang="ts">
import {
  FMDEhubArrivalStrip,
  FMDEhubAtsReport,
  FMDEhubMetadataPanel,
  FMDEhubParamChart,
  FMDEhubParamTable,
  FMDEhubConformanceChip,
  FMDEhubStateChip,
  FMDEhubTextProto,
  formatAge,
  formatDuration,
  formatTime,
} from '@fmde-hub/components'
import { CODE_INFO, decodeMessage, evaluateAts, normaliseMetadata, toTextProto, type ConformanceCode, type NodeHubConfig, type SeriesKey } from '@fmde-hub/fmde'
import { computed, nextTick, ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import {
  useCurrentMetadata,
  useIssues,
  useLatestValues,
  useMessages,
  useMetadataVersions,
  useNodeStatus,
  useSeries,
} from '../composables/fmde-hub'
import { CHANGE_CHANNEL } from '@fmde-hub/db'
import { useQuery } from '../composables/useQuery'
import { getDb } from '../db/client'
import { features } from '../runtime-config'
import { useTimeWindow, useUiStore } from '../stores/ui'

const props = defineProps<{ group: string; node: string }>()
const nodeKey = computed(() => `${props.group}/${props.node}`)

const ui = useUiStore()
const w = useTimeWindow()
const theme = useTheme()
const dark = computed(() => theme.current.value.dark)
const tab = ref<'overview' | 'messages' | 'metadata' | 'issues'>('overview')

const { rows: allStatus } = useNodeStatus()
const status = computed(() => allStatus.value.find((s) => s.nodeKey === nodeKey.value) ?? null)
const { metadata, raw: rawMetadata } = useCurrentMetadata(nodeKey)

// hub configuration: parameters whose empty values are expected (not data loss)
const { rows: hubRows, refresh: refreshHub } = useQuery<{ hub_config: NodeHubConfig }>('select hub_config from node where node_key = $1', () => [nodeKey.value])
const expectedEmpty = computed(() => hubRows.value[0]?.hub_config.expectedEmpty ?? [])
async function toggleExpectedEmpty(longName: string) {
  const next = expectedEmpty.value.includes(longName) ? expectedEmpty.value.filter((n) => n !== longName) : [...expectedEmpty.value, longName]
  const db = await getDb()
  await db.query(`update node set hub_config = jsonb_set(hub_config, '{expectedEmpty}', $2::jsonb) where node_key = $1`, [nodeKey.value, JSON.stringify(next)])
  await db.query(`select pg_notify($1, 'hub_config')`, [CHANGE_CHANNEL]) // status, map and tables refresh
  await refreshHub()
}

const { rows: versions } = useMetadataVersions(nodeKey)
const { latest } = useLatestValues(nodeKey)
const { series, observed } = useSeries(nodeKey)
const { rows: messages } = useMessages(nodeKey)
const { rows: issues } = useIssues(nodeKey, 2000)

const issueCounts = computed(() => {
  const counts = new Map<ConformanceCode, number>()
  for (const i of issues.value) counts.set(i.code, (counts.get(i.code) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
})
// FMDE abstract test suite: metadata and topic tests on the current metadata version, data tests
// from the issues recorded on data messages in the window.
const atsResults = computed(() => {
  const md = metadata.value
  const raw = rawMetadata.value
  const metadataIssues = raw && md
    ? normaliseMetadata(raw, { nodeKey: nodeKey.value, group: props.group, nodeId: props.node, topic: md.node.topic, version: md.version, receivedAt: md.receivedAt, contentHash: md.contentHash, rawBytes: md.rawBytes }).issues
    : []
  return evaluateAts({
    topic: { topic: md?.node.topic ?? `firstmile/a/${nodeKey.value}`, group: props.group, nodeId: props.node },
    metadata: raw,
    metadataIssues,
    dataIssues: issues.value.filter((i) => i.kind !== 'metadata').map((i) => ({ code: i.code, detail: i.detail })),
    dataMessages: status.value?.messages ?? 0,
  })
})
const atsFailures = computed(() => atsResults.value.filter((r) => r.status === 'fail').length)

const fromIso = computed(() => w.from.value.toISOString())
const toIso = computed(() => w.to.value.toISOString())
// numeric series get a chart; a parameter with nothing in the window keeps an empty card
// rather than disappearing (non-numeric values with data have no chart, as before)
const charted = computed(() => (metadata.value?.parameters ?? []).filter((p) => series.value.has(p.seriesKey) || !observed.value.has(p.seriesKey)))

// --- decoded message: latest, or the one picked on the arrival strip ---
/** The picked message's id; null = the latest. By id, since positions shift as the window moves. */
const selectedId = ref<string | null>(null)
const selected = computed(() => (selectedId.value === null ? messages.value.at(-1) : messages.value.find((m) => m.id === selectedId.value)) ?? null)
// the picked message has left the window: show the latest again, rather than an empty panel
watch(messages, (ms) => {
  if (selectedId.value !== null && !ms.some((m) => m.id === selectedId.value)) selectedId.value = null
})
const decoded = ref<string>('')
watch(
  () => [selected.value?.id, versions.value.length],
  async () => {
    const m = selected.value
    if (!m) return void (decoded.value = '')
    const db = await getDb()
    const res = await db.query<{ raw: Uint8Array }>('select raw from data_message where id = $1', [m.id])
    const raw = res.rows[0]?.raw
    if (!raw) return
    const md = versions.value.find((v) => v.version === m.metadataVersion) ?? null
    try {
      decoded.value = toTextProto(decodeMessage(raw), md)
    } catch (e) {
      decoded.value = `# could not decode: ${e instanceof Error ? e.message : String(e)}`
    }
  },
  { immediate: true },
)

const chartRefs = new Map<SeriesKey, Element>()
async function focusParam(seriesKey: SeriesKey) {
  tab.value = 'overview'
  await nextTick()
  chartRefs.get(seriesKey)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const allMessageHeaders = [
  { title: 'Received', key: 'receivedAt' },
  { title: 'Observations', key: 'observations', align: 'end' as const },
  { title: 'Latency', key: 'latencySeconds', align: 'end' as const },
  { title: 'Reaches back', key: 'spanSeconds', align: 'end' as const },
  { title: 'Empty', key: 'emptyValues', align: 'end' as const },
  { title: 'Bytes', key: 'payloadBytes', align: 'end' as const },
  { title: 'Issues', key: 'issues' },
]
const messageHeaders = computed(() => (features.hideConformance ? allMessageHeaders.filter((h) => h.key !== 'issues') : allMessageHeaders))
</script>

<template>
  <div class="d-flex align-center flex-wrap ga-3 mb-4">
    <v-btn icon="mdi-arrow-left" variant="text" :to="{ name: 'status', query: $route.query }" title="Back to status board" />
    <div>
      <div class="text-h5">{{ metadata?.node.name || status?.name || node }}</div>
      <div class="text-body-2 text-medium-emphasis">{{ nodeKey }}</div>
    </div>
    <FMDEhubStateChip v-if="status" :state="status.state" size="default" />
    <FMDEhubConformanceChip v-if="status && !features.hideConformance" :conformance="status.conformance" size="default" />
    <v-spacer />
  </div>

  <v-row dense class="mb-2">
    <v-col v-for="s in [
      { label: 'Last seen', value: formatAge(status?.lastSeenAgeSeconds) },
      { label: 'Messages in window', value: status?.messages ?? 0 },
      { label: 'Median latency', value: formatDuration(status?.medianLatencySeconds) },
      { label: 'Longest backlog', value: formatDuration(status?.maxSpanSeconds) },
      { label: 'Empty values', value: status?.emptyValues ?? 0 },
      { label: 'Undecoded', value: status?.lostData ?? 0 },
    ]" :key="s.label" cols="6" sm="4" md="2">
      <v-card variant="outlined"><v-card-text>
        <div class="text-h6">{{ s.value }}</div>
        <div class="text-caption text-medium-emphasis">{{ s.label }}</div>
      </v-card-text></v-card>
    </v-col>
  </v-row>

  <v-tabs v-model="tab" class="mb-4">
    <v-tab value="overview">Parameters</v-tab>
    <v-tab value="messages">Messages</v-tab>
    <v-tab value="metadata">Metadata</v-tab>
    <v-tab v-if="!features.hideConformance" value="issues">Conformance <v-badge v-if="atsFailures" :content="atsFailures" color="error" inline /></v-tab>
  </v-tabs>

  <v-alert v-if="!metadata && status" type="warning" variant="tonal" class="mb-4">
    No metadata received for this node, so its data cannot be decoded. Metadata must be published with the retained flag.
  </v-alert>

  <v-window v-model="tab">
    <v-window-item value="overview">
      <FMDEhubParamTable
        v-if="metadata"
        :metadata="metadata"
        :latest="latest"
        :utc="ui.prefs.utc"
        :expected-empty="expectedEmpty"
        @select:param="focusParam"
        @toggle:expected-empty="toggleExpectedEmpty"
      />
      <v-row v-if="charted.length">
        <v-col v-for="p in charted" :key="p.seriesKey" cols="12" md="6" xl="4">
          <v-card :ref="(el) => el && chartRefs.set(p.seriesKey, (el as { $el: Element }).$el)" variant="outlined">
            <v-card-text>
              <FMDEhubParamChart :parameter="p" :points="series.get(p.seriesKey) ?? []" :from="fromIso" :to="toIso" :dark="dark" :utc="ui.prefs.utc" />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-window-item>

    <v-window-item value="messages">
      <v-card variant="outlined" class="mb-4">
        <v-card-title>Message arrival</v-card-title>
        <v-card-text>
          <FMDEhubArrivalStrip :messages="messages" :from="fromIso" :to="toIso" :dark="dark" :utc="ui.prefs.utc" @select:message="(id) => (selectedId = id)" />
        </v-card-text>
      </v-card>
      <v-row>
        <v-col cols="12" xxl="7">
          <v-card variant="outlined">
            <v-card-title>Data messages</v-card-title>
            <v-data-table
              :headers="messageHeaders"
              :items="[...messages].reverse()"
              density="compact"
              :items-per-page="25"
              hover
              @click:row="(_e: unknown, { item }: { item: { id: string } }) => (selectedId = item.id)"
            >
              <template #item.receivedAt="{ item }">{{ formatTime(item.receivedAt, ui.prefs.utc) }}</template>
              <template #item.latencySeconds="{ item }">{{ formatDuration(item.latencySeconds) }}</template>
              <template #item.spanSeconds="{ item }">{{ formatDuration(item.spanSeconds) }}</template>
              <template #item.issues="{ item }">
                <v-chip v-for="i in item.issues" :key="i.code" size="x-small" color="error" variant="tonal" class="me-1" :title="i.detail">{{ i.code }}</v-chip>
              </template>
            </v-data-table>
          </v-card>
        </v-col>
        <v-col cols="12" xxl="5">
          <v-card variant="outlined">
            <v-card-title>{{ selectedId === null ? 'Latest' : 'Selected' }} message, decoded</v-card-title>
            <v-card-subtitle v-if="selected">
              received {{ formatTime(selected.receivedAt, ui.prefs.utc) }} · metadata v{{ selected.metadataVersion ?? '—' }} · {{ selected.payloadBytes }} bytes
            </v-card-subtitle>
            <v-card-text><FMDEhubTextProto :text="decoded || 'No data messages in this window.'" /></v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-window-item>

    <v-window-item value="metadata">
      <FMDEhubMetadataPanel v-if="metadata" :metadata="metadata" :utc="ui.prefs.utc" class="mb-4" />
      <v-card variant="outlined">
        <v-card-title>Metadata versions</v-card-title>
        <v-card-subtitle>A new version is recorded only when the content changes; identical republishes are not versions.</v-card-subtitle>
        <v-list density="compact">
          <v-list-item
            v-for="v in versions"
            :key="v.version"
            :title="`v${v.version} · ${formatTime(v.receivedAt, ui.prefs.utc)}`"
            :subtitle="`${v.node.firmwareVersion ? `firmware ${v.node.firmwareVersion} · ` : ''}${v.observers.length} observer(s), ${v.parameters.length} parameter(s), ${v.rawBytes} bytes`"
          />
        </v-list>
      </v-card>
    </v-window-item>

    <v-window-item v-if="!features.hideConformance" value="issues">
      <FMDEhubAtsReport :results="atsResults" class="mb-6" />

      <div class="text-h6 mb-2">Issue log</div>
      <div class="text-caption text-medium-emphasis mb-2">Every issue recorded in this window, including hub checks that no ATS test covers.</div>
      <div v-if="issues.length" class="d-flex flex-wrap ga-2 mb-3">
        <v-chip
          v-for="[code, n] in issueCounts"
          :key="code"
          :color="CODE_INFO[code].severity === 'error' ? 'error' : 'warning'"
          variant="tonal"
          label
          prepend-icon="mdi-alert-octagon-outline"
          :title="`${CODE_INFO[code].description} (${CODE_INFO[code].requirement})`"
        >
          {{ code }} × {{ n }}
        </v-chip>
      </div>
      <v-expansion-panels v-if="issues.length" variant="accordion">
        <v-expansion-panel :title="`Show ${Math.min(issues.length, 200)} of ${issues.length} issue(s), newest first`">
          <v-expansion-panel-text>
      <v-list density="compact" lines="two">
        <v-list-item
          v-for="i in issues.slice(0, 200)"
          :key="i.id"
          :title="`${i.code} (${i.kind}) · ${CODE_INFO[i.code].requirement}`"
          :subtitle="`${formatTime(i.receivedAt, ui.prefs.utc)} — ${i.detail}`"
          prepend-icon="mdi-alert-octagon-outline"
        />
      </v-list>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
      <div v-else class="text-medium-emphasis"><v-icon icon="mdi-check" /> No conformance issues in this window</div>
    </v-window-item>
  </v-window>
</template>

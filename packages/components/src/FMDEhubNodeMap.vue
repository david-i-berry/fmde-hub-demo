<script setup lang="ts">
// Live node map: nodes coloured by state, last seen or battery voltage, with clustering.
// Observer devices with their own Location are drawn at their position with a connector; when they
// share the node's position (typically differing only in height), they fan out around it at a fixed
// screen offset, from zoom 11. Hover shows height and reference surface; click opens the node.
import type { Location, NodeKey } from '@fmde-hub/fmde'
import * as maplibregl from 'maplibre-gl'
import type { ErrorEvent, GeoJSONSource, Map as MlMap, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { MAPBOX_SOURCE } from './basemap'
import { formatAge } from './format'
import { esc } from './html'
import type { NetworkNode } from './network'
import { STATE_HEX, STATE_META, STATE_ORDER, STATE_RANK } from './state'

maplibregl.setWorkerUrl(workerUrl)

export type MapLayer = 'state' | 'lastSeen' | 'battery'

const props = withDefaults(
  defineProps<{
    network: NetworkNode[]
    dark?: boolean
    height?: string
    compact?: boolean
    styleUrl?: string
    darkStyleUrl?: string
    /** A custom basemap (e.g. mapboxBasemap()), used in light and dark mode instead of the styles above. */
    basemap?: StyleSpecification | null
  }>(),
  {
    dark: false,
    height: '70vh',
    compact: false,
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
    darkStyleUrl: 'https://tiles.openfreemap.org/styles/dark',
    basemap: null,
  },
)
const emit = defineEmits<{ 'select:node': [nodeKey: NodeKey] }>()
const layer = defineModel<MapLayer>('layer', { default: 'state' })

// Sequential ramps (reference blue), separate steps for light and dark surfaces.
const RAMP_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281']
const RAMP_DARK = ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4']
const NO_DATA = '#898781'
const ramp = computed(() => (props.dark ? RAMP_DARK : RAMP_LIGHT))
const AGE_BUCKETS = [
  { max: 15 * 60, label: '≤ 15 min' },
  { max: 30 * 60, label: '≤ 30 min' },
  { max: 3600, label: '≤ 1 h' },
  { max: 6 * 3600, label: '≤ 6 h' },
  { max: Infinity, label: '> 6 h' },
]
/** Battery voltage of a 12 V system (lead-acid): below 11.5 V is close to empty. */
const BATTERY_BUCKETS = [
  { max: 11.5, label: '< 11.5 V' },
  { max: 12.0, label: '< 12.0 V' },
  { max: 12.5, label: '< 12.5 V' },
  { max: 13.0, label: '< 13.0 V' },
  { max: Infinity, label: '≥ 13.0 V' },
]

function colourFor(n: NetworkNode): string {
  if (layer.value === 'state') return STATE_HEX[n.status.state]
  if (layer.value === 'lastSeen') {
    const age = n.status.lastSeenAgeSeconds
    return age === null ? NO_DATA : ramp.value[AGE_BUCKETS.findIndex((b) => age <= b.max)]!
  }
  const v = n.battery?.value
  return v === undefined ? NO_DATA : ramp.value[BATTERY_BUCKETS.findIndex((b) => v < b.max)]!
}

const hasPosition = (l?: Location): l is Location & { latitude: number; longitude: number } => l?.latitude !== undefined && l.longitude !== undefined
const located = computed(() => props.network.filter((n) => hasPosition(n.metadata?.node.location)))
const unlocated = computed(() => props.network.filter((n) => !hasPosition(n.metadata?.node.location)))

function metres(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const SURFACE: Record<string, string> = { MSL: 'mean sea level', GEOID: 'geoid', GL: 'ground level', REFERENCE_ELLIPSOID: 'reference ellipsoid', PRESSURE_1000_HPA: '1000 hPa level', UNSPECIFIED: 'unspecified surface' }
const heightText = (l: Location) => `${l.heightMetres} m above ${SURFACE[l.referenceSurface] ?? l.referenceSurface}`

function featureCollections() {
  const nodes: Feature[] = []
  const observers: Feature[] = []
  const connectors: Feature[] = []
  const nearby: { nodeKey: string; lonLat: [number, number]; items: { name: string; text: string }[] }[] = []
  for (const n of located.value) {
    const loc = n.metadata!.node.location as Location & { latitude: number; longitude: number }
    const at: [number, number] = [loc.longitude, loc.latitude]
    nodes.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: at },
      properties: { nodeKey: n.status.nodeKey, name: n.metadata!.node.name || n.status.nodeId, state: n.status.state, rank: STATE_RANK[n.status.state], colour: colourFor(n) },
    })
    const close: { name: string; text: string }[] = []
    for (const o of n.metadata!.observers) {
      if (!hasPosition(o.location)) continue
      const oAt: [number, number] = [o.location.longitude, o.location.latitude]
      if (metres(at, oAt) < 20) {
        close.push({ name: o.name, text: heightText(o.location) })
        continue
      }
      observers.push({ type: 'Feature', geometry: { type: 'Point', coordinates: oAt }, properties: { nodeKey: n.status.nodeKey, name: o.name, height: heightText(o.location) } })
      connectors.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [at, oAt] }, properties: {} })
    }
    if (close.length) nearby.push({ nodeKey: n.status.nodeKey, lonLat: at, items: close })
  }
  const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })
  return { nodes: fc(nodes), observers: fc(observers), connectors: fc(connectors), nearby }
}

const container = ref<HTMLDivElement>()
const map = shallowRef<MlMap>()
let markers: maplibregl.Marker[] = []
let popup: maplibregl.Popup | null = null
let fitted = false
/** Our sources and layers exist on the current style. Not isStyleLoaded(): that stays false while GeoJSON sources load. */
let layersReady = false
/** Located nodes currently drawn (exposed for tests as data-points). */
const drawnPoints = ref(0)

const clusterColour = (): maplibregl.ExpressionSpecification => [
  'match',
  ['get', 'worst'],
  ...STATE_ORDER.flatMap((s) => [STATE_RANK[s], STATE_HEX[s]]),
  NO_DATA,
] as unknown as maplibregl.ExpressionSpecification

function addLayers(m: MlMap) {
  const data = featureCollections()
  drawnPoints.value = data.nodes.features.length
  const ring = props.dark ? '#1a1a19' : '#fcfcfb'
  const ink = props.dark ? '#f0efec' : '#0b0b0b'
  m.addSource('nodes', {
    type: 'geojson',
    data: data.nodes,
    cluster: true,
    clusterRadius: 40,
    clusterMaxZoom: 9,
    clusterProperties: { worst: ['max', ['get', 'rank']] },
  })
  m.addSource('observers', { type: 'geojson', data: data.observers })
  m.addSource('connectors', { type: 'geojson', data: data.connectors })
  m.addLayer({ id: 'connectors', type: 'line', source: 'connectors', minzoom: 11, paint: { 'line-color': NO_DATA, 'line-width': 1.5, 'line-dasharray': [2, 2] } })
  m.addLayer({ id: 'observers', type: 'circle', source: 'observers', minzoom: 11, paint: { 'circle-radius': 5, 'circle-color': NO_DATA, 'circle-stroke-color': ring, 'circle-stroke-width': 2 } })
  m.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'nodes',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': layer.value === 'state' ? clusterColour() : NO_DATA,
      'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24],
      'circle-stroke-color': ring,
      'circle-stroke-width': 2,
    },
  })
  m.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'nodes',
    filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] },
    paint: { 'text-color': '#ffffff' },
  })
  m.addLayer({
    id: 'nodes',
    type: 'circle',
    source: 'nodes',
    filter: ['!', ['has', 'point_count']],
    paint: { 'circle-color': ['get', 'colour'], 'circle-radius': props.compact ? 7 : 9, 'circle-stroke-color': ring, 'circle-stroke-width': 2 },
  })
  if (!props.compact) {
    m.addLayer({
      id: 'node-labels',
      type: 'symbol',
      source: 'nodes',
      filter: ['!', ['has', 'point_count']],
      minzoom: 4,
      layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'], 'text-optional': true },
      paint: { 'text-color': ink, 'text-halo-color': ring, 'text-halo-width': 1.5 },
    })
  }
  syncMarkers(m, data.nearby)
}

/** Observers sharing the node's position: fanned out at a fixed screen offset with a connector. */
function syncMarkers(m: MlMap, nearby: ReturnType<typeof featureCollections>['nearby']) {
  markers.forEach((mk) => mk.remove())
  markers = []
  if (props.compact) return
  for (const n of nearby) {
    n.items.forEach((o, i) => {
      const angle = -Math.PI / 4 + (i * Math.PI) / 4
      const dx = Math.round(Math.cos(angle) * 34)
      const dy = Math.round(Math.sin(angle) * 34)
      const el = document.createElement('div')
      el.className = 'fmde-hub-observer-marker'
      el.title = `${o.name}\nsame position as the node, ${o.text}`
      el.innerHTML = `<svg width="80" height="80" viewBox="-40 -40 80 80" aria-hidden="true"><line x1="0" y1="0" x2="${dx}" y2="${dy}" stroke="${NO_DATA}" stroke-width="1.5" stroke-dasharray="3 3"/><circle cx="${dx}" cy="${dy}" r="5" style="pointer-events:all;cursor:help" fill="${NO_DATA}" stroke="${props.dark ? '#1a1a19' : '#fcfcfb'}" stroke-width="2"/></svg>`
      markers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(n.lonLat).addTo(m))
    })
  }
  updateMarkerVisibility(m)
}

function updateMarkerVisibility(m: MlMap) {
  const show = m.getZoom() >= 11
  for (const mk of markers) mk.getElement().style.display = show ? '' : 'none'
}

function refresh() {
  const m = map.value
  if (!m || !layersReady || !m.getSource('nodes')) return
  const data = featureCollections()
  drawnPoints.value = data.nodes.features.length
  ;(m.getSource('nodes') as GeoJSONSource).setData(data.nodes)
  ;(m.getSource('observers') as GeoJSONSource).setData(data.observers)
  ;(m.getSource('connectors') as GeoJSONSource).setData(data.connectors)
  m.setPaintProperty('clusters', 'circle-color', layer.value === 'state' ? clusterColour() : NO_DATA)
  syncMarkers(m, data.nearby)
  fitOnce(m)
}

function fitOnce(m: MlMap) {
  if (fitted || located.value.length === 0) return
  const b = new maplibregl.LngLatBounds()
  for (const n of located.value) b.extend([n.metadata!.node.location!.longitude!, n.metadata!.node.location!.latitude!])
  m.fitBounds(b, { padding: props.compact ? 30 : 80, maxZoom: 11, duration: 0 })
  fitted = true
}

function nodeByKey(key: string) {
  return props.network.find((n) => n.status.nodeKey === key)
}

function popupHtml(n: NetworkNode): string {
  const loc = n.metadata?.node.location
  const lines = [
    `<b>${esc(n.metadata?.node.name || n.status.nodeId)}</b>`,
    `<span style="opacity:.75">${esc(n.status.nodeKey)}</span>`,
    `${esc(STATE_META[n.status.state].label)} · last seen ${esc(formatAge(n.status.lastSeenAgeSeconds))}`,
    loc ? esc(heightText(loc)) : '',
    n.battery ? `battery ${esc(n.battery.value.toFixed(2))} ${esc(n.battery.unit)}` : '',
  ]
  return lines.filter(Boolean).join('<br>')
}

const currentStyle = () => props.basemap ?? (props.dark ? props.darkStyleUrl : props.styleUrl)
/** Why the custom basemap's tiles are not shown (e.g. the token is refused), or null. */
const basemapError = ref<string | null>(null)

function onMapError(e: ErrorEvent & { sourceId?: string }) {
  if (e.sourceId !== MAPBOX_SOURCE) return
  // the status only: the error's message holds the tile URL, and with it the token
  const status = (e.error as { status?: number }).status
  basemapError.value =
    status === 401 || status === 403
      ? `Mapbox refused the basemap (HTTP ${status}): check the token, its URL restrictions and the style URL in Settings.`
      : status === 404
        ? 'Mapbox does not know this style (HTTP 404): check the style URL in Settings.'
        : `The basemap tiles could not be loaded${status ? ` (HTTP ${status})` : ''}.`
}

onMounted(() => {
  const m = new maplibregl.Map({
    container: container.value!,
    style: currentStyle(),
    center: [10, 48],
    zoom: 3,
    attributionControl: { compact: true },
  })
  map.value = m
  m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  m.on('error', onMapError)
  m.on('style.load', () => {
    addLayers(m)
    layersReady = true
    fitOnce(m)
  })
  m.on('zoom', () => updateMarkerVisibility(m))
  m.on('click', 'nodes', (e: MapLayerMouseEvent) => {
    const key = e.features?.[0]?.properties?.nodeKey as string | undefined
    if (key) emit('select:node', key)
  })
  m.on('click', 'clusters', async (e: MapLayerMouseEvent) => {
    const f = e.features?.[0]
    if (!f) return
    const zoom = await (m.getSource('nodes') as GeoJSONSource).getClusterExpansionZoom(f.properties!.cluster_id as number)
    m.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom })
  })
  m.on('mouseenter', 'nodes', (e: MapLayerMouseEvent) => {
    m.getCanvas().style.cursor = 'pointer'
    const key = e.features?.[0]?.properties?.nodeKey as string | undefined
    const n = key ? nodeByKey(key) : undefined
    if (!n) return
    popup?.remove()
    popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'fmde-hub-map-popup' })
      .setLngLat((e.features![0]!.geometry as Point).coordinates as [number, number])
      .setHTML(popupHtml(n))
      .addTo(m)
  })
  m.on('mouseleave', 'nodes', () => {
    m.getCanvas().style.cursor = ''
    popup?.remove()
    popup = null
  })
  m.on('mouseenter', 'clusters', () => (m.getCanvas().style.cursor = 'pointer'))
  m.on('mouseleave', 'clusters', () => (m.getCanvas().style.cursor = ''))
  m.on('mouseenter', 'observers', (e: MapLayerMouseEvent) => {
    const p = e.features?.[0]?.properties
    if (!p) return
    popup?.remove()
    popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'fmde-hub-map-popup' })
      .setLngLat((e.features![0]!.geometry as Point).coordinates as [number, number])
      .setHTML(`<b>${esc(String(p.name))}</b><br>${esc(String(p.height))}`)
      .addTo(m)
  })
  m.on('mouseleave', 'observers', () => {
    popup?.remove()
    popup = null
  })
})

watch(() => [props.network, layer.value], refresh)
watch(
  () => [props.dark, props.basemap],
  () => {
    layersReady = false // style.load re-adds sources and layers with the latest data
    basemapError.value = null
    map.value?.setStyle(currentStyle())
  },
)
onBeforeUnmount(() => {
  markers.forEach((mk) => mk.remove())
  map.value?.remove()
})

const legend = computed(() => {
  if (layer.value === 'state') return STATE_ORDER.map((s) => ({ colour: STATE_HEX[s], label: STATE_META[s].label, icon: STATE_META[s].icon }))
  const buckets = layer.value === 'lastSeen' ? AGE_BUCKETS : BATTERY_BUCKETS
  return [
    ...buckets.map((b, i) => ({ colour: ramp.value[i]!, label: b.label, icon: undefined })),
    { colour: NO_DATA, label: layer.value === 'lastSeen' ? 'never' : 'no battery parameter', icon: undefined },
  ]
})
</script>

<template>
  <div class="fmde-hub-map">
    <div v-if="!compact" class="d-flex flex-wrap align-center ga-3 mb-2">
      <v-btn-toggle v-model="layer" density="compact" variant="outlined" divided mandatory>
        <v-btn value="state" size="small" prepend-icon="mdi-traffic-light-outline">State</v-btn>
        <v-btn value="lastSeen" size="small" prepend-icon="mdi-clock-outline">Last seen</v-btn>
        <v-btn value="battery" size="small" prepend-icon="mdi-battery-outline">Battery</v-btn>
      </v-btn-toggle>
      <div class="d-flex flex-wrap ga-3 text-caption">
        <span v-for="l in legend" :key="l.label" class="d-flex align-center ga-1">
          <span class="fmde-hub-swatch" :style="{ background: l.colour }" />
          <v-icon v-if="l.icon" :icon="l.icon" size="14" />
          {{ l.label }}
        </span>
      </div>
    </div>
    <div v-if="basemapError" class="text-caption text-error mb-1" role="alert">{{ basemapError }}</div>
    <div ref="container" class="fmde-hub-map__canvas" :data-points="drawnPoints" :style="{ height }" role="region" aria-label="Map of nodes" />
    <div v-if="unlocated.length" class="d-flex flex-wrap align-center ga-2 mt-2 text-caption">
      <span class="text-medium-emphasis">Not on the map (no location in metadata):</span>
      <v-chip v-for="n in unlocated" :key="n.status.nodeKey" size="x-small" label :prepend-icon="STATE_META[n.status.state].icon" @click="emit('select:node', n.status.nodeKey)">
        {{ n.metadata?.node.name || n.status.nodeKey }}
      </v-chip>
    </div>
  </div>
</template>

<style scoped>
.fmde-hub-map__canvas {
  border-radius: 8px;
  overflow: hidden;
  border: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.fmde-hub-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
:global(.fmde-hub-map-popup .maplibregl-popup-content) {
  font: 12px/1.45 system-ui, sans-serif;
  color: #0b0b0b;
  padding: 8px 10px;
}
:global(.fmde-hub-observer-marker) {
  width: 80px;
  height: 80px;
  pointer-events: none;
}
:global(.fmde-hub-observer-marker svg) {
  pointer-events: none;
}
</style>

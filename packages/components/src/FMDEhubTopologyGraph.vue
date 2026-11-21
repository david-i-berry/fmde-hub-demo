<script lang="ts">
let graphCount = 0
</script>

<script setup lang="ts">
// Topology graph. Edge colour = state of the link's node; parameter links turn
// orange when the parameter had empty values in the window.
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { Handle, Position, VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import type { NodeKey } from '@fmde-hub/fmde'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { NetworkExtras, NetworkNode } from './network'
import { STATE_HEX, STATE_META, STATE_ORDER } from './state'
import { buildTopology, edgeColour, layoutLayered, type TopoNode } from './topology'
import { chartTokens } from './chart'

const props = withDefaults(defineProps<{ network: NetworkNode[]; extras?: NetworkExtras; dark?: boolean; height?: string }>(), {
  extras: () => ({}),
  dark: false,
  height: '70vh',
})
const emit = defineEmits<{ 'select:node': [nodeKey: NodeKey] }>()

const showParameters = ref(false)
const collapseGroups = ref(props.network.length > 40)

// one Vue Flow store per graph on the page
const flowId = `fmde-hub-topology-${++graphCount}`
const { fitView, onNodesInitialized } = useVueFlow(flowId)
// fit once Vue Flow has measured the (re)laid-out nodes
let fitPending = false
onNodesInitialized(() => {
  if (fitPending) scheduleFit()
})
const flowNodes = shallowRef<Node<TopoNode>[]>([])
const flowEdges = shallowRef<Edge[]>([])

const neutral = computed(() => (props.dark ? '#5f5e5a' : '#b5b4ad'))
/** Chart colours, also used by the styles below. */
const tokens = computed(() => chartTokens(props.dark))
const ATTENTION = chartTokens(false).attention // the same in light and dark mode

// Re-layout only when the structure changes; state changes just recolour.
const structureKey = computed(() =>
  JSON.stringify([showParameters.value, collapseGroups.value, props.network.map((n) => [n.status.nodeKey, n.metadata?.version])]),
)

async function rebuild(relayout: boolean) {
  const { nodes, edges } = buildTopology(props.network, props.extras, { showParameters: showParameters.value, collapseGroups: collapseGroups.value })
  const old = new Map(flowNodes.value.map((n) => [n.id, n.position]))
  if (unmounted) return
  const pos = relayout ? await layoutLayered(nodes, edges) : old
  flowNodes.value = nodes.map((n) => ({
    id: n.id,
    type: 'topo',
    position: pos.get(n.id) ?? old.get(n.id) ?? { x: 0, y: 0 },
    data: n,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }))
  flowEdges.value = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    style: {
      stroke: edgeColour(e, neutral.value, ATTENTION),
      strokeWidth: e.state || e.attention ? 2.5 : 1.5,
      strokeDasharray: e.attention ? '2 4' : e.state === 'SILENT' || e.state === 'NEVER_SEEN' ? '6 4' : undefined,
      strokeLinecap: e.attention ? 'round' : undefined,
    },
  }))
  if (relayout && !unmounted) {
    fitPending = true
    await nextTick()
    scheduleFit() // also covers re-layouts where no node is newly measured
  }
}

function scheduleFit() {
  if (fitTimer) clearTimeout(fitTimer)
  fitTimer = setTimeout(() => {
    fitTimer = null
    fitPending = false
    if (!unmounted) void fitView({ padding: 0.08, duration: 200 })
  }, 80)
}

// a fit animation running into unmount (e.g. clicking a node navigates away) yields NaN viewports
let unmounted = false
let fitTimer: ReturnType<typeof setTimeout> | null = null
onBeforeUnmount(() => {
  unmounted = true
  if (fitTimer) clearTimeout(fitTimer)
})

let lastStructure = ''
watch(
  () => [structureKey.value, props.network, props.extras, props.dark],
  () => {
    const relayout = structureKey.value !== lastStructure
    lastStructure = structureKey.value
    void rebuild(relayout)
  },
  { immediate: true, deep: false },
)

const KIND_ICON: Record<string, string> = {
  hub: 'mdi-monitor-dashboard',
  broker: 'mdi-transit-connection-variant',
  group: 'mdi-domain',
  node: 'mdi-router-wireless',
  observer: 'mdi-thermometer-lines',
  parameter: 'mdi-chart-line-variant',
}

function onNodeClick(node: Node<TopoNode>) {
  if (node.data?.nodeKey) emit('select:node', node.data.nodeKey)
}
</script>

<template>
  <div class="fmde-hub-topology">
    <div class="d-flex flex-wrap align-center ga-3 mb-2">
      <v-switch v-model="showParameters" label="Parameters" color="primary" density="compact" hide-details :disabled="collapseGroups" />
      <v-switch v-model="collapseGroups" label="Groups only" color="primary" density="compact" hide-details />
      <v-spacer />
      <div class="d-flex flex-wrap ga-3 text-caption">
        <span v-for="s in STATE_ORDER" :key="s" class="d-flex align-center ga-1" :title="STATE_META[s].description">
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" :stroke="STATE_HEX[s]" stroke-width="2.5" :stroke-dasharray="s === 'SILENT' ? '6 4' : undefined" /></svg>
          {{ STATE_META[s].label }}
        </span>
        <span v-if="showParameters" class="d-flex align-center ga-1">
          <svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" :stroke="ATTENTION" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round" /></svg>
          empty values
        </span>
      </div>
    </div>

    <div :style="{ height }" class="fmde-hub-topology__canvas" :class="{ 'fmde-hub-topology--dark': dark }">
      <VueFlow
        :id="flowId"
        :nodes="flowNodes"
        :edges="flowEdges"
        :nodes-connectable="false"
        :edges-updatable="false"
        :min-zoom="0.05"
        :max-zoom="2"
        @node-click="({ node }) => onNodeClick(node as Node<TopoNode>)"
      >
        <Background :pattern-color="tokens.grid" :gap="20" />
        <Controls :show-interactive="false" />

        <template #node-topo="{ data }: { data: TopoNode }">
          <Handle type="target" :position="Position.Left" :connectable="false" class="fmde-hub-handle" />
          <div
            class="fmde-hub-topo-node"
            :class="[`kind-${data.kind}`, { clickable: !!data.nodeKey }]"
            :style="{ width: `${data.width}px`, minHeight: `${data.height}px`, borderLeftColor: data.state ? STATE_HEX[data.state] : undefined }"
            :title="data.state ? `${STATE_META[data.state].label}: ${STATE_META[data.state].description}` : data.sublabel"
          >
            <div class="d-flex align-center ga-2">
              <v-icon :icon="KIND_ICON[data.kind]" size="18" class="text-medium-emphasis" />
              <span class="label text-truncate">{{ data.label }}</span>
              <v-icon v-if="data.state" :icon="STATE_META[data.state].icon" :color="STATE_META[data.state].color" size="16" class="ms-auto" />
            </div>
            <div v-if="data.sublabel" class="sublabel text-truncate">{{ data.sublabel }}</div>
            <div v-if="data.kind === 'node'" class="d-flex align-center ga-2 mt-1">
              <span class="text-caption" :style="{ color: data.state ? STATE_HEX[data.state] : undefined }">{{ data.state ? STATE_META[data.state].label : '' }}</span>
              <span v-if="data.battery" class="text-caption ms-auto d-flex align-center" title="Battery voltage (latest)">
                <v-icon icon="mdi-battery-outline" size="14" />{{ data.battery.value.toFixed(2) }} {{ data.battery.unit }}
              </span>
            </div>
            <div v-if="data.kind === 'group' && data.counts" class="d-flex flex-wrap ga-2 mt-1">
              <span v-for="s in STATE_ORDER.filter((x) => data.counts![x])" :key="s" class="text-caption d-flex align-center" :title="STATE_META[s].label">
                <v-icon :icon="STATE_META[s].icon" :color="STATE_META[s].color" size="14" class="me-1" />{{ data.counts![s] }}
              </span>
            </div>
            <div v-if="data.kind === 'parameter' && data.emptyValues" class="text-caption fmde-hub-attention">▲ {{ data.emptyValues }} empty</div>
          </div>
          <Handle type="source" :position="Position.Right" :connectable="false" class="fmde-hub-handle" />
        </template>
      </VueFlow>
    </div>
  </div>
</template>

<style scoped>
.fmde-hub-topology__canvas {
  border: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  overflow: hidden;
}
.fmde-hub-topo-node {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), 0.25);
  border-left: 4px solid rgba(var(--v-border-color), 0.4);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  box-sizing: border-box;
}
.fmde-hub-topo-node.clickable {
  cursor: pointer;
}
.fmde-hub-topo-node.kind-node {
  border-left-width: 6px;
}
.fmde-hub-topo-node.kind-parameter,
.fmde-hub-topo-node.kind-observer {
  font-size: 12px;
}
.label {
  font-weight: 500;
}
.sublabel {
  font-size: 11px;
  opacity: 0.7;
}
.fmde-hub-attention {
  color: v-bind('tokens.attention');
}
.fmde-hub-handle {
  opacity: 0;
}
.fmde-hub-topology--dark :deep(.vue-flow__controls-button) {
  background: v-bind('tokens.tooltip');
  fill: v-bind('tokens.ink');
  border-color: v-bind('tokens.axis');
}
</style>

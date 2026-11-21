<script setup lang="ts">
import { FMDEhubNodeMap, type MapLayer } from '@fmde-hub/components'
import type { NodeKey } from '@fmde-hub/fmde'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { useNetwork } from '../composables/fmde-hub'
import { useUiStore } from '../stores/ui'

const route = useRoute()
const router = useRouter()
const theme = useTheme()
const dark = computed(() => theme.current.value.dark)
const { network } = useNetwork()
const ui = useUiStore()

// the map layer is part of the URL, like the time window
const layer = computed<MapLayer>({
  get: () => (['state', 'lastSeen', 'battery'].includes(String(route.query.layer)) ? (route.query.layer as MapLayer) : 'state'),
  set: (v) => void router.replace({ query: { ...route.query, layer: v === 'state' ? undefined : v } }),
})

function open(nodeKey: NodeKey) {
  const [group, node] = nodeKey.split('/')
  void router.push({ name: 'node', params: { group, node }, query: { window: route.query.window } })
}
</script>

<template>
  <div class="d-flex align-baseline ga-3 mb-3 flex-wrap">
    <h1 class="text-h5">Map</h1>
    <span class="text-body-2 text-medium-emphasis">Live: updates as messages arrive. Zoom in to see observer devices sited apart from their node.</span>
  </div>
  <FMDEhubNodeMap
    v-model:layer="layer"
    :network="network"
    :dark="dark"
    :basemap="ui.basemap"
    height="calc(100vh - 230px)"
    @select:node="open"
  />
</template>

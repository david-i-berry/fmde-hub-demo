<script setup lang="ts">
import type { MetadataVersion, ObsValue, Parameter, SeriesKey } from '@fmde-hub/fmde'
import { computed } from 'vue'
import { formatTime, formatValue } from './format'
import { safeUrl } from './html'

const props = defineProps<{
  metadata: MetadataVersion
  latest: Record<SeriesKey, { time: string; value: ObsValue }>
  utc?: boolean
  /** long names (or series keys) whose empty values are expected; omit to hide the toggle */
  expectedEmpty?: string[]
}>()
const emit = defineEmits<{ 'select:param': [seriesKey: SeriesKey]; 'toggle:expected-empty': [longName: string] }>()

const isExpectedEmpty = (p: Parameter) => !!props.expectedEmpty?.some((n) => n === p.longName || n === p.seriesKey)

const definitions = computed(() => {
  const groups = new Map<number, Parameter[]>()
  for (const p of props.metadata.parameters) groups.set(p.definitionId, [...(groups.get(p.definitionId) ?? []), p])
  return [...groups.entries()].map(([id, params]) => ({ id, description: params[0]?.definitionDescription ?? '', params }))
})

function device(p: Parameter): string {
  if (p.device.kind === 'node') return 'node'
  if (p.device.kind === 'observer') {
    const id = p.device.observerId
    return props.metadata.observers.find((o) => o.id === id)?.name ?? `observer ${id}`
  }
  return '—'
}

function standardName(p: Parameter): { label: string; href?: string } | null {
  const [prefix, name] = Object.entries(p.standardNames)[0] ?? []
  if (!prefix || !name) return null
  const ns = props.metadata.namespaces[prefix]
  return { label: `${prefix}:${name}`, href: ns ? safeUrl(`${ns}${name}`) : undefined }
}

function cell(p: Parameter): string {
  if (p.cellMethod === 'UNSPECIFIED') return '—'
  return p.cellPeriodSeconds ? `${p.cellMethod.toLowerCase()} over ${p.cellPeriodSeconds} s` : p.cellMethod.toLowerCase()
}
</script>

<template>
  <v-card v-for="d in definitions" :key="d.id" variant="outlined" class="mb-3">
    <v-card-title class="text-subtitle-1">Definition {{ d.id }}: {{ d.description }}</v-card-title>
    <v-table density="compact">
      <thead>
        <tr><th>#</th><th>Parameter</th><th>Standard name</th><th>Cell method</th><th>Device</th><th class="text-end">Latest</th><th v-if="expectedEmpty" class="text-center" title="Empty values expected: not counted as data loss">Empty OK</th></tr>
      </thead>
      <tbody>
        <tr v-for="p in d.params" :key="p.key" class="cursor-pointer" @click="emit('select:param', p.seriesKey)">
          <td>{{ p.valueIndex }}</td>
          <td>{{ p.longName }} <span class="text-medium-emphasis">({{ p.unit }})</span></td>
          <td>
            <template v-if="standardName(p)">
              <a v-if="standardName(p)!.href" :href="standardName(p)!.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ standardName(p)!.label }}</a>
              <span v-else>{{ standardName(p)!.label }}</span>
            </template>
            <span v-else class="text-medium-emphasis">—</span>
          </td>
          <td>{{ cell(p) }}</td>
          <td>{{ device(p) }}</td>
          <td class="text-end">
            <template v-if="latest[p.seriesKey]">
              <span :class="{ 'text-warning': latest[p.seriesKey]!.value === null }">{{ formatValue(latest[p.seriesKey]!.value, p.unit) }}</span>
              <div class="text-caption text-medium-emphasis">{{ formatTime(latest[p.seriesKey]!.time, utc ?? true) }}</div>
            </template>
            <span v-else class="text-medium-emphasis">—</span>
          </td>
          <td v-if="expectedEmpty" class="text-center">
            <v-btn
              :icon="isExpectedEmpty(p) ? 'mdi-checkbox-marked-outline' : 'mdi-checkbox-blank-outline'"
              :color="isExpectedEmpty(p) ? 'primary' : undefined"
              variant="text"
              size="small"
              :aria-pressed="isExpectedEmpty(p)"
              :aria-label="`Empty values expected for ${p.longName}`"
              :title="isExpectedEmpty(p) ? 'Empty values expected (not counted as data loss). Click to count them again.' : 'Mark empty values as expected, e.g. no GPS fix underground or a sensor not fitted'"
              @click.stop="emit('toggle:expected-empty', p.longName)"
            />
          </td>
        </tr>
      </tbody>
    </v-table>
  </v-card>
</template>

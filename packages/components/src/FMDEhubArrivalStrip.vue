<script setup lang="ts">
// Message arrival strip: one mark per data message at its receipt time, height = latency of the
// newest observation (log scale from 1 s). Backlog flushes (a message reaching back more than
// `backlogSeconds`) are larger diamonds, sized by observation count. Messages with no observation
// time, or with one in the future, sit on the 1 s floor with their own marks, never as dots.
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { arrivalHeight, arrivalKind, type ArrivalKind, type ArrivalPoint } from './arrival'
import { chartTokens, stamp, timeAxis, tooltipBase, valueAxis } from './chart'
import { textLines, type TextLine } from './dom'
import { formatDuration } from './format'

export type { ArrivalPoint } from './arrival'

const props = withDefaults(
  defineProps<{ messages: ArrivalPoint[]; from: string; to: string; dark?: boolean; utc?: boolean; backlogSeconds?: number; futureToleranceSeconds?: number }>(),
  { dark: false, utc: true, backlogSeconds: 3600, futureToleranceSeconds: 60 },
)
/** The data_message id of the clicked message. */
const emit = defineEmits<{ 'select:message': [id: string] }>()

function onClick(p: { data?: unknown }) {
  const id = (p.data as { id?: string } | undefined)?.id
  if (id !== undefined) emit('select:message', id)
}

const byKind = computed(() => {
  const groups: Record<ArrivalKind, ArrivalPoint[]> = { live: [], backlog: [], noTime: [], future: [] }
  for (const m of props.messages) groups[arrivalKind(m, props.backlogSeconds, props.futureToleranceSeconds)].push(m)
  return groups
})
const byId = computed(() => new Map(props.messages.map((m) => [m.id, m])))

/** Chart colours, also used by the legend's styles below. */
const tokens = computed(() => chartTokens(props.dark))

function tooltipLines(m: ArrivalPoint): (TextLine | string)[] {
  const kind = arrivalKind(m, props.backlogSeconds, props.futureToleranceSeconds)
  const lines: (TextLine | string)[] = [{ text: stamp(Date.parse(m.receivedAt), props.utc), bold: true }]
  if (kind === 'noTime') lines.push('no observation time decoded')
  else if (kind === 'future') lines.push(`newest observation ${formatDuration(-m.latencySeconds!)} in the future (node clock ahead?)`)
  else lines.push(`latency ${m.latencySeconds! < 0 ? '0 s (clock slightly ahead)' : formatDuration(m.latencySeconds)}`)
  lines.push(`${m.observations} observation(s), ${m.payloadBytes} bytes`)
  if (kind === 'backlog') lines.push(`backlog reaching back ${formatDuration(m.spanSeconds)}`)
  return lines
}

const option = computed(() => {
  const t = tokens.value
  const point = (m: ArrivalPoint) => ({ value: [Date.parse(m.receivedAt), arrivalHeight(m)], id: m.id })
  const g = byKind.value
  return {
    animation: false,
    grid: { left: 48, right: 12, top: 10, bottom: 22 },
    xAxis: { ...timeAxis(t, props.utc), min: Date.parse(props.from), max: Date.parse(props.to) },
    yAxis: valueAxis(t, { type: 'log', scale: false, min: 1, name: '', axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => formatDuration(v) } }),
    tooltip: {
      ...tooltipBase(t),
      trigger: 'item',
      formatter: (p: { data: { id: string } }) => {
        const m = byId.value.get(p.data.id)
        return m ? textLines(tooltipLines(m)) : ''
      },
    },
    series: [
      { type: 'scatter', data: g.live.map(point), symbolSize: 8, itemStyle: { color: t.series, opacity: 0.85 } },
      {
        type: 'scatter',
        data: g.backlog.map((m) => ({ ...point(m), symbolSize: Math.min(22, 10 + Math.sqrt(m.observations)) })),
        symbol: 'diamond',
        itemStyle: { color: t.attention, borderColor: t.background, borderWidth: 2 },
      },
      { type: 'scatter', data: g.noTime.map(point), symbol: 'emptyCircle', symbolSize: 9, itemStyle: { color: t.muted, borderWidth: 1.5 } },
      { type: 'scatter', data: g.future.map(point), symbol: 'triangle', symbolSize: 10, itemStyle: { color: t.attention, borderColor: t.background, borderWidth: 1 } },
    ],
  }
})
</script>

<template>
  <div>
    <div class="d-flex flex-wrap ga-4 text-caption text-medium-emphasis mb-1">
      <span><span class="fmde-hub-dot" /> data message (height = latency)</span>
      <span v-if="byKind.backlog.length"><span class="fmde-hub-attention">◆</span> backlog flush ({{ byKind.backlog.length }})</span>
      <span v-if="byKind.future.length"><span class="fmde-hub-attention">▲</span> observation time in the future ({{ byKind.future.length }})</span>
      <span v-if="byKind.noTime.length"><span class="fmde-hub-ring" /> no observation time ({{ byKind.noTime.length }})</span>
    </div>
    <VChart :option="option" style="height: 160px" autoresize @click="onClick" />
  </div>
</template>

<style scoped>
.fmde-hub-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: v-bind('tokens.series');
  vertical-align: middle;
}
.fmde-hub-ring {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid v-bind('tokens.muted');
  vertical-align: middle;
}
.fmde-hub-attention {
  color: v-bind('tokens.attention');
}
</style>

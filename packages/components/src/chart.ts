// Shared ECharts setup and the chart colours for light and dark mode.
import { ScatterChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { formatTime } from './format'

// only what the charts use is registered, so only that is bundled
use([LineChart, ScatterChart, GridComponent, TooltipComponent, SVGRenderer])

export interface ChartTokens {
  series: string
  /** status: warning-level marks (empty values, backlog flushes). Never used as a series colour. */
  attention: string
  ink: string
  muted: string
  grid: string
  axis: string
  /** the page behind the chart: outlines that separate overlapping marks */
  background: string
  tooltip: string
}

export function chartTokens(dark: boolean): ChartTokens {
  return dark
    ? { series: '#3987e5', attention: '#ec835a', ink: '#f0efec', muted: '#898781', grid: '#2c2c2a', axis: '#383835', background: '#1a1a19', tooltip: '#262624' }
    : { series: '#2a78d6', attention: '#ec835a', ink: '#0b0b0b', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', background: '#fcfcfb', tooltip: '#ffffff' }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Time axis label: MM-DD at midnight, else HH:MM; UTC or local time. */
export function timeLabel(ms: number, utc: boolean): string {
  const d = new Date(ms)
  const [month, day, h, m] = utc
    ? [d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()]
    : [d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]
  return h === 0 && m === 0 ? `${pad(month + 1)}-${pad(day)}` : `${pad(h)}:${pad(m)}`
}

export function timeAxis(t: ChartTokens, utc: boolean) {
  return {
    type: 'time' as const,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (v: number) => timeLabel(v, utc) },
    splitLine: { show: false },
  }
}

export function valueAxis(t: ChartTokens, extra: Record<string, unknown> = {}) {
  return {
    type: 'value' as const,
    scale: true,
    splitNumber: 3,
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid, width: 1 } },
    ...extra,
  }
}

export function tooltipBase(t: ChartTokens) {
  return {
    backgroundColor: t.tooltip,
    borderColor: t.axis,
    textStyle: { color: t.ink, fontSize: 12 },
    confine: true,
  }
}

/** Tooltip time: the same format as everywhere else (formatTime). */
export function stamp(ms: number, utc: boolean): string {
  return formatTime(new Date(ms).toISOString(), utc)
}

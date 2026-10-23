/**
 * Chart helpers on top of Recharts, styled for Melstar ERP.
 * Use inside a Card: <ChartBox height={240}><AreaChart data={…}>…</AreaChart></ChartBox>
 */
import type { ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'

/** Series colours, in order: muted and distinguishable, brand blue first. */
export const SERIES = ['#2a56a1', '#2f8f83', '#d08c1e', '#7a5aa6', '#c94a4a', '#4a8cc4', '#6b7c3a', '#a0627f', '#4c6a7d', '#8a5a2b']

export const axisProps = {
  tick: { fill: '#4a5468', fontSize: 11.5 },
  axisLine: false,
  tickLine: false,
} as const

export const gridProps = { stroke: '#e1e4e9', vertical: false } as const

export const tooltipProps = {
  contentStyle: { borderRadius: 6, border: '1px solid #cdd2da', boxShadow: '0 4px 12px rgba(16,24,40,.10)', fontSize: 12.5, color: '#172033', padding: '6px 10px' },
  labelStyle: { color: '#4a5468', fontWeight: 600, marginBottom: 2 },
  cursor: { fill: 'rgba(23,32,51,.04)' },
} as const

export function ChartBox({ height = 240, children }: { height?: number; children: ReactNode }) {
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  )
}

/**
 * <defs> with light area fills (fill="url(#gIndigo)" etc.) and the two solid bar colours.
 * Call it as {chartGradients()} inside a chart: Recharts only renders its own components and plain
 * SVG elements, so a <ChartGradients /> component child would be dropped and the url(#…) fills lost.
 */
export function chartGradients() {
  const g = (id: string, c: string) => (
    <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={c} stopOpacity={0.18} />
      <stop offset="100%" stopColor={c} stopOpacity={0.02} />
    </linearGradient>
  )
  const solid = (id: string, c: string) => (
    <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={c} />
      <stop offset="100%" stopColor={c} />
    </linearGradient>
  )
  return (
    <defs>
      {g('gIndigo', SERIES[0]!)}
      {g('gCyan', SERIES[1]!)}
      {g('gPink', SERIES[7]!)}
      {g('gGreen', '#3a8f5c')}
      {solid('gBar', SERIES[0]!)}
      {solid('gBarPink', '#93b2e1')}
    </defs>
  )
}

/** Small legend row for donut charts. */
export function Legend({ items }: { items: { label: string; value: ReactNode; color: string }[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.label} className="flex items-center justify-between gap-3 text-[13px]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: i.color }} />
            <span className="truncate text-ink-soft">{i.label}</span>
          </span>
          <span className="num font-medium text-ink">{i.value}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Chart helpers on top of Recharts, styled for the Melstar brand.
 * Use inside a Card: <ChartBox height={240}><AreaChart data={…}>…</AreaChart></ChartBox>
 */
import type { ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'

/** Brand series colours, in order. */
export const SERIES = ['#6366f1', '#06b6d4', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#0ea5e9', '#f97316', '#14b8a6', '#a855f7']

export const axisProps = {
  tick: { fill: '#55628f', fontSize: 11.5 },
  axisLine: false,
  tickLine: false,
} as const

export const gridProps = { stroke: 'rgba(99,102,241,.12)', strokeDasharray: '3 4', vertical: false } as const

export const tooltipProps = {
  contentStyle: { borderRadius: 14, border: '1px solid #e0e7ff', boxShadow: '0 16px 40px -18px rgba(70,90,200,.45)', fontSize: 12.5, color: '#1e2b5c', padding: '8px 12px' },
  labelStyle: { color: '#55628f', fontWeight: 600, marginBottom: 2 },
  cursor: { fill: 'rgba(99,102,241,.06)' },
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

/** <defs> with brand gradients: fill="url(#gIndigo)" etc. */
export function ChartGradients() {
  const g = (id: string, c: string) => (
    <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={c} stopOpacity={0.35} />
      <stop offset="100%" stopColor={c} stopOpacity={0.02} />
    </linearGradient>
  )
  return (
    <defs>
      {g('gIndigo', '#6366f1')}
      {g('gCyan', '#06b6d4')}
      {g('gPink', '#ec4899')}
      {g('gGreen', '#10b981')}
      <linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
      <linearGradient id="gBarPink" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ec4899" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
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
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i.color }} />
            <span className="truncate text-ink-soft">{i.label}</span>
          </span>
          <span className="num font-semibold text-ink">{i.value}</span>
        </li>
      ))}
    </ul>
  )
}

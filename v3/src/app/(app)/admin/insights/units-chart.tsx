import type { DailyPoint } from '@/lib/insights/model'

/**
 * Units sold over the period, as inline SVG.
 *
 * No charting library. This is one line, an axis and four labels; Recharts is
 * ~500KB of client JavaScript to draw a polyline, and it would be the largest
 * thing on a page that is otherwise server-rendered HTML. Inline SVG also
 * prints, which a canvas-based chart does not.
 *
 * Days with no sales come back absent from the query rather than as zeroes, so
 * they are filled here. Without that the line would connect 3 August to 11
 * August as a straight slope and read as steady trade through a week when
 * nothing sold at all.
 */
const WIDTH = 900
const HEIGHT = 220
const PAD = { top: 12, right: 12, bottom: 26, left: 44 }

export function UnitsChart({
  points,
  from,
  to,
}: {
  points: DailyPoint[]
  from: string
  to: string
}) {
  const byDay = new Map(points.map((p) => [p.day.slice(0, 10), p.units]))

  const days: { day: string; units: number }[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)

  // Bounded, so a hand-typed range of ten years cannot render 3,650 points.
  while (cursor <= end && days.length < 800) {
    const key = cursor.toISOString().slice(0, 10)
    days.push({ day: key, units: byDay.get(key) ?? 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  if (days.length < 2) return null

  const max = Math.max(1, ...days.map((d) => d.units))
  const plotWidth = WIDTH - PAD.left - PAD.right
  const plotHeight = HEIGHT - PAD.top - PAD.bottom

  const x = (i: number) => PAD.left + (i / (days.length - 1)) * plotWidth
  const y = (units: number) => PAD.top + plotHeight - (units / max) * plotHeight

  const line = days.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.units).toFixed(1)}`).join(' ')
  const area = `${line} L${x(days.length - 1).toFixed(1)},${(PAD.top + plotHeight).toFixed(1)} L${PAD.left},${(PAD.top + plotHeight).toFixed(1)} Z`

  // Four gridlines, at values a person would actually say out loud.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f))
  const unique = [...new Set(ticks)]

  const label = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-56 w-full min-w-[600px]"
        role="img"
        aria-label={`Units sold per day from ${from} to ${to}, peaking at ${max}`}
      >
        {unique.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(value)}
              y2={y(value)}
              stroke="currentColor"
              className="text-stone-200"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(value) + 4}
              textAnchor="end"
              className="fill-stone-400 text-[11px]"
            >
              {value.toLocaleString('en-IN')}
            </text>
          </g>
        ))}

        <path d={area} className="fill-stone-900/5" />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          className="text-stone-900"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        <text x={PAD.left} y={HEIGHT - 6} className="fill-stone-400 text-[11px]">
          {label(days[0].day)}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="fill-stone-400 text-[11px]"
        >
          {label(days[days.length - 1].day)}
        </text>
      </svg>
    </div>
  )
}

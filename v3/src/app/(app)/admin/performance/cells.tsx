import { cn } from '@/components/ui/primitives'
import { ATTENDANCE, type Attendance, type Cell } from '@/lib/performance/calc'

/**
 * The colour vocabulary for one person-day, shared by the grid and the
 * drill-down so the same day never looks different in two places.
 *
 * An unrecorded day is hatched red and says "—", never blank and never grey:
 * blank reads as "nothing to see", grey reads as "day off", and both would hide
 * the one thing a gap is telling the founders — the sheet did not get done.
 */
export const ATTENDANCE_TONE: Record<Attendance, string> = {
  present: 'bg-emerald-100 text-emerald-900',
  half_day: 'bg-amber-100 text-amber-900',
  absent: 'bg-red-100 text-red-900',
  leave: 'bg-sky-100 text-sky-900',
}

const MISSING =
  'text-red-700 ring-1 ring-inset ring-red-300 bg-[repeating-linear-gradient(135deg,var(--color-red-100)_0_3px,var(--color-white)_3px_7px)]'

export function attendanceLabel(a: Attendance): string {
  return ATTENDANCE.find((x) => x.value === a)?.label ?? a
}

export function GridCell({ cell, title }: { cell: Cell; title: string }) {
  if (cell.kind === 'not_expected') {
    return (
      <span title={title} className="flex h-9 w-9 items-center justify-center rounded text-xs text-stone-300">
        ·
      </span>
    )
  }
  if (cell.kind === 'missing') {
    return (
      <span title={`${title}: not recorded`} className={cn('flex h-9 w-9 items-center justify-center rounded text-xs', MISSING)}>
        —
      </span>
    )
  }
  const short = ATTENDANCE.find((a) => a.value === cell.attendance)?.short ?? '?'
  return (
    <span
      title={`${title}: ${attendanceLabel(cell.attendance)}${cell.units ? `, ${cell.units} units` : ''}${
        cell.flags ? `, ${cell.flags} flag${cell.flags === 1 ? '' : 's'}` : ''
      }${cell.note ? ', has a note' : ''}`}
      className={cn(
        'relative flex h-9 w-9 items-center justify-center rounded text-xs font-medium',
        ATTENDANCE_TONE[cell.attendance],
      )}
    >
      {short}
      {cell.flags > 0 && (
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-0.5 text-[10px] leading-none text-white">
          {cell.flags}
        </span>
      )}
    </span>
  )
}

export function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
      {ATTENDANCE.map((a) => (
        <li key={a.value} className="flex items-center gap-1.5">
          <span className={cn('flex h-5 w-5 items-center justify-center rounded text-[10px] font-medium', ATTENDANCE_TONE[a.value])}>
            {a.short}
          </span>
          {a.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className={cn('flex h-5 w-5 items-center justify-center rounded text-[10px]', MISSING)}>—</span>
        Not recorded
      </li>
      <li className="flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center text-stone-300">·</span>
        Not a working day / not employed
      </li>
      <li className="flex items-center gap-1.5">
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-0.5 text-[10px] text-white">1</span>
        Quality flags
      </li>
    </ul>
  )
}

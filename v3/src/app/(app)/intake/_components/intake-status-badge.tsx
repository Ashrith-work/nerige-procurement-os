import { cn } from '@/components/ui/primitives'
import { STATUS_LABELS, STATUS_TONES, type IntakeStatus, type Tone } from '@/lib/intake/status'

/**
 * `StatusBadge` from primitives keys its colours on order and vendor statuses,
 * and adding fourteen intake statuses to that shared map would be editing a file
 * every module leans on. So intake carries its own badge, with the same four
 * tones in the same meanings.
 */
const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-stone-100 text-stone-600 ring-stone-500/20',
  waiting: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  moving: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  bad: 'bg-red-50 text-red-700 ring-red-600/20',
}

export function IntakeStatusBadge({ status, className }: { status: IntakeStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONE_CLASSES[STATUS_TONES[status]],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

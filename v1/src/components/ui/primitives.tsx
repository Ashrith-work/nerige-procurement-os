import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Re-exported for the M1 screens that import `cn` from here. The implementation
// moved to @/lib/utils, which is where the shadcn generator expects it.
export { cn }

/**
 * Minimal design primitives.
 *
 * Deliberately hand-written rather than pulled from a component library. M1 has
 * five screens; the value of a full library arrives in M3–M7 when there are
 * data tables, comboboxes and dialogs. Adding it now would mean maintaining
 * generated components nobody has read.
 *
 * Every control here is sized for a phone first. Vendors will use this on an
 * Android handset, one-handed, possibly on a factory floor — 44px minimum touch
 * targets throughout, not the 32px that looks tidy on a desktop mock.
 */

export function Button({
  className,
  variant = 'primary',
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary' &&
          'bg-stone-900 text-white hover:bg-stone-800 focus-visible:ring-stone-900',
        variant === 'secondary' &&
          'border border-stone-300 bg-white text-stone-900 hover:bg-stone-50 focus-visible:ring-stone-400',
        variant === 'ghost' && 'text-stone-700 hover:bg-stone-100',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600',
        className,
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base',
        // text-base, not text-sm: iOS Safari zooms the viewport on focus for
        // any input under 16px, which is deeply disorienting on a phone.
        'placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500',
        'disabled:bg-stone-50 disabled:text-stone-500',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base',
        'focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base',
        'placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500',
        className,
      )}
      {...props}
    />
  )
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-stone-700">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-xs text-stone-500">{hint}</span>}
      {error && <span className="block text-xs font-medium text-red-600">{error}</span>}
    </label>
  )
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-xl border border-stone-200 bg-white p-5 shadow-sm', className)}
      {...props}
    />
  )
}

const NEUTRAL = 'bg-stone-100 text-stone-600 ring-stone-500/20'
const GOOD = 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
const WAITING = 'bg-amber-50 text-amber-700 ring-amber-600/20'
const MOVING = 'bg-sky-50 text-sky-700 ring-sky-600/20'
const BAD = 'bg-red-50 text-red-700 ring-red-600/20'

/**
 * One colour vocabulary across vendor, order, receipt and bill statuses:
 * amber means someone is waiting, blue means it is in motion, green means
 * settled, red means it stopped. Users read the colour before the word, so a
 * status that means "blocked" in one table and "fine" in another would be
 * actively misleading.
 */
const STATUS_TONES: Record<string, string> = {
  // Vendor lifecycle
  active: GOOD,
  pending_kyc: WAITING,
  on_hold: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  blacklisted: BAD,
  archived: NEUTRAL,
  // Purchase orders
  draft: NEUTRAL,
  issued: WAITING,
  acknowledged: MOVING,
  in_production: MOVING,
  dispatched: MOVING,
  partially_received: WAITING,
  received: GOOD,
  closed: NEUTRAL,
  cancelled: BAD,
  // Bills
  submitted: WAITING,
  under_review: MOVING,
  disputed: BAD,
  rejected: BAD,
  approved: GOOD,
  paid: GOOD,
  // Receipts and catalogue
  posted: GOOD,
  proposed: WAITING,
  sampling: MOVING,
  discontinued: NEUTRAL,
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        STATUS_TONES[status] ?? NEUTRAL,
      )}
    >
      {label ?? status.replace(/_/g, ' ')}
    </span>
  )
}

/**
 * A single number on a dashboard.
 *
 * `href` is not decoration: a count nobody can click is a count nobody can act
 * on, and every number on these dashboards is meant to lead somewhere.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  href,
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  href?: string
}) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-700',
          tone === 'warn' && 'text-amber-700',
          tone === 'bad' && 'text-red-700',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
    </>
  )

  const className = cn(
    'block rounded-xl border border-stone-200 bg-white p-4 shadow-sm',
    href && 'transition-colors hover:border-stone-300 hover:bg-stone-50',
  )

  return href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  )
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-stone-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/**
 * A group of rows on a dashboard, headed by what it is and how many.
 *
 * Renders nothing at all when empty. A dashboard made of empty sections reads
 * as broken; one that shows only what needs attention reads as finished.
 */
export function WorkSection({
  title,
  hint,
  count,
  children,
}: {
  title: string
  hint?: string
  count: number
  children: ReactNode
}) {
  if (count === 0) return null

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">
          {title} <span className="font-normal text-stone-400">({count})</span>
        </h2>
        {hint && <p className="text-xs text-stone-500">{hint}</p>}
      </div>
      <div className="divide-y divide-stone-100">{children}</div>
    </Card>
  )
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'success' | 'error'
  children: ReactNode
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-lg border px-3 py-2 text-sm',
        tone === 'info' && 'border-stone-200 bg-stone-50 text-stone-700',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-800',
      )}
    >
      {children}
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 px-6 py-12 text-center">
      <p className="font-medium text-stone-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

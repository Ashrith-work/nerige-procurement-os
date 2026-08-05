import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export { cn }

/**
 * Minimal design primitives, carried over and cut back to what this build uses.
 *
 * Every control is sized for a phone first. A weaver will use this on an
 * Android handset, one-handed, possibly standing at a loom — 44px minimum touch
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
 * One colour vocabulary across order and vendor statuses: amber means someone
 * is waiting, blue means it is in motion, green means settled, red means it
 * stopped. Users read the colour before the word, so a status that means
 * "blocked" in one place and "fine" in another would be actively misleading.
 */
const STATUS_TONES: Record<string, string> = {
  // Orders
  issued: WAITING,
  accepted: MOVING,
  dispatched: MOVING,
  received: GOOD,
  cancelled: BAD,
  // Vendors
  active: GOOD,
  on_hold: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  archived: NEUTRAL,
  // Why a design is in the reorder pool
  sold_out: BAD,
  last_piece: WAITING,
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
        <h1 className="text-lg font-medium tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-stone-500">{subtitle}</p>}
      </div>
      {action}
    </div>
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

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 px-6 py-12 text-center">
      <p className="font-medium text-stone-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { FLOWS, type FlowKey } from './flows'

/**
 * The progress bar a flow carries on every one of its screens.
 *
 * It is the flow's whole trail — there are no breadcrumbs as well, because two
 * trails on one screen means reading both to find out which one moves you.
 *
 * A real `<ol>`: these steps are an ordered list and a screen reader should say
 * so, with `aria-current="step"` on the one you are standing in. Steps you have
 * finished are links back, so a wrong weaver is one tap to fix; steps ahead are
 * links only when the screen handing them out knows where they go, which is why
 * `hrefs` is per step rather than derived here.
 *
 * Nothing about a step's state is carried by colour alone: the number, the
 * weight and a hidden word all say it.
 */
export function FlowStepper({
  flow,
  current,
  hrefs,
  note,
}: {
  flow: FlowKey
  /** 1-based, so it reads like the bar does. */
  current: number
  /** Destination per step key. A step with none is plain text. */
  hrefs?: Readonly<Record<string, string | undefined>>
  /** Replaces the "what this wants / what is next" line when this step is done. */
  note?: string
}) {
  const def = FLOWS[flow]
  const total = def.steps.length
  const here = def.steps[Math.min(Math.max(current, 1), total) - 1]

  return (
    <nav
      aria-label={`${def.name}: step ${current} of ${total}`}
      className="no-print space-y-2 border-b border-stone-200 pb-4"
    >
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        {def.steps.map((step, i) => {
          const n = i + 1
          const state = n < current ? 'done' : n === current ? 'current' : 'ahead'
          const href = hrefs?.[step.key]
          const body = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  state === 'current' && 'bg-stone-900 text-white',
                  state === 'done' && 'bg-stone-200 text-stone-700',
                  state === 'ahead' && 'border border-stone-300 text-stone-500',
                )}
              >
                {n}
              </span>
              <span className="sr-only">
                {`Step ${n}: `}
                {state === 'done' ? 'done. ' : state === 'current' ? 'you are here. ' : 'to come. '}
              </span>
              <span
                className={cn(
                  state === 'current' && 'font-medium text-stone-900',
                  state === 'done' && 'text-stone-600',
                  state === 'ahead' && 'text-stone-500',
                )}
              >
                {step.label}
              </span>
            </>
          )

          return (
            <li key={step.key} className="flex items-center" aria-current={state === 'current' ? 'step' : undefined}>
              {href && state !== 'current' ? (
                <Link
                  href={href}
                  className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:outline-none"
                >
                  {body}
                </Link>
              ) : (
                <span className="flex min-h-11 items-center gap-2 px-2 text-sm">{body}</span>
              )}
              {n < total && (
                <span aria-hidden="true" className="px-0.5 text-stone-300">
                  ›
                </span>
              )}
            </li>
          )
        })}
      </ol>

      <p className="text-sm text-stone-600">
        {note ?? (
          <>
            {here.wants}
            {here.next && <span className="text-stone-500"> {here.next}</span>}
          </>
        )}
      </p>
    </nav>
  )
}

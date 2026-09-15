'use client'

import { useActionState } from 'react'
import { Button, Input, Textarea } from '@/components/ui/primitives'
import type { IntakeStatus } from '@/lib/intake/status'
import { transitionIntake, type TransitionState } from './transition-actions'

/** A workflow edge as the server decided this person may take it. Serialisable. */
export interface EdgeOption {
  to: IntakeStatus
  label: string
  requires?: 'image_count' | 'reason'
  variant?: 'primary' | 'secondary' | 'danger'
}

const INITIAL: TransitionState = { status: 'idle' }

/**
 * The buttons that move one saree, for whichever edges the viewer holds.
 *
 * The edges arrive already filtered by `availableTransitions` on the server, so
 * this component never decides who may do what — it only lays the choices out.
 * Three shapes, because the edges need three kinds of input:
 *
 *   * a plain step ("Mark shot", "Approve") is one button;
 *   * the photo steps share ONE count field with a button each, so recording
 *     and sending to review are the same gesture on a phone, not two forms;
 *   * a rejection is a reason and a button, and the reason is required here as
 *     well as in the database, so the refusal happens before the round trip.
 *
 * One `useActionState` for the whole card: whichever button was pressed, the
 * card shows the result in one place.
 */
export function TransitionControls({
  uniqueCode,
  status,
  edges,
  imageCount,
  minImagesForReview,
}: {
  uniqueCode: number
  status: IntakeStatus
  edges: EdgeOption[]
  imageCount: number
  minImagesForReview: number
}) {
  const [state, action, pending] = useActionState(transitionIntake, INITIAL)

  if (edges.length === 0) return null

  const plain = edges.filter((e) => !e.requires)
  const counted = edges.filter((e) => e.requires === 'image_count')
  const reasoned = edges.filter((e) => e.requires === 'reason')
  const minimum = Math.max(1, minImagesForReview)

  const hidden = (
    <>
      <input type="hidden" name="unique_code" value={uniqueCode} />
      <input type="hidden" name="from" value={status} />
    </>
  )

  return (
    <div className="space-y-3">
      {counted.length > 0 && (
        <form action={action} className="flex flex-wrap items-end gap-2">
          {hidden}
          <label className="block text-sm text-stone-700">
            Photographs taken
            <Input
              name="image_count"
              type="number"
              inputMode="numeric"
              min={0}
              max={500}
              step={1}
              required
              defaultValue={imageCount > 0 ? imageCount : ''}
              className="mt-1 w-28"
              disabled={pending}
            />
          </label>
          {counted.map((e) => (
            <Button
              key={e.to}
              type="submit"
              name="to"
              value={e.to}
              variant={e.variant ?? 'primary'}
              disabled={pending}
            >
              {e.label}
            </Button>
          ))}
          {counted.some((e) => e.to === 'READY_FOR_REVIEW') && (
            <p className="w-full text-xs text-stone-500">
              Review needs at least {minimum} photograph{minimum === 1 ? '' : 's'}.
            </p>
          )}
        </form>
      )}

      {plain.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {plain.map((e) => (
            <form key={e.to} action={action}>
              {hidden}
              <input type="hidden" name="to" value={e.to} />
              <Button type="submit" variant={e.variant ?? 'primary'} disabled={pending}>
                {e.label}
              </Button>
            </form>
          ))}
        </div>
      )}

      {reasoned.map((e) => (
        <form key={e.to} action={action} className="space-y-2">
          {hidden}
          <input type="hidden" name="to" value={e.to} />
          <Textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={2}
            placeholder="What is wrong, so the warehouse knows what to fix"
            disabled={pending}
          />
          <Button type="submit" variant={e.variant ?? 'danger'} disabled={pending}>
            {e.label}
          </Button>
        </form>
      ))}

      {state.status !== 'idle' && state.uniqueCode === uniqueCode && (
        <p role="status" className={state.status === 'error' ? 'text-sm text-red-700' : 'text-sm text-emerald-700'}>
          {pending ? 'Saving…' : state.message}
        </p>
      )}
    </div>
  )
}

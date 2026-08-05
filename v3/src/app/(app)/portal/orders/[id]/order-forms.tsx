'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { acceptOrder, recordDispatch, type OrderActionState } from './actions'
import { Button, Input, Field, Alert } from '@/components/ui/primitives'
import type { Dictionary } from '@/lib/i18n'

const INITIAL: OrderActionState = { status: 'idle' }

/**
 * One decision per screen.
 *
 * An issued order asks exactly one question — when will these be ready — and
 * offers one button. The dispatch fields do not appear until that question has
 * been answered, because a form with four inputs and two buttons on a phone at
 * a loom is a form nobody finishes.
 */

export function AcceptForm({
  orderId,
  suggestedDate,
  t,
}: {
  orderId: string
  suggestedDate: string
  t: Dictionary
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(acceptOrder, INITIAL)

  return (
    <form
      action={async (fd) => {
        await action(fd)
        router.refresh()
      }}
      className="space-y-4"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Field label={t.order.promisedDate} hint={t.order.promisedDateHint} required>
        <Input
          name="promisedDate"
          type="date"
          // Pre-filled with the lead time we already expect from this weaver, so
          // the common case is one tap rather than a date picker.
          defaultValue={suggestedDate}
          min={new Date().toISOString().slice(0, 10)}
          required
        />
      </Field>
      {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t.order.accepting : t.order.accept}
      </Button>
    </form>
  )
}

export function DispatchForm({ orderId, t }: { orderId: string; t: Dictionary }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(recordDispatch, INITIAL)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <form
      action={async (fd) => {
        await action(fd)
        router.refresh()
      }}
      className="space-y-4"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Field label={t.order.dispatchDate} required>
        <Input name="sentOn" type="date" defaultValue={today} max={today} required />
      </Field>
      <Field label={t.order.docket} hint={t.order.docketHint}>
        <Input name="docket" type="text" inputMode="text" autoComplete="off" />
      </Field>
      {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t.order.dispatching : t.order.dispatch}
      </Button>
    </form>
  )
}

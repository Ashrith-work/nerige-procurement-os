'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cancelOrder, type CancelState } from '../actions'
import { Button, Alert } from '@/components/ui/primitives'

const INITIAL: CancelState = { status: 'idle' }

/**
 * Cancelling is destructive from the weaver's side — she may already be at the
 * loom — so it asks once. Not a modal: a second button in place is enough on a
 * screen where nothing else is a button.
 */
export function CancelForm({ orderId, vendorName }: { orderId: string; vendorName: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [state, action, pending] = useActionState(cancelOrder, INITIAL)

  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Cancel this order
      </Button>
    )
  }

  return (
    <form
      action={async (fd) => {
        await action(fd)
        router.refresh()
      }}
      className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <p className="text-sm text-red-900">
        Cancel this order? {vendorName} may already have started weaving. She will see it as
        cancelled the next time she opens the portal.
      </p>
      {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? 'Cancelling…' : 'Yes, cancel it'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
    </form>
  )
}

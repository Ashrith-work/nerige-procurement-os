import { Card, Button, Textarea } from '@/components/ui/primitives'
import { formatDateTime } from '@/lib/format'
import { postOrderMessage } from '@/app/(app)/purchase-orders/actions'

export interface ThreadMessage {
  id: string
  body: string
  is_internal: boolean
  created_at: string
  author_id: string | null
  app_users: { full_name: string; role: string } | null
}

/**
 * The conversation about one order.
 *
 * This exists to pull "can we send 20 now and 20 next week?" out of WhatsApp
 * and put it next to the order it is about. Six weeks later, when nobody can
 * remember what was agreed, the answer is on the order rather than in
 * somebody's phone.
 *
 * Internal notes are rendered visibly marked. That is a deliberate UI choice on
 * top of a database guarantee: the RLS policy already makes them unreadable to
 * the vendor, and the marker stops a member of staff writing something in the
 * wrong box in the belief that it is private.
 */
export function OrderThread({
  purchaseOrderId,
  vendorId,
  messages,
  returnTo,
  canPostInternal,
}: {
  purchaseOrderId: string
  vendorId: string
  messages: ThreadMessage[]
  returnTo: string
  canPostInternal: boolean
}) {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Conversation</h2>
        <p className="text-xs text-stone-500">
          Anything agreed about this order belongs here, not in a chat app.
        </p>
      </div>

      {messages.length === 0 ? (
        <p className="text-sm text-stone-500">Nothing said yet.</p>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => (
            <li
              key={m.id}
              className={
                m.is_internal
                  ? 'rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2'
                  : 'rounded-lg bg-stone-50 px-3 py-2'
              }
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-stone-700">
                  {m.app_users?.full_name ?? 'Someone'}
                  {m.is_internal && (
                    <span className="ml-2 font-normal text-amber-700">
                      Internal — the vendor cannot see this
                    </span>
                  )}
                </span>
                <span className="text-xs text-stone-400">{formatDateTime(m.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-stone-800">{m.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form action={postOrderMessage} className="space-y-2">
        <input type="hidden" name="purchase_order_id" value={purchaseOrderId} />
        <input type="hidden" name="vendor_id" value={vendorId} />
        <input type="hidden" name="return_to" value={returnTo} />

        <Textarea name="body" rows={2} required placeholder="Write a message…" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          {canPostInternal ? (
            <label className="flex items-center gap-2 text-sm text-stone-600">
              <input type="checkbox" name="is_internal" className="size-4 rounded" />
              Internal note
            </label>
          ) : (
            <span />
          )}
          <Button type="submit" variant="secondary">
            Post
          </Button>
        </div>
      </form>
    </Card>
  )
}

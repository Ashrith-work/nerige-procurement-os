'use client'

import { useActionState, useState } from 'react'
import { submitBill, type BillFormState } from '@/app/(app)/bills/actions'
import { Alert, Button, Card, Field, Input, Select } from '@/components/ui/primitives'
import { moneyExact, todayIso } from '@/lib/format'

const INITIAL: BillFormState = { status: 'idle' }

export interface BillableOrder {
  id: string
  po_number: string
  label: string
  /** Value of what was actually counted in, so the total can be sanity-checked. */
  receivedValue: number
}

/**
 * Uploading a bill.
 *
 * The running total is shown live against what was counted in, before the form
 * is submitted. That is the whole reason to type the figures rather than just
 * filing the photograph: a bill for more than arrived should be visible at the
 * moment it is entered, not discovered at payment time when the goods are long
 * since on the shelves.
 */
export function BillForm({
  orders,
  defaultOrderId,
  /** Vendors upload from the portal; staff from the bills screen. */
  audience,
}: {
  orders: BillableOrder[]
  defaultOrderId?: string
  audience: 'vendor' | 'staff'
}) {
  const [state, action, pending] = useActionState(submitBill, INITIAL)
  const [orderId, setOrderId] = useState(defaultOrderId ?? orders[0]?.id ?? '')
  const [subtotal, setSubtotal] = useState('')
  const [tax, setTax] = useState('')

  const err = state.fieldErrors ?? {}
  const order = orders.find((o) => o.id === orderId)
  const total = (Number(subtotal) || 0) + (Number(tax) || 0)
  const overBilled = order && total > 0 && total > order.receivedValue + 0.5

  return (
    <form action={action} className="space-y-5">
      {state.status === 'error' && state.message && <Alert tone="error">{state.message}</Alert>}

      <Card className="space-y-4">
        {orders.length === 1 ? (
          <input type="hidden" name="purchase_order_id" value={orders[0].id} />
        ) : (
          <Field label="Which order is this bill for?" required error={err.purchase_order_id}>
            <Select
              name="purchase_order_id"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              required
            >
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.po_number} — {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Bill number"
            required
            error={err.bill_number}
            hint="Exactly as printed on your bill book."
          >
            <Input name="bill_number" required maxLength={60} placeholder="0042" />
          </Field>
          <Field label="Bill date" required error={err.bill_date}>
            <Input type="date" name="bill_date" required defaultValue={todayIso()} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount before GST" required error={err.subtotal_amount}>
            <Input
              type="number"
              name="subtotal_amount"
              min={0}
              step="0.01"
              required
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
              placeholder="58000"
            />
          </Field>
          <Field label="GST" error={err.tax_amount}>
            <Input
              type="number"
              name="tax_amount"
              min={0}
              step="0.01"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              placeholder="2900"
            />
          </Field>
        </div>

        <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-stone-500">Bill total</span>
            <span className="font-semibold tabular-nums">{moneyExact(total)}</span>
          </div>
          {order && (
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-stone-500">Value counted in against this order</span>
              <span className="tabular-nums text-stone-600">{moneyExact(order.receivedValue)}</span>
            </div>
          )}
        </div>

        {overBilled && (
          <Alert tone="error">
            {audience === 'vendor'
              ? 'This is more than the value of the pieces counted in so far. If some were sent short or arrived damaged, the bill may be queried.'
              : 'This bill exceeds the value counted in. It will be flagged as a variance for review.'}
          </Alert>
        )}
      </Card>

      <Card className="space-y-3">
        <Field
          label="Photo or scan of the bill"
          required
          error={err.document}
          hint="A clear photo of the hard copy is fine. PDF, JPEG, PNG, WebP or HEIC, up to 25 MB."
        >
          <input
            type="file"
            name="document"
            required
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-stone-900 file:px-4 file:text-sm file:font-medium file:text-white"
          />
        </Field>
        <p className="text-xs text-stone-500">
          The paper is the record. Without it there is nothing to check a disputed figure against.
        </p>
      </Card>

      <Button type="submit" disabled={pending}>
        {pending ? 'Uploading…' : 'Submit bill'}
      </Button>
    </form>
  )
}

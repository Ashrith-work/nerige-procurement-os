'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { createPurchaseOrder, type FormState } from '../actions'
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives'

const INITIAL: FormState = { status: 'idle' }

interface VendorOption {
  id: string
  display_name: string
  code: string
  default_lead_time_days: number
}

/** ISO date `days` from today, for the `required_by` default. */
function isoIn(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function NewOrderForm({ vendors }: { vendors: VendorOption[] }) {
  const [state, action, pending] = useActionState(createPurchaseOrder, INITIAL)
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? '')

  const vendor = vendors.find((v) => v.id === vendorId)
  const err = state.fieldErrors ?? {}

  return (
    <form action={action} className="space-y-5">
      {state.status === 'error' && state.message && <Alert tone="error">{state.message}</Alert>}

      <Card className="space-y-4">
        <Field label="Vendor" required error={err.vendor_id}>
          <Select
            name="vendor_id"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            required
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.display_name} ({v.code})
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="What is this order?"
          hint="How the team refers to it on the call — “Week of 11 Aug”, “Diwali drop 1”."
          error={err.title}
        >
          <Input name="title" maxLength={120} placeholder="Week of 11 Aug" />
        </Field>

        <Field
          label="Needed by"
          error={err.required_by}
          hint={
            vendor
              ? // Seeded from the vendor's own lead time, so the default is a
                // date they have a chance of meeting rather than an optimistic
                // one that makes every order look late.
                `${vendor.display_name} usually takes about ${vendor.default_lead_time_days} days.`
              : undefined
          }
        >
          <Input
            type="date"
            name="required_by"
            key={vendorId}
            defaultValue={isoIn(vendor?.default_lead_time_days ?? 21)}
          />
        </Field>

        <Field
          label="Instructions for the vendor"
          hint="Packing, labelling, anything agreed on the call. The vendor sees this."
          error={err.instructions}
        >
          <Textarea
            name="instructions"
            rows={3}
            maxLength={4000}
            placeholder="Write the SKU code on every piece before packing."
          />
        </Field>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create draft'}
        </Button>
        <Link href="/purchase-orders" className="text-sm text-stone-500 hover:text-stone-900">
          Cancel
        </Link>
      </div>

      <p className="text-xs text-stone-500">
        The order is created as a draft. The vendor cannot see it until you issue it.
      </p>
    </form>
  )
}

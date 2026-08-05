'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { createProduct, createSeries, type CatalogueFormState } from '../actions'
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives'

const INITIAL: CatalogueFormState = { status: 'idle' }

interface VendorOption {
  id: string
  display_name: string
  code: string
}

interface SeriesOption {
  id: string
  name: string
  code: string
  vendor_id: string
}

export function ProductForm({
  vendors,
  series,
  defaultVendorId,
}: {
  vendors: VendorOption[]
  series: SeriesOption[]
  defaultVendorId?: string
}) {
  const [state, action, pending] = useActionState(createProduct, INITIAL)
  const [vendorId, setVendorId] = useState(defaultVendorId ?? vendors[0]?.id ?? '')
  const [showSeriesForm, setShowSeriesForm] = useState(false)

  const vendor = vendors.find((v) => v.id === vendorId)
  // A series belongs to one vendor, so offering another vendor's series would
  // produce a row the database rejects. Filtered rather than validated.
  const vendorSeries = series.filter((s) => s.vendor_id === vendorId)
  const err = state.fieldErrors ?? {}

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-5">
        {state.status === 'error' && state.message && <Alert tone="error">{state.message}</Alert>}

        <Card className="space-y-4">
          <Field label="Who makes it?" required error={err.vendor_id}>
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
            label="SKU code"
            required
            error={err.sku}
            hint={
              vendor
                ? `The existing convention embeds the vendor — e.g. ${vendor.code.toLowerCase()}wb14090. Codes are unique across every vendor.`
                : 'Codes are unique across every vendor.'
            }
          >
            <Input
              name="sku"
              required
              maxLength={40}
              placeholder={vendor ? `${vendor.code.toLowerCase()}wb14090` : 'shanwb14090'}
              className="font-mono"
            />
          </Field>

          <Field
            label="What is it?"
            required
            error={err.title}
            hint="How the vendor would describe it back to you."
          >
            <Input name="title" required maxLength={200} placeholder="Woven border saree — mustard" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Colour" error={err.colour}>
              <Input name="colour" maxLength={60} placeholder="Mustard" />
            </Field>
            <Field label="Fabric" error={err.fabric}>
              <Input name="fabric" maxLength={60} placeholder="Cotton silk" />
            </Field>
            <Field label="Distinguishing detail" error={err.variant_note}>
              <Input name="variant_note" maxLength={200} placeholder="Wide zari border" />
            </Field>
          </div>

          <Field label="Series" hint="Groups designs into a family. Optional.">
            <Select name="series_id" defaultValue="" key={vendorId}>
              <option value="">No series</option>
              {vendorSeries.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </Select>
          </Field>

          <button
            type="button"
            onClick={() => setShowSeriesForm((v) => !v)}
            className="text-sm text-stone-600 underline"
          >
            {showSeriesForm ? 'Never mind' : 'Create a new series for this vendor'}
          </button>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold">Commercials</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="What we pay per piece"
              error={err.cost_price}
              hint="The default for a new order line. Each order keeps its own agreed price."
            >
              <Input type="number" name="cost_price" min={0} step="0.01" placeholder="1450" />
            </Field>
            <Field label="Selling price (MRP)" error={err.mrp}>
              <Input type="number" name="mrp" min={0} step="0.01" placeholder="3499" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="HSN code" error={err.hsn_code} hint="4–8 digits. Appears on the invoice.">
              <Input name="hsn_code" maxLength={8} placeholder="5407" />
            </Field>
            <Field label="GST rate" required error={err.gst_rate}>
              <Select name="gst_rate" defaultValue="5">
                {[0, 5, 12, 18, 28].map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="Photo link"
            error={err.image_url}
            hint="A Shopify image URL. Helps the vendor recognise which design a code belongs to."
          >
            <Input name="image_url" type="url" placeholder="https://cdn.shopify.com/…" />
          </Field>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Add to catalogue'}
          </Button>
          <Link href="/catalogue" className="text-sm text-stone-500 hover:text-stone-900">
            Cancel
          </Link>
        </div>
      </form>

      {/* A separate form, not a nested one — HTML forbids nesting, and a series
          is a real record in its own right rather than a field on a product. */}
      {showSeriesForm && <SeriesForm vendorId={vendorId} />}
    </div>
  )
}

function SeriesForm({ vendorId }: { vendorId: string }) {
  const [state, action, pending] = useActionState(createSeries, INITIAL)
  const err = state.fieldErrors ?? {}

  return (
    <Card className="space-y-4 border-sky-200 bg-sky-50/40">
      <h2 className="text-sm font-semibold">New series</h2>
      <form action={action} className="space-y-4">
        <input type="hidden" name="vendor_id" value={vendorId} />
        {state.status === 'error' && state.message && <Alert tone="error">{state.message}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Series code" required error={err.code} hint="Becomes part of the SKU — WB, TB.">
            <Input name="code" required maxLength={16} placeholder="WB" className="font-mono uppercase" />
          </Field>
          <Field label="Series name" required error={err.name}>
            <Input name="name" required maxLength={120} placeholder="Woven Border" />
          </Field>
        </div>

        <Field label="The brief" error={err.description} hint="How the design family was described.">
          <Textarea
            name="description"
            rows={2}
            maxLength={2000}
            placeholder="Mustard body, maroon border, gold zari."
          />
        </Field>

        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Creating…' : 'Create series'}
        </Button>
      </form>
    </Card>
  )
}

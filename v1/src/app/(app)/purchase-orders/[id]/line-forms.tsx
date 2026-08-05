'use client'

import { useActionState, useState } from 'react'
import { addRestockLine, addNewDesignLine, type FormState } from '../actions'
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives'

const INITIAL: FormState = { status: 'idle' }

export interface ProductOption {
  id: string
  sku: string
  title: string
  colour: string | null
  cost_price: string | null
  last_ordered_at: string | null
  product_series: { name: string } | null
}

export interface SeriesOption {
  id: string
  name: string
}

/**
 * The two ways to add to an order, side by side.
 *
 * Presented as two distinct forms rather than one form with a type switch,
 * because they are two different conversations. A restock is "forty more of
 * the mustard one"; a new design is a paragraph describing something nobody
 * has woven yet. Collapsing them into one control with conditional fields
 * would make both worse.
 */
export function LineForms({
  purchaseOrderId,
  products,
  series,
}: {
  purchaseOrderId: string
  products: ProductOption[]
  series: SeriesOption[]
}) {
  const [tab, setTab] = useState<'restock' | 'new_design'>(
    products.length > 0 ? 'restock' : 'new_design',
  )

  return (
    <Card className="space-y-4">
      <div className="flex gap-1.5">
        {(
          [
            ['restock', 'Restock a SKU'],
            ['new_design', 'Commission a new design'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white'
                : 'rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'restock' ? (
        <RestockForm purchaseOrderId={purchaseOrderId} products={products} />
      ) : (
        <NewDesignForm purchaseOrderId={purchaseOrderId} series={series} />
      )}
    </Card>
  )
}

function RestockForm({
  purchaseOrderId,
  products,
}: {
  purchaseOrderId: string
  products: ProductOption[]
}) {
  const [state, action, pending] = useActionState(addRestockLine, INITIAL)
  const [productId, setProductId] = useState(products[0]?.id ?? '')

  const product = products.find((p) => p.id === productId)
  const err = state.fieldErrors ?? {}

  if (products.length === 0) {
    return (
      <p className="text-sm text-stone-500">
        This vendor has no SKUs in the catalogue yet. Add one from the catalogue, or commission a
        new design instead.
      </p>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="purchase_order_id" value={purchaseOrderId} />
      {state.status === 'error' && state.message && <Alert tone="error">{state.message}</Alert>}

      <Field label="Which SKU?" required error={err.product_id}>
        <Select
          name="product_id"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          required
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} — {p.title}
              {p.colour ? ` (${p.colour})` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pieces" required error={err.quantity}>
          <Input type="number" name="quantity" min={1} step={1} required placeholder="40" />
        </Field>
        <Field
          label="Price per piece"
          required
          error={err.unit_price}
          // Pre-filled from the catalogue but editable: the price is agreed on
          // the call and this order's price is what the vendor gets paid,
          // whatever the catalogue says today.
          hint="Pre-filled from the catalogue. Change it if a different rate was agreed."
        >
          <Input
            type="number"
            name="unit_price"
            min={0}
            step="0.01"
            required
            key={productId}
            defaultValue={product?.cost_price ?? ''}
          />
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add to order'}
      </Button>
    </form>
  )
}

function NewDesignForm({
  purchaseOrderId,
  series,
}: {
  purchaseOrderId: string
  series: SeriesOption[]
}) {
  const [state, action, pending] = useActionState(addNewDesignLine, INITIAL)
  const err = state.fieldErrors ?? {}

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="purchase_order_id" value={purchaseOrderId} />
      {state.status === 'error' && state.message && <Alert tone="error">{state.message}</Alert>}

      <Field
        label="The brief"
        required
        error={err.description}
        hint="Write it as it was said on the call. This is the only description the weaver gets."
      >
        <Textarea
          name="description"
          rows={3}
          required
          maxLength={2000}
          placeholder="Teal body, gold temple border, fine zari pallu. Same weight as the WB series."
        />
      </Field>

      <Field
        label="Colour combinations"
        error={err.colours}
        hint="Comma separated. Counted at receipt, so list them rather than writing “six colours”."
      >
        <Input name="colours" placeholder="Teal, Rust, Olive, Maroon" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pieces" required error={err.quantity}>
          <Input type="number" name="quantity" min={1} step={1} required placeholder="30" />
        </Field>
        <Field label="Agreed price per piece" required error={err.unit_price}>
          <Input type="number" name="unit_price" min={0} step="0.01" required placeholder="1600" />
        </Field>
      </div>

      {series.length > 0 && (
        <Field
          label="Part of an existing series?"
          hint="Optional. Leave blank if this is a brand-new family of designs."
        >
          <Select name="series_id" defaultValue="">
            <option value="">New series</option>
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add to order'}
      </Button>

      <p className="text-xs text-stone-500">
        No SKU is created now. The code is assigned when the pieces arrive and can be seen.
      </p>
    </form>
  )
}

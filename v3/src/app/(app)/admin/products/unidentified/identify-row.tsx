'use client'

import { useActionState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Button, Select } from '@/components/ui/primitives'
import { identifyVendor, type IdentifyState } from './actions'
import { cropStyle, sizedImage, type CropRect } from '@/lib/products/image'

export interface UnidentifiedProduct {
  sku: string
  title: string | null
  imageUrl: string | null
  crop: CropRect
  unitsLast30Days: number
  unitsLastYear: number
}

export interface VendorOption {
  code: string
  displayName: string
}

/**
 * One row of the holding pen: the photograph, the SKU, how it sells, and a
 * weaver to assign.
 *
 * THE PHOTOGRAPH IS THE POINT. Nobody can identify a weaver from `VINTWB14700`.
 * They can often identify one from the saree — the border, the pallu, the
 * weave — which is why this is a picture with a dropdown beside it rather than
 * a table of codes. It is the same argument the vendor portal was built on.
 *
 * The sales figures are here for the same reason: they say which of the hundred
 * is worth the effort of identifying first. A design that sold 250 pieces in a
 * month and cannot be reordered because it has no weaver is the expensive one.
 */
export function IdentifyRow({
  product,
  vendors,
}: {
  product: UnidentifiedProduct
  vendors: VendorOption[]
}) {
  const [state, formAction, pending] = useActionState<IdentifyState, FormData>(identifyVendor, {
    status: 'idle',
  })

  const sized = sizedImage(product.imageUrl, 400)

  return (
    <li className="flex gap-4 border-b border-stone-200 py-4 last:border-b-0">
      <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded bg-stone-100">
        {sized ? (
          <div className="absolute inset-0">
            <div className="absolute" style={cropStyle(product.crop)}>
              <Image
                src={sized}
                alt={product.title ?? product.sku}
                fill
                sizes="96px"
                className="object-cover"
                unoptimized
              />
            </div>
          </div>
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-stone-400">
            no photo
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <Link
          href={`/admin/products/${encodeURIComponent(product.sku)}`}
          className="font-mono text-sm text-stone-900 underline-offset-2 hover:underline"
        >
          {product.sku}
        </Link>
        <p className="truncate text-sm text-stone-600">{product.title ?? '—'}</p>
        <p className="mt-1 text-xs text-stone-500">
          {product.unitsLast30Days} sold in 30 days · {product.unitsLastYear} in a year
        </p>

        <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="sku" value={product.sku} />
          <Select name="vendor_code" defaultValue="" className="max-w-xs" disabled={pending}>
            <option value="">Which weaver made this?</option>
            {vendors.map((v) => (
              <option key={v.code} value={v.code}>
                {v.code} — {v.displayName}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={pending}>
            {pending ? 'Assigning…' : 'Assign'}
          </Button>

          {state.status === 'saved' && state.sku === product.sku && (
            <span className="text-sm text-green-700">{state.message}</span>
          )}
          {state.status === 'error' && (
            <span className="text-sm text-red-700">{state.message}</span>
          )}
        </form>
      </div>
    </li>
  )
}

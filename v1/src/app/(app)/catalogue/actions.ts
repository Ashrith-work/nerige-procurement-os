'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isDemoMode } from '@/lib/demo'
import { demoWriteRefusal } from '@/lib/demo/procurement'
import { requireRole } from '@/lib/auth/session'

export interface CatalogueFormState {
  status: 'idle' | 'error'
  message?: string
  fieldErrors?: Record<string, string>
}

const CATALOGUE_MANAGERS = ['founder', 'procurement_head'] as const

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0])
    out[key] ??= issue.message
  }
  return out
}

const ProductSchema = z.object({
  vendor_id: z.uuid('Choose the vendor who makes this.'),
  series_id: z.string().trim().optional().or(z.literal('')),
  sku: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$/,
      'Use 2–40 characters: letters, digits, dot, dash, slash or underscore.',
    ),
  title: z.string().trim().min(2, 'Give it a name the vendor will recognise.').max(200),
  colour: z.string().trim().max(60).optional().or(z.literal('')),
  fabric: z.string().trim().max(60).optional().or(z.literal('')),
  variant_note: z.string().trim().max(200).optional().or(z.literal('')),
  cost_price: z.coerce.number().nonnegative().optional(),
  mrp: z.coerce.number().nonnegative().optional(),
  hsn_code: z.string().trim().optional().or(z.literal('')),
  gst_rate: z.coerce.number().min(0).max(28),
  image_url: z.url('That does not look like a link.').optional().or(z.literal('')),
})

/**
 * Adds a SKU to the catalogue.
 *
 * The SKU is the whole point of this table: it is the string the vendor writes
 * on the label, the string Shopify sells under, and the string the warehouse
 * reads at inward. It is unique across every vendor because the label is
 * physical — two vendors sharing a code makes the piece in your hand
 * ambiguous.
 */
export async function createProduct(
  _prev: CatalogueFormState,
  formData: FormData,
): Promise<CatalogueFormState> {
  const user = await requireRole(...CATALOGUE_MANAGERS)

  if (isDemoMode()) return { status: 'error', message: demoWriteRefusal() }

  const parsed = ProductSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    }
  }
  const v = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.from('products').insert({
    vendor_id: v.vendor_id,
    series_id: v.series_id || null,
    sku: v.sku,
    title: v.title,
    colour: v.colour || null,
    fabric: v.fabric || null,
    variant_note: v.variant_note || null,
    cost_price: v.cost_price ?? null,
    mrp: v.mrp ?? null,
    hsn_code: v.hsn_code || null,
    gst_rate: v.gst_rate,
    image_url: v.image_url || null,
    created_by: user.id,
  })

  if (error) {
    if (error.code === '23505') {
      return {
        status: 'error',
        message: 'That SKU is already in use.',
        fieldErrors: { sku: 'Already in the catalogue — codes are unique across all vendors.' },
      }
    }
    return { status: 'error', message: error.message }
  }

  revalidatePath('/catalogue')
  redirect(`/catalogue?vendor=${v.vendor_id}`)
}

const SeriesSchema = z.object({
  vendor_id: z.uuid('Choose a vendor.'),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/, 'Up to 16 characters: letters, digits, dash.'),
  name: z.string().trim().min(2, 'Name the series.').max(120),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
})

export async function createSeries(
  _prev: CatalogueFormState,
  formData: FormData,
): Promise<CatalogueFormState> {
  const user = await requireRole(...CATALOGUE_MANAGERS)

  if (isDemoMode()) return { status: 'error', message: demoWriteRefusal() }

  const parsed = SeriesSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    }
  }
  const v = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.from('product_series').insert({
    vendor_id: v.vendor_id,
    code: v.code,
    name: v.name,
    description: v.description || null,
    status: 'active',
    created_by: user.id,
  })

  if (error) {
    if (error.code === '23505') {
      return {
        status: 'error',
        message: 'This vendor already has a series with that code.',
        fieldErrors: { code: 'Already used for this vendor.' },
      }
    }
    return { status: 'error', message: error.message }
  }

  revalidatePath('/catalogue')
  redirect(`/catalogue?vendor=${v.vendor_id}&tab=series`)
}

/**
 * Turns a commissioned design into a real SKU, at the moment the pieces are
 * physically in front of someone.
 *
 * This is the join between the two halves of the weekly order. A `new_design`
 * line carries a brief and no code, deliberately, because the saree did not
 * exist when it was ordered. It exists now — it is on the receiving table — so
 * this is the first honest moment to name it. Creating the code earlier would
 * mean guessing what arrived.
 *
 * The new product is linked back to the line that commissioned it through the
 * series, so "which order did this design start on?" stays answerable.
 */
export async function createSkuForDesignLine(formData: FormData): Promise<void> {
  await requireRole(...CATALOGUE_MANAGERS)

  const lineId = String(formData.get('line_id'))
  const sku = String(formData.get('sku') ?? '').trim()
  const title = String(formData.get('title') ?? '').trim()
  const colour = String(formData.get('colour') ?? '').trim()
  const returnTo = String(formData.get('return_to') ?? '/purchase-orders')

  const fail = (msg: string) => redirect(`${returnTo}?error=${encodeURIComponent(msg)}`)
  if (isDemoMode()) fail(demoWriteRefusal())

  if (!sku || !title) fail('A code and a name are both needed to create the SKU.')

  const supabase = await createClient()

  const { data: line } = await supabase
    .from('purchase_order_lines')
    .select('id, vendor_id, series_id, description, unit_price, kind')
    .eq('id', lineId)
    .maybeSingle()

  if (!line) fail('That order line could not be found.')
  if (line!.kind !== 'new_design') fail('That line already has a SKU.')

  let seriesId = line!.series_id

  // A design commissioned without naming a series gets one now, recorded as
  // having originated on this line.
  if (!seriesId) {
    const { data: series, error: seriesError } = await supabase
      .from('product_series')
      .insert({
        vendor_id: line!.vendor_id,
        code: sku.slice(0, 16),
        name: title,
        description: line!.description,
        status: 'active',
        origin_po_line_id: line!.id,
      })
      .select('id')
      .single()

    if (seriesError) fail(`Could not create the series: ${seriesError.message}`)
    seriesId = series!.id
  }

  const { data: product, error } = await supabase
    .from('products')
    .insert({
      vendor_id: line!.vendor_id,
      series_id: seriesId,
      sku,
      title,
      colour: colour || null,
      cost_price: line!.unit_price,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) {
    fail(
      error.code === '23505'
        ? `The code ${sku} is already in the catalogue.`
        : `Could not create the SKU: ${error.message}`,
    )
  }

  // Point the receipt line at the SKU that was just created, so what was
  // counted and what it is called are the same record from here on.
  await supabase
    .from('goods_receipt_lines')
    .update({ product_id: product!.id })
    .eq('purchase_order_line_id', lineId)
    .is('product_id', null)

  revalidatePath(returnTo)
  revalidatePath('/catalogue')
  redirect(returnTo)
}

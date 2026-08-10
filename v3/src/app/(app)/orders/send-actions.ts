'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireProcurement } from '@/lib/auth/session'
import { getDictionary, resolveLocale, type Locale } from '@/lib/i18n'
import { sizedImage } from '@/lib/products/image'
import {
  sendOrderOnWhatsApp,
  whatsAppConfig,
  WhatsAppError,
  type OrderLineMessage,
} from '@/lib/integrations/whatsapp'

export interface SendState {
  status: 'idle' | 'sent' | 'error'
  message?: string
}

/**
 * Sending an order to the vendor dashboard.
 *
 * An issued order is already in her portal — that is what issuing means — so
 * this does not move anything. It records the fact with a timestamp, which is
 * the thing that was previously implicit and therefore unanswerable: "was this
 * delivered to the dashboard, and when?" had no answer except "the order
 * exists, so presumably".
 *
 * It is also idempotent by design. Pressing it twice must not rewrite the
 * original delivery time to now.
 */
export async function sendToDashboard(_prev: SendState, formData: FormData): Promise<SendState> {
  await requireProcurement()

  const orderId = String(formData.get('orderId') ?? '')
  if (!orderId) return { status: 'error', message: 'No order given.' }

  const supabase = await createClient()

  const { data: order } = await supabase
    .from('orders')
    .select('id, dashboard_sent_at')
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return { status: 'error', message: 'That order is not here.' }

  if (order.dashboard_sent_at) {
    return { status: 'sent', message: 'Already in her portal.' }
  }

  const { error } = await supabase
    .from('orders')
    .update({ dashboard_sent_at: new Date().toISOString() })
    .eq('id', orderId)

  if (error) return { status: 'error', message: `Could not record it: ${error.message}` }

  revalidatePath(`/orders/${orderId}`)
  return { status: 'sent', message: 'In her portal.' }
}

/**
 * Sending the same order on WhatsApp.
 *
 * Both channels can be used on the same order, and frequently should be: the
 * portal is the record, the WhatsApp message is what actually reaches a weaver
 * who does not open the portal for three days.
 *
 * The message text is in HER language — `vendors.default_locale`, not the
 * admin's. The saree names and SKU codes inside it are not translated, because
 * they are the strings she writes on the fabric.
 *
 * A partial send is recorded as one. If the template goes but four of twelve
 * images fail, `whatsapp_status` stays `sent` and the message says how many
 * arrived — reporting that as a clean success is how somebody assumes a weaver
 * has seen twelve photographs when she has seen eight.
 */
export async function sendOnWhatsApp(_prev: SendState, formData: FormData): Promise<SendState> {
  await requireProcurement()

  const orderId = String(formData.get('orderId') ?? '')
  if (!orderId) return { status: 'error', message: 'No order given.' }

  const config = whatsAppConfig()
  if (!config) {
    return {
      status: 'error',
      message:
        'WhatsApp is not connected. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN — see v3/docs/whatsapp-setup.md.',
    }
  }

  const supabase = await createClient()

  const { data: order } = await supabase
    .from('orders')
    .select(
      `id, order_number, vendor_id,
       vendors ( display_name, whatsapp_number, default_locale ),
       order_lines (
         line_type, sku, brief, quantity, snapshot_title, snapshot_image_url,
         order_line_refs ( snapshot_image_url )
       )`,
    )
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return { status: 'error', message: 'That order is not here.' }

  type V = { display_name: string; whatsapp_number: string | null; default_locale: string }
  const embedded = order.vendors as V | V[] | null
  const vendor = Array.isArray(embedded) ? embedded[0] : embedded

  if (!vendor?.whatsapp_number) {
    return {
      status: 'error',
      message: `${vendor?.display_name ?? 'This weaver'} has no WhatsApp number. Add one on her vendor screen, with the country code.`,
    }
  }

  const locale = resolveLocale(null, vendor.default_locale) as Locale
  const t = getDictionary(locale)

  interface RawLine {
    line_type: string
    sku: string | null
    brief: string | null
    quantity: number
    snapshot_title: string | null
    snapshot_image_url: string | null
    order_line_refs: { snapshot_image_url: string | null }[] | null
  }

  const lines: OrderLineMessage[] = ((order.order_lines ?? []) as RawLine[])
    // Restock first, then new designs — the same order as the portal screen, so
    // the two do not teach different sequences.
    .sort((a, b) => (a.line_type === b.line_type ? 0 : a.line_type === 'restock' ? -1 : 1))
    .map((line) => ({
      // 800px: the width the vendor card asks for. WhatsApp re-encodes anyway,
      // and sending a 3,000px original costs her mobile data to receive.
      imageUrl: sizedImage(
        line.snapshot_image_url ?? line.order_line_refs?.[0]?.snapshot_image_url ?? null,
        800,
      ),
      sku: line.line_type === 'restock' ? line.sku : null,
      name: line.line_type === 'restock' ? line.snapshot_title : line.brief,
      quantity: line.quantity,
    }))

  if (lines.length === 0) return { status: 'error', message: 'That order has no lines.' }

  try {
    const result = await sendOrderOnWhatsApp(config, {
      to: vendor.whatsapp_number,
      vendorName: vendor.display_name,
      orderNumber: order.order_number,
      lines,
      locale,
      strings: {
        quantity: t.order.pieces_other.replace('{n}', '').trim(),
        noCode: t.order.noCode,
        restockHeading: t.order.sectionRestock,
        newDesignHeading: t.order.sectionNewDesigns,
      },
      portalUrl: null,
    })

    await supabase
      .from('orders')
      .update({
        whatsapp_sent_at: new Date().toISOString(),
        whatsapp_message_id: result.messageId,
        // `sent`, not `delivered`. WhatsApp accepting a message means it left
        // us; only the webhook can say it arrived.
        whatsapp_status: 'sent',
        whatsapp_error:
          result.imagesFailed > 0
            ? `${result.imagesFailed} of ${lines.length} photographs did not send`
            : null,
      })
      .eq('id', orderId)

    revalidatePath(`/orders/${orderId}`)

    return {
      status: 'sent',
      message:
        result.imagesFailed > 0
          ? `Sent — but ${result.imagesFailed} of ${lines.length} photographs failed. She has the order and ${result.imagesSent} pictures.`
          : `Sent — ${result.imagesSent} photographs.`,
    }
  } catch (err) {
    const message = err instanceof WhatsAppError ? err.message : String(err)

    await supabase
      .from('orders')
      .update({ whatsapp_status: 'failed', whatsapp_error: message.slice(0, 1000) })
      .eq('id', orderId)

    revalidatePath(`/orders/${orderId}`)
    return { status: 'error', message }
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireProcurement } from '@/lib/auth/session'
import { buildPurchaseOrder, type PoDocument, type PoLine } from '@/lib/po/pdf'
import { uploadToDrive, driveConfig, DriveError } from '@/lib/integrations/drive'
import { postPurchaseOrder, slackConfig, SlackError } from '@/lib/integrations/slack'

export interface PoState {
  status: 'idle' | 'done' | 'error'
  message?: string
}

/**
 * Generate → upload → send. Three actions, in that order, each usable alone.
 *
 * They are separate rather than one button because each can fail for a
 * completely different reason and the recovery differs: a PDF that failed to
 * build is a bug, a Drive upload that failed is nearly always the folder not
 * being shared with the service account, and a Slack post that failed is
 * nearly always the bot not being in the channel. One button would report all
 * three as "could not send the PO".
 *
 * The number is allocated by the database, once. Pressing Generate twice
 * produces the same PO number against the same order — an identifier that
 * changes when a document is reprinted is not an identifier.
 */

async function loadOrder(orderId: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('orders')
    .select(
      `id, order_number, issued_at, po_number, po_drive_link, po_drive_file_id,
       vendors ( display_name, code, primary_phone, whatsapp_number ),
       order_lines (
         line_type, sku, brief, quantity, snapshot_title, snapshot_image_url,
         order_line_refs ( snapshot_image_url )
       )`,
    )
    .eq('id', orderId)
    .maybeSingle()

  return { supabase, order: data }
}

interface RawLine {
  line_type: string
  sku: string | null
  brief: string | null
  quantity: number
  snapshot_title: string | null
  snapshot_image_url: string | null
  order_line_refs: { snapshot_image_url: string | null }[] | null
}

function toLines(raw: RawLine[]): { restock: PoLine[]; newDesigns: PoLine[] } {
  const restock: PoLine[] = []
  const newDesigns: PoLine[] = []

  for (const line of raw) {
    const entry: PoLine = {
      sku: line.line_type === 'restock' ? line.sku : null,
      name: line.line_type === 'restock' ? line.snapshot_title : line.brief,
      quantity: line.quantity,
      // A new-design line carries no photograph of its own; the first reference
      // image is the closest thing to one.
      imageUrl:
        line.snapshot_image_url ?? line.order_line_refs?.[0]?.snapshot_image_url ?? null,
      isNewDesign: line.line_type !== 'restock',
    }

    if (entry.isNewDesign) newDesigns.push(entry)
    else restock.push(entry)
  }

  return { restock, newDesigns }
}

export async function generatePo(_prev: PoState, formData: FormData): Promise<PoState> {
  const admin = await requireProcurement()

  const orderId = String(formData.get('orderId') ?? '')
  if (!orderId) return { status: 'error', message: 'No order given.' }

  const { supabase, order } = await loadOrder(orderId)
  if (!order) return { status: 'error', message: 'That order is not here.' }

  // Allocated in the database, from a sequence, so two admins pressing at once
  // cannot be handed the same number.
  const { data: poNumber, error: numberError } = await supabase.rpc('allocate_po_number', {
    p_order_id: orderId,
  })

  if (numberError || !poNumber) {
    return { status: 'error', message: `Could not allocate a PO number: ${numberError?.message}` }
  }

  const { error } = await supabase
    .from('orders')
    .update({ po_generated_at: new Date().toISOString(), po_generated_by: admin.id })
    .eq('id', orderId)

  if (error) return { status: 'error', message: `Could not record it: ${error.message}` }

  revalidatePath(`/orders/${orderId}`)
  return { status: 'done', message: `${poNumber} is ready. Download it, or upload it to Drive.` }
}

/**
 * Build the document and put it in the Drive folder from Settings.
 *
 * The PDF is built here rather than fetched from the download route so that an
 * upload never depends on the application being reachable from itself — which
 * is a real failure mode behind Vercel deployment protection, where a
 * server-side fetch of your own URL gets an authentication page instead of a
 * PDF.
 */
export async function uploadPoToDrive(_prev: PoState, formData: FormData): Promise<PoState> {
  await requireProcurement()

  const orderId = String(formData.get('orderId') ?? '')
  if (!orderId) return { status: 'error', message: 'No order given.' }

  const config = driveConfig()
  if (!config) {
    return {
      status: 'error',
      message:
        'Google Drive is not connected. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY — see v3/docs/google-drive-setup.md.',
    }
  }

  const { supabase, order } = await loadOrder(orderId)
  if (!order) return { status: 'error', message: 'That order is not here.' }
  if (!order.po_number) {
    return { status: 'error', message: 'Generate the PO first.' }
  }

  const { data: settings } = await supabase
    .from('app_settings')
    .select('drive_folder_id')
    .eq('id', 1)
    .maybeSingle()

  if (!settings?.drive_folder_id) {
    return {
      status: 'error',
      message: 'No Drive folder is set. Paste the folder link in Settings first.',
    }
  }

  type V = { display_name: string; code: string; primary_phone: string | null; whatsapp_number: string | null }
  const embedded = order.vendors as V | V[] | null
  const vendor = Array.isArray(embedded) ? embedded[0] : embedded

  const { restock, newDesigns } = toLines((order.order_lines ?? []) as RawLine[])

  const document: PoDocument = {
    poNumber: order.po_number,
    orderNumber: order.order_number,
    issuedAt: new Date(order.issued_at),
    vendorName: vendor?.display_name ?? 'Unknown vendor',
    vendorCode: vendor?.code ?? '',
    vendorPhone: vendor?.whatsapp_number ?? vendor?.primary_phone ?? null,
    restock,
    newDesigns,
  }

  try {
    const pdf = await buildPurchaseOrder(document)

    const result = await uploadToDrive(config, {
      folderId: settings.drive_folder_id,
      // Vendor code in the name, because these accumulate in one folder and
      // "NRG-PO-00042.pdf" tells nobody whose it is.
      fileName: `${order.po_number} ${vendor?.code ?? ''} ${vendor?.display_name ?? ''}.pdf`.trim(),
      mimeType: 'application/pdf',
      body: pdf,
    })

    await supabase
      .from('orders')
      .update({ po_drive_file_id: result.fileId, po_drive_link: result.webViewLink })
      .eq('id', orderId)

    revalidatePath(`/orders/${orderId}`)
    return { status: 'done', message: 'Uploaded to Drive.' }
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof DriveError ? err.message : `Could not upload: ${String(err)}`,
    }
  }
}

/** Post the Drive link to the Slack channel chosen in Settings. */
export async function sendPoToSlack(_prev: PoState, formData: FormData): Promise<PoState> {
  await requireProcurement()

  const orderId = String(formData.get('orderId') ?? '')
  const channelOverride = String(formData.get('channel') ?? '').trim()
  if (!orderId) return { status: 'error', message: 'No order given.' }

  const config = slackConfig()
  if (!config) {
    return {
      status: 'error',
      message: 'Slack is not connected. Set SLACK_BOT_TOKEN — see v3/docs/slack-setup.md.',
    }
  }

  const { supabase, order } = await loadOrder(orderId)
  if (!order) return { status: 'error', message: 'That order is not here.' }
  if (!order.po_number) return { status: 'error', message: 'Generate the PO first.' }

  const { data: settings } = await supabase
    .from('app_settings')
    .select('slack_channel_id')
    .eq('id', 1)
    .maybeSingle()

  const channel = channelOverride || settings?.slack_channel_id
  if (!channel) {
    return { status: 'error', message: 'No Slack channel is set. Choose one in Settings.' }
  }

  type V = { display_name: string; code: string }
  const embedded = order.vendors as V | V[] | null
  const vendor = Array.isArray(embedded) ? embedded[0] : embedded

  const lines = (order.order_lines ?? []) as RawLine[]

  try {
    const posted = await postPurchaseOrder(config, {
      channel,
      vendorName: vendor?.display_name ?? 'Unknown vendor',
      vendorCode: vendor?.code ?? '',
      poNumber: order.po_number,
      driveLink: order.po_drive_link,
      lineCount: lines.length,
      pieceCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    })

    await supabase
      .from('orders')
      .update({ po_slack_ts: posted.ts, po_slack_channel: posted.channel })
      .eq('id', orderId)

    revalidatePath(`/orders/${orderId}`)

    return {
      status: 'done',
      message: order.po_drive_link
        ? 'Posted to Slack.'
        : 'Posted to Slack — without a link, because it has not been uploaded to Drive yet.',
    }
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof SlackError ? err.message : `Could not post: ${String(err)}`,
    }
  }
}

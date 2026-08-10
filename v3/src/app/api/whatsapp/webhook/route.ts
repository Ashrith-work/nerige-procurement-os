import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Delivery receipts from Meta.
 *
 * Without this, `whatsapp_sent_at` means "we handed a message to Meta" and
 * nothing more. A wrong number, a weaver who has left WhatsApp, a handset that
 * has been off for a week — all of them accept the send and fail quietly some
 * minutes later. This is the only way the difference between `sent` and
 * `delivered` ever reaches the screen.
 *
 * TWO ROUTES IN ONE FILE, because Meta requires both at the same URL:
 *   GET  — the one-time verification handshake when the webhook is registered
 *   POST — the receipts themselves
 *
 * The POST is signed. `X-Hub-Signature-256` is an HMAC of the raw body with the
 * app secret, and it is checked before anything is parsed — this endpoint is
 * public by necessity, and without the check anyone could POST a `delivered`
 * for any message id and mark an order as received by a weaver who never got
 * it.
 */
export const dynamic = 'force-dynamic'

/** The handshake. Meta calls this once, when the webhook URL is saved. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN

  if (
    verifyToken &&
    params.get('hub.mode') === 'subscribe' &&
    params.get('hub.verify_token') === verifyToken
  ) {
    // Meta wants the challenge echoed as bare text. JSON fails verification.
    return new Response(params.get('hub.challenge') ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return new Response('Forbidden', { status: 403 })
}

function signatureValid(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET
  // No secret configured means no verifiable webhook. Refusing is the safe
  // default: accepting unsigned receipts is worse than accepting none.
  if (!secret || !header) return false

  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`

  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

interface StatusPayload {
  entry?: {
    changes?: {
      value?: {
        statuses?: {
          id: string
          status: string
          errors?: { title?: string; message?: string }[]
        }[]
      }
    }[]
  }[]
}

/** Meta's ladder. Later states must not be overwritten by earlier ones. */
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 }

export async function POST(request: NextRequest) {
  // The RAW body, before parsing. Re-serialising parsed JSON changes whitespace
  // and key order, and the signature would never match again.
  const raw = await request.text()

  if (!signatureValid(raw, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
  }

  let payload: StatusPayload
  try {
    payload = JSON.parse(raw) as StatusPayload
  } catch {
    return NextResponse.json({ ok: true })
  }

  const statuses =
    payload.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.statuses ?? []) ?? []) ?? []

  if (statuses.length === 0) return NextResponse.json({ ok: true })

  // Service role: there is no session on a webhook, and the alternative is a
  // policy permitting anonymous writes to `orders`.
  const db = createAdminClient()

  for (const status of statuses) {
    const { data: order } = await db
      .from('orders')
      .select('id, whatsapp_status')
      .eq('whatsapp_message_id', status.id)
      .maybeSingle()

    if (!order) continue

    // Receipts arrive out of order often enough to matter — `delivered` can
    // land after `read`, and letting it win would walk the status backwards on
    // a message the weaver has already opened.
    const current = RANK[order.whatsapp_status ?? 'queued'] ?? 0
    const incoming = RANK[status.status] ?? 0
    if (incoming < current) continue

    await db
      .from('orders')
      .update({
        whatsapp_status: status.status,
        whatsapp_error:
          status.status === 'failed'
            ? (status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? 'WhatsApp reported a failure')
            : null,
      })
      .eq('id', order.id)
  }

  // Always 200. Meta retries anything else with backoff and eventually disables
  // the webhook — and a receipt we could not match is not an error worth losing
  // the whole subscription over.
  return NextResponse.json({ ok: true })
}

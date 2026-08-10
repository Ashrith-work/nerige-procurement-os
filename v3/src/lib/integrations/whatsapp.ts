import 'server-only'
import type { Locale } from '@/lib/i18n'

/**
 * Sending an order to a weaver on WhatsApp.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * A business cannot send whatever it likes to a WhatsApp user. There is a
 * 24-hour "customer service window" that opens only when the USER messages the
 * business, and inside it free-form messages are allowed. Outside it — which is
 * every order Nerige will ever send, because a weaver has no reason to message
 * first — only a TEMPLATE pre-approved by Meta may be sent, and only as the
 * opening message.
 *
 * So the shape of a send is not "post eleven photographs". It is:
 *
 *   1. one approved template message, which opens the window
 *   2. then, inside that window, the per-line image messages as free-form
 *
 * Step 2 legally depends on step 1 having succeeded. If the template send
 * fails, the images must not be attempted — they would be rejected, and
 * attempting them is what gets a number rate-limited.
 *
 * The template itself is NOT created here. It is submitted to Meta for review
 * through the WhatsApp Manager and takes minutes to days to approve. The exact
 * text to submit is in v3/docs/whatsapp-template.md; the name and language are
 * configured through environment variables so approval can happen without a
 * deploy.
 *
 * `WHATSAPP_TEMPLATE_NAME` is a placeholder until that approval lands. Sending
 * against an unapproved name fails with error 132001, and the message below
 * says so rather than reporting "send failed".
 */

const API_VERSION = 'v21.0'

export interface WhatsAppConfig {
  phoneNumberId: string
  accessToken: string
  templateName: string
  /** The language the template was APPROVED in, not the vendor's language. */
  templateLanguage: string
}

export function whatsAppConfig(): WhatsAppConfig | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN

  if (!phoneNumberId || !accessToken) return null

  return {
    phoneNumberId,
    accessToken,
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || 'nerige_new_order',
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
  }
}

export class WhatsAppError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
    this.name = 'WhatsAppError'
  }
}

/** Meta's error codes, in language that names the fix. */
const EXPLANATIONS: Record<number, string> = {
  132001:
    'Meta does not have an approved template by that name. Submit the text in v3/docs/whatsapp-template.md through WhatsApp Manager, then set WHATSAPP_TEMPLATE_NAME to the approved name.',
  132000: 'The template exists but the number of variables does not match what was approved.',
  131047:
    'Outside the 24-hour window, so only an approved template may open the conversation. This is expected — it means the template send failed and the images were attempted anyway.',
  131026: 'That number is not on WhatsApp, or cannot receive messages from this business.',
  131030: 'That number is not on the allow-list of this test number. Add it in WhatsApp Manager.',
  190: 'The access token has expired. Issue a permanent token — see v3/docs/whatsapp-setup.md.',
  100: 'Meta rejected the request as malformed. Usually a phone number that is not in E.164.',
}

interface MetaError {
  error?: { message?: string; code?: number; error_data?: { details?: string } }
}

async function call<T>(
  config: WhatsAppConfig,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
      cache: 'no-store',
    },
  )

  const text = await response.text()

  if (!response.ok) {
    let code: number | undefined
    let detail = text

    try {
      const parsed = JSON.parse(text) as MetaError
      code = parsed.error?.code
      detail = parsed.error?.error_data?.details ?? parsed.error?.message ?? text
    } catch {
      // Meta occasionally returns HTML on a gateway error.
    }

    throw new WhatsAppError(
      (code !== undefined && EXPLANATIONS[code]) || `WhatsApp refused the send: ${detail}`,
      code,
    )
  }

  return JSON.parse(text) as T
}

interface SendResponse {
  messages: { id: string }[]
}

export interface OrderLineMessage {
  imageUrl: string | null
  /** Never translated. This is the string she writes on the fabric. */
  sku: string | null
  name: string | null
  quantity: number
}

export interface SendOrderResult {
  /** The id of the template message — the one delivery receipts refer to. */
  messageId: string
  imagesSent: number
  imagesFailed: number
}

/**
 * The caption under each photograph.
 *
 * Name, code, quantity — the same three things the card shows, in the same
 * order, so the message and the portal do not teach two different layouts. The
 * SKU is wrapped in backticks because WhatsApp renders that as monospace, which
 * matters for a string being copied character by character onto a label.
 *
 * The code and the saree name are NOT translated: they are Latin-script
 * identifiers matched against EasyEcom, and a transliterated one matches
 * nothing.
 */
export function lineCaption(line: OrderLineMessage, strings: OrderStrings): string {
  const parts: string[] = []

  if (line.name) parts.push(`*${line.name}*`)
  parts.push(line.sku ? `\`${line.sku}\`` : strings.noCode)
  parts.push(`${strings.quantity}: ${line.quantity}`)

  return parts.join('\n')
}

/** The handful of words a WhatsApp message needs, in the weaver's language. */
export interface OrderStrings {
  quantity: string
  noCode: string
  restockHeading: string
  newDesignHeading: string
}

export async function sendOrderOnWhatsApp(
  config: WhatsAppConfig,
  opts: {
    to: string
    vendorName: string
    orderNumber: string
    lines: OrderLineMessage[]
    strings: OrderStrings
    locale: Locale
    portalUrl: string | null
  },
): Promise<SendOrderResult> {
  if (!/^\+[1-9][0-9]{7,14}$/.test(opts.to)) {
    throw new WhatsAppError(
      `"${opts.to}" is not a WhatsApp number in E.164 form. It needs the country code, like +919876543210.`,
    )
  }

  // The API wants the number without the leading +.
  const to = opts.to.replace(/^\+/, '')

  // --- 1. The template. This is what opens the 24-hour window. ---------------
  //
  // Three variables, matching the body text in docs/whatsapp-template.md:
  // the weaver's name, the order number, and how many pieces in total. Meta
  // matches on COUNT and ORDER, not on name, so changing this without changing
  // that file fails with 132000.
  const totalPieces = opts.lines.reduce((sum, line) => sum + line.quantity, 0)

  const template = await call<SendResponse>(config, {
    to,
    type: 'template',
    template: {
      name: config.templateName,
      language: { code: config.templateLanguage },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: opts.vendorName },
            { type: 'text', text: opts.orderNumber },
            { type: 'text', text: String(totalPieces) },
          ],
        },
      ],
    },
  })

  const messageId = template.messages?.[0]?.id
  if (!messageId) throw new WhatsAppError('WhatsApp accepted the template but returned no message id.')

  // --- 2. One image per line, inside the window the template just opened -----
  //
  // Sequential rather than parallel. WhatsApp delivers in send order and a
  // twelve-line order fired concurrently arrives shuffled, which on a screen
  // where each message is "make this one" is actively confusing. It also stays
  // inside the per-number rate limit without needing to think about it.
  let imagesSent = 0
  let imagesFailed = 0

  for (const line of opts.lines) {
    try {
      if (line.imageUrl) {
        await call(config, {
          to,
          type: 'image',
          image: { link: line.imageUrl, caption: lineCaption(line, opts.strings) },
        })
      } else {
        // No photograph is not a reason to drop the line — she still has to
        // make it, and the code is the part that matters.
        await call(config, {
          to,
          type: 'text',
          text: { body: lineCaption(line, opts.strings) },
        })
      }
      imagesSent += 1
    } catch {
      // One image failing must not lose the other eleven. The count comes back
      // and the caller records a partial send rather than a clean one.
      imagesFailed += 1
    }
  }

  if (opts.portalUrl) {
    await call(config, {
      to,
      type: 'text',
      text: { body: `${opts.orderNumber} — ${opts.portalUrl}`, preview_url: true },
    }).catch(() => {
      // The link is a convenience; the order is already in her hands.
    })
  }

  return { messageId, imagesSent, imagesFailed }
}

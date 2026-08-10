'use client'

import { useActionState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Button, Card, Alert, StatusBadge } from '@/components/ui/primitives'
import { sendToDashboard, sendOnWhatsApp, type SendState } from '../send-actions'
import { generatePo, uploadPoToDrive, sendPoToSlack, type PoState } from '../po-actions'

export interface Delivery {
  orderId: string
  dashboardSentAt: string | null
  whatsappSentAt: string | null
  whatsappStatus: string | null
  whatsappError: string | null
  vendorHasWhatsapp: boolean
  poNumber: string | null
  poDriveLink: string | null
  poSlackTs: string | null
}

const SEND_IDLE: SendState = { status: 'idle' }
const PO_IDLE: PoState = { status: 'idle' }

/**
 * Where this order has gone, and the two ways to send it.
 *
 * Both channels can be used on the same order and neither replaces the other:
 * the portal is the record, the WhatsApp message is what reaches a weaver who
 * does not open the portal for three days. So this shows two independent states
 * rather than one "sent" flag.
 *
 * `sent` and `delivered` are shown as different words on purpose. WhatsApp
 * accepting a message means it left us; only the delivery receipt says it
 * arrived. Collapsing them is how somebody concludes a weaver has seen an order
 * that failed against a dead number twenty minutes later.
 */
export function DeliveryPanel({ delivery }: { delivery: Delivery }) {
  const [dashState, dashAction, dashPending] = useActionState(sendToDashboard, SEND_IDLE)
  const [waState, waAction, waPending] = useActionState(sendOnWhatsApp, SEND_IDLE)
  const [poState, poAction, poPending] = useActionState(generatePo, PO_IDLE)
  const [driveState, driveAction, drivePending] = useActionState(uploadPoToDrive, PO_IDLE)
  const [slackState, slackAction, slackPending] = useActionState(sendPoToSlack, PO_IDLE)

  const problem = [dashState, waState, poState, driveState, slackState].find(
    (s) => s.status === 'error',
  )
  const success = [dashState, waState, poState, driveState, slackState].find(
    (s) => s.status === 'sent' || s.status === 'done',
  )

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-medium text-stone-900">Sending</h2>

      {problem && <Alert tone="error">{problem.message}</Alert>}
      {success && !problem && <Alert tone="success">{success.message}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        {/* --- Dashboard --------------------------------------------------- */}
        <div className="space-y-2 rounded-lg border border-stone-200 p-3">
          <p className="text-sm font-medium text-stone-900">Vendor dashboard</p>
          <p className="text-sm text-stone-600">
            {delivery.dashboardSentAt ? (
              <>In her portal · {formatDistanceToNow(new Date(delivery.dashboardSentAt))} ago</>
            ) : (
              <span className="text-amber-700">Not recorded as delivered</span>
            )}
          </p>
          <form action={dashAction}>
            <input type="hidden" name="orderId" value={delivery.orderId} />
            <Button type="submit" variant="secondary" disabled={dashPending}>
              {dashPending ? 'Working…' : 'Send to dashboard'}
            </Button>
          </form>
        </div>

        {/* --- WhatsApp ---------------------------------------------------- */}
        <div className="space-y-2 rounded-lg border border-stone-200 p-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-stone-900">WhatsApp</p>
            {delivery.whatsappStatus && (
              <StatusBadge
                status={
                  delivery.whatsappStatus === 'failed'
                    ? 'cancelled'
                    : delivery.whatsappStatus === 'read' || delivery.whatsappStatus === 'delivered'
                      ? 'received'
                      : 'accepted'
                }
                label={delivery.whatsappStatus}
              />
            )}
          </div>

          <p className="text-sm text-stone-600">
            {delivery.whatsappSentAt ? (
              <>Sent {formatDistanceToNow(new Date(delivery.whatsappSentAt))} ago</>
            ) : delivery.vendorHasWhatsapp ? (
              'Not sent'
            ) : (
              <span className="text-amber-700">She has no WhatsApp number on file</span>
            )}
          </p>

          {delivery.whatsappError && (
            <p className="text-xs break-words text-red-700">{delivery.whatsappError}</p>
          )}

          <form action={waAction}>
            <input type="hidden" name="orderId" value={delivery.orderId} />
            <Button
              type="submit"
              variant="secondary"
              disabled={waPending || !delivery.vendorHasWhatsapp}
            >
              {waPending ? 'Sending…' : delivery.whatsappSentAt ? 'Send again' : 'Send on WhatsApp'}
            </Button>
          </form>
        </div>
      </div>

      {/* --- Purchase order ------------------------------------------------ */}
      <div className="space-y-3 border-t border-stone-100 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-stone-900">Purchase order</p>
          {delivery.poNumber && (
            <span className="font-mono text-sm text-stone-600">{delivery.poNumber}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <form action={poAction}>
            <input type="hidden" name="orderId" value={delivery.orderId} />
            <Button type="submit" variant="secondary" disabled={poPending}>
              {poPending ? 'Working…' : delivery.poNumber ? 'Regenerate' : 'Generate PO'}
            </Button>
          </form>

          {delivery.poNumber && (
            <a href={`/api/orders/${delivery.orderId}/po`} download>
              <Button type="button" variant="secondary">
                Download
              </Button>
            </a>
          )}

          {delivery.poNumber && (
            <form action={driveAction}>
              <input type="hidden" name="orderId" value={delivery.orderId} />
              <Button type="submit" variant="secondary" disabled={drivePending}>
                {drivePending ? 'Uploading…' : delivery.poDriveLink ? 'Upload again' : 'Upload to Drive'}
              </Button>
            </form>
          )}

          {delivery.poNumber && (
            <form action={slackAction}>
              <input type="hidden" name="orderId" value={delivery.orderId} />
              <Button type="submit" variant="secondary" disabled={slackPending}>
                {slackPending ? 'Posting…' : delivery.poSlackTs ? 'Post again' : 'Send to Slack'}
              </Button>
            </form>
          )}
        </div>

        {delivery.poDriveLink && (
          <p className="text-sm">
            <a
              href={delivery.poDriveLink}
              target="_blank"
              rel="noreferrer"
              className="text-stone-700 underline underline-offset-2 hover:text-stone-900"
            >
              Open in Google Drive
            </a>
          </p>
        )}
      </div>
    </Card>
  )
}

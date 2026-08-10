'use client'

import { useActionState } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { Button, Card, Alert, StatusBadge } from '@/components/ui/primitives'
import { triggerSync, type SyncState } from './sync-actions'

export interface SyncRun {
  id: string
  kind: string
  status: string
  started_at: string
  finished_at: string | null
  rows_seen: number
  rows_changed: number
  error: string | null
}

const IDLE: SyncState = { status: 'idle' }

const KIND_LABELS: Record<string, string> = {
  shopify_products: 'Products and stock',
  shopify_orders: 'Sales history',
}

/**
 * The sync status, and the button.
 *
 * The headline is the last SUCCESSFUL run, not the last run. Those are the same
 * number until the day they are not, and the day they are not is precisely the
 * day it matters: a job failing every half hour still updates "last run" every
 * half hour, and the screen would report a healthy sync over three-day-old
 * stock.
 *
 * Failures are shown with their error text rather than as a red dot. The
 * commonest causes — an expired access token, a Shopify bulk operation already
 * running — are both immediately actionable by whoever is reading this, and
 * neither is guessable from "failed".
 */
export function SyncPanel({ runs }: { runs: SyncRun[] }) {
  const [state, action, pending] = useActionState(triggerSync, IDLE)

  const lastSuccess = (kind: string) =>
    runs.find((r) => r.kind === kind && r.status === 'succeeded' && r.finished_at)

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-medium text-stone-900">Shopify</h2>
        <p className="text-sm text-stone-500">
          Runs every 30 minutes on its own. Products first, then sales — sales hang off products,
          so a design added this morning needs to exist before its orders can be counted.
        </p>
      </div>

      {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}
      {state.status === 'done' && <Alert tone="success">{state.message}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        {(['shopify_products', 'shopify_orders'] as const).map((kind) => {
          const success = lastSuccess(kind)
          return (
            <div key={kind} className="space-y-2 rounded-lg border border-stone-200 p-3">
              <p className="text-sm font-medium text-stone-900">{KIND_LABELS[kind]}</p>
              <p className="text-sm text-stone-600">
                {success ? (
                  <>
                    Last worked {formatDistanceToNow(new Date(success.finished_at!))} ago ·{' '}
                    <span className="tabular-nums">{success.rows_changed.toLocaleString('en-IN')}</span>{' '}
                    written
                  </>
                ) : (
                  <span className="text-amber-700">Never completed successfully</span>
                )}
              </p>
              <form action={action}>
                <input type="hidden" name="kind" value={kind} />
                <Button type="submit" variant="secondary" disabled={pending}>
                  {pending ? 'Running…' : 'Sync now'}
                </Button>
              </form>
            </div>
          )
        })}
      </div>

      {runs.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-stone-700">Recent runs</p>
          <ul className="divide-y divide-stone-100 text-sm">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
                <StatusBadge
                  status={
                    run.status === 'succeeded'
                      ? 'received'
                      : run.status === 'failed'
                        ? 'cancelled'
                        : 'accepted'
                  }
                  label={run.status}
                />
                <span className="text-stone-600">{KIND_LABELS[run.kind] ?? run.kind}</span>
                <span className="text-stone-400">
                  {format(new Date(run.started_at), 'd MMM HH:mm')}
                </span>
                {run.status === 'succeeded' && (
                  <span className="text-stone-500 tabular-nums">
                    {run.rows_seen.toLocaleString('en-IN')} seen ·{' '}
                    {run.rows_changed.toLocaleString('en-IN')} written
                  </span>
                )}
                {run.error && (
                  <span className="w-full text-xs break-words text-red-700">{run.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncShopifyProducts } from './sync-products'
import { syncShopifySales } from './sync-sales'

export type SyncKind = 'shopify_products' | 'shopify_orders'

export interface RunSyncResult {
  runId: string | null
  status: 'succeeded' | 'failed'
  rowsSeen: number
  rowsChanged: number
  message: string
}

/**
 * Runs one sync and records the attempt, whether it worked or not.
 *
 * The failure row is the important half. A sync that has been quietly failing
 * for three days is the state that puts a three-day-old quantity in front of a
 * weaver while every screen still says the stock was checked half an hour ago —
 * because "half an hour ago" would be measured from the last time the job RAN
 * rather than the last time it SUCCEEDED. `sync_runs` distinguishes the two, and
 * every screen reads the last successful one.
 *
 * The run row is opened before the work starts so that a process killed
 * mid-sync leaves a row stuck in `running` rather than no row at all. A gap in
 * this table would read as "nothing was attempted".
 */
export async function runSync(
  db: SupabaseClient,
  kind: SyncKind,
  opts: { triggeredBy?: string | null; onProgress?: (message: string) => void } = {},
): Promise<RunSyncResult> {
  const say = opts.onProgress ?? (() => {})

  const { data: run } = await db
    .from('sync_runs')
    .insert({ kind, status: 'running', triggered_by: opts.triggeredBy ?? null })
    .select('id')
    .single()

  const runId = (run?.id as string) ?? null

  try {
    const result: {
      rowsSeen: number
      rowsChanged: number
      deactivated?: number
      skipped?: { reason: string; count: number }[]
    } =
      kind === 'shopify_products'
        ? await syncShopifyProducts(db, { onProgress: say })
        : await syncShopifySales(db, { onProgress: say })

    const notes = result.skipped?.length
      ? ` · skipped ${result.skipped.map((s) => `${s.count} ${s.reason}`).join(', ')}`
      : ''

    const deactivated = result.deactivated ? ` · ${result.deactivated} marked inactive` : ''

    if (runId) {
      await db
        .from('sync_runs')
        .update({
          status: 'succeeded',
          finished_at: new Date().toISOString(),
          rows_seen: result.rowsSeen,
          rows_changed: result.rowsChanged,
        })
        .eq('id', runId)
    }

    return {
      runId,
      status: 'succeeded',
      rowsSeen: result.rowsSeen,
      rowsChanged: result.rowsChanged,
      message: `${result.rowsSeen} seen, ${result.rowsChanged} written${deactivated}${notes}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    if (runId) {
      await db
        .from('sync_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          // Truncated: a Shopify error can carry a whole JSONL line, and a
          // failure message nobody can read is a failure nobody acts on.
          error: message.slice(0, 2000),
        })
        .eq('id', runId)
    }

    return { runId, status: 'failed', rowsSeen: 0, rowsChanged: 0, message }
  }
}

/**
 * When stock was last genuinely refreshed.
 *
 * Reads the last SUCCEEDED run, never the last run. See above.
 */
export async function lastSuccessfulSync(
  db: SupabaseClient,
  kind: SyncKind,
): Promise<string | null> {
  const { data } = await db
    .from('sync_runs')
    .select('finished_at')
    .eq('kind', kind)
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data?.finished_at as string) ?? null
}

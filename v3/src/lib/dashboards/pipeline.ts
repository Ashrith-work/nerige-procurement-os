import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The order pipeline, for `/work`.
 *
 * Four stages in the order an order actually travels — issued, accepted,
 * dispatched, received — each with a count and the one order that stands for
 * it. For the three live stages that is the one which has been sitting there
 * longest: a stage holding nine orders is fine, a stage holding one since the
 * 2nd is not, and only the second of those is worth a phone call. For the
 * finished stage it is the most recent arrival, because nobody chases a parcel
 * that is already on the bench.
 *
 * Progress, not performance. Nothing here is a rate, an average or a period
 * total — those live on `/numbers`, and one of them in this file would put a
 * measurement back on the screen people read for what to chase next.
 *
 * ERRORS THROW. A stage reading zero because its query failed would say the
 * pipeline is empty, which is the one sentence nobody would question.
 */

/** How far back a finished order still counts as recent progress. */
export const RECEIVED_DAYS = 14

export type StageKey = 'issued' | 'accepted' | 'dispatched' | 'received'

export interface PipelineOrder {
  id: string
  orderNumber: string
  vendorCode: string | null
  vendorName: string | null
  /** When it entered this stage, as an ISO timestamp. */
  since: string
}

export interface PipelineStage {
  key: StageKey
  label: string
  /** Whose move it is now, in the words the person would use. */
  whose: string
  count: number
  /** The order that stands for this stage, with what to call it. */
  mark: { order: PipelineOrder; label: string } | null
}

const COLUMNS = 'id, order_number, issued_at, dispatched_at, received_at, vendors(code, display_name)'

type SinceColumn = 'issued_at' | 'dispatched_at' | 'received_at'

const STAGES: {
  key: StageKey
  label: string
  whose: string
  since: SinceColumn
  /** Ascending picks the one that has waited longest; descending, the newest. */
  oldestFirst: boolean
  markLabel: string
}[] = [
  {
    key: 'issued',
    label: 'Sent, not yet accepted',
    whose: 'The weaver',
    since: 'issued_at',
    oldestFirst: true,
    markLabel: 'Waiting longest',
  },
  {
    key: 'accepted',
    label: 'Accepted, being woven',
    whose: 'The weaver',
    since: 'issued_at',
    oldestFirst: true,
    markLabel: 'Out longest',
  },
  {
    key: 'dispatched',
    label: 'On its way to the bench',
    whose: 'The warehouse',
    since: 'dispatched_at',
    oldestFirst: true,
    markLabel: 'In transit longest',
  },
  {
    key: 'received',
    label: `Received in the last ${RECEIVED_DAYS} days`,
    whose: 'Done',
    since: 'received_at',
    oldestFirst: false,
    markLabel: 'Most recent',
  },
]

interface OrderRow {
  id: string
  order_number: string
  issued_at: string | null
  dispatched_at: string | null
  received_at: string | null
  vendors: { code: string; display_name: string } | { code: string; display_name: string }[] | null
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

export async function loadOrderPipeline(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<PipelineStage[]> {
  const since = daysAgoIso(RECEIVED_DAYS, now)

  // The finished stage is narrowed to the recent window on both queries, so the
  // count and the order shown under it can never describe different sets.
  const counts = await Promise.all(
    STAGES.map((stage) => {
      const q = supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', stage.key)
      return stage.key === 'received' ? q.gte('received_at', since) : q
    }),
  )

  const marks = await Promise.all(
    STAGES.map((stage) => {
      const q = supabase.from('orders').select(COLUMNS).eq('status', stage.key)
      const scoped = stage.key === 'received' ? q.gte('received_at', since) : q
      return scoped.order(stage.since, { ascending: stage.oldestFirst, nullsFirst: false }).limit(1)
    }),
  )

  const failed = [...counts, ...marks].find((r) => r.error)?.error
  if (failed) throw new Error(`Could not load the order pipeline: ${failed.message}`)

  return STAGES.map((stage, i) => {
    const row = ((marks[i].data ?? []) as unknown as OrderRow[])[0] ?? null
    const vendor = row ? one(row.vendors) : null
    const enteredAt = row ? (row[stage.since] ?? row.issued_at) : null

    return {
      key: stage.key,
      label: stage.label,
      whose: stage.whose,
      count: counts[i].count ?? 0,
      mark:
        row && enteredAt
          ? {
              label: stage.markLabel,
              order: {
                id: row.id,
                orderNumber: row.order_number,
                vendorCode: vendor?.code ?? null,
                vendorName: vendor?.display_name ?? null,
                since: enteredAt,
              },
            }
          : null,
    }
  })
}

'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireDayRecorder } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { isIsoDate, todayInWarehouse } from '@/lib/performance/period'
import { TOTAL_COLUMNS, movementLabel, normaliseSku, type MovementRow } from '@/lib/day-sheet/calc'
import { lookupExact, toMovementRow, type MovementDbRow } from '@/lib/day-sheet/loaders'

/**
 * The day sheet's writes.
 *
 * Four of them, and the split between them is the shape of the screen. The
 * counted totals are a small form that is saved; each saree is a line in a grid
 * that saves itself the moment it changes. A manager fills this in across a
 * whole day, in ten-second visits between parcels, on a tablet that locks
 * itself — a batch of unsaved rows waiting behind a button is a batch that gets
 * lost, so rows do not wait behind one.
 *
 * Every action goes through the ordinary RLS-scoped client, so `app.can_record_day()`
 * is the enforcement. The guard at the top of each exists to turn a refusal into
 * a sentence, and (through requireUser) to refuse every write while a developer
 * is viewing as somebody else.
 */

export type DayResult = { ok: true } | { ok: false; message: string }
export type RowResult = { ok: true; row: MovementRow } | { ok: false; message: string }

const isoDate = z.string().refine(isIsoDate, 'Not a date.')
const kind = z.enum(['cec', 'ai_colour', 'video_call'])

/** Postgres' wording for an RLS refusal is not a sentence a manager can act on. */
function readable(message: string): string {
  if (/row-level security/i.test(message)) {
    return 'This day cannot be changed from your account. Ask a founder to correct it.'
  }
  return message
}

/** A day nobody can have worked yet is a typo, not a record. */
function refuseFuture(date: string): string | null {
  return date > todayInWarehouse() ? 'That day has not happened yet.' : null
}

function revalidate(): void {
  revalidatePath('/warehouse/day')
  revalidatePath('/warehouse')
}

// ---------------------------------------------------------------------------
// The counted totals
// ---------------------------------------------------------------------------

const count = z.number().int().min(0).max(100000)

const totalsSchema = z.object({
  date: isoDate,
  out: z.record(kind, count),
  back: z.record(kind, count),
  videoOrders: count,
  note: z.string().max(1000),
})

export type TotalsInput = z.infer<typeof totalsSchema>

/**
 * The two boxes at the top of each movement, plus the note and the one order
 * figure nothing else records.
 *
 * Upserted on the primary key, so the first save of a day creates the row and
 * every later one corrects it. `recorded_by` is rewritten each time: the
 * question people ask of this row is "who last touched this", not "who opened
 * it".
 */
export async function saveDayTotals(input: TotalsInput): Promise<DayResult> {
  const user = await requireDayRecorder()

  const parsed = totalsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: 'Some of those counts could not be read. Check the numbers and try again.' }
  }
  const { date, out, back, videoOrders, note } = parsed.data

  const future = refuseFuture(date)
  if (future) return { ok: false, message: future }

  const row: Record<string, unknown> = {
    work_date: date,
    video_orders: videoOrders,
    note: note.trim() || null,
    recorded_by: user.id,
  }
  for (const [movement, columns] of Object.entries(TOTAL_COLUMNS)) {
    row[columns.out] = out[movement as keyof typeof out] ?? 0
    row[columns.back] = back[movement as keyof typeof back] ?? 0
  }

  const supabase = await createClient()
  const { error } = await supabase.from('warehouse_days').upsert(row, { onConflict: 'work_date' })
  if (error) return { ok: false, message: readable(error.message) }

  revalidate()
  return { ok: true }
}

// ---------------------------------------------------------------------------
// One saree
// ---------------------------------------------------------------------------

const addSchema = z.object({ date: isoDate, kind, sku: z.string().min(1).max(120) })

/**
 * Write a saree down.
 *
 * An unknown code is stored and flagged, never refused. The CEC handles sarees
 * that are not in the catalogue yet, and a row nobody wrote down is worse than
 * one that needs correcting later — see the table comment in migration 039.
 */
export async function addMovement(input: z.infer<typeof addSchema>): Promise<RowResult> {
  const user = await requireDayRecorder()

  const parsed = addSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'That code is too long to be a SKU.' }

  const sku = normaliseSku(parsed.data.sku)
  if (sku === '') return { ok: false, message: 'Type a code first.' }

  const future = refuseFuture(parsed.data.date)
  if (future) return { ok: false, message: future }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('warehouse_movements')
    .insert({
      work_date: parsed.data.date,
      kind: parsed.data.kind,
      sku,
      recorded_by: user.id,
    })
    .select('id, kind, sku, went_out, came_back, sold_offline, bill_no, reason, who, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        message: `${sku} is already on this day's ${movementLabel(parsed.data.kind)} list. Edit that line instead.`,
      }
    }
    return { ok: false, message: readable(error.message) }
  }

  // Checked after the insert, never before: the answer decides what the row
  // looks like on screen, not whether it exists.
  const known = await lookupExact(supabase, sku)

  revalidate()
  return { ok: true, row: { ...toMovementRow(data as unknown as MovementDbRow), known } }
}

const patchSchema = z
  .object({
    sku: z.string().min(1).max(120).optional(),
    wentOut: z.boolean().optional(),
    cameBack: z.boolean().optional(),
    soldOffline: z.boolean().optional(),
    billNo: z.string().max(60).optional(),
    reason: z.string().max(400).optional(),
    who: z.string().max(80).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change.')

const updateSchema = z.object({ id: z.uuid(), patch: patchSchema })

/**
 * Change one cell of one line.
 *
 * A cell at a time rather than a whole row, because that is what the grid
 * sends: a tick is one field, and posting the other eight back with it would
 * overwrite whatever somebody at the other bench had just typed into them.
 */
export async function updateMovement(input: z.infer<typeof updateSchema>): Promise<DayResult> {
  await requireDayRecorder()

  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'That change could not be read.' }
  const { id, patch } = parsed.data

  const row: Record<string, unknown> = {}
  if (patch.sku !== undefined) {
    const sku = normaliseSku(patch.sku)
    if (sku === '') return { ok: false, message: 'A line needs a code. Remove the line instead.' }
    row.sku = sku
  }
  if (patch.wentOut !== undefined) row.went_out = patch.wentOut
  if (patch.cameBack !== undefined) row.came_back = patch.cameBack
  if (patch.soldOffline !== undefined) row.sold_offline = patch.soldOffline
  // Emptied text is null, not '': "no bill number" and "a bill number that is
  // the empty string" are the same fact and the column should hold one of them.
  if (patch.billNo !== undefined) row.bill_no = patch.billNo.trim() || null
  if (patch.reason !== undefined) row.reason = patch.reason.trim() || null
  if (patch.who !== undefined) row.who = patch.who.trim() || null

  const supabase = await createClient()
  const { error, count: changed } = await supabase
    .from('warehouse_movements')
    .update(row, { count: 'exact' })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'That code is already on this day under this movement.' }
    }
    return { ok: false, message: readable(error.message) }
  }
  // RLS refuses by matching no rows rather than by raising, so a silent zero is
  // the refusal — the only place on this screen where nothing happening would
  // otherwise look like success.
  if (changed === 0) return { ok: false, message: 'That line could not be changed from your account.' }

  revalidate()
  return { ok: true }
}

/**
 * Take a line off the day.
 *
 * A real delete, unlike the staff sheet's roster. A movement line is a note
 * about a saree that is still in the building; a mistyped one carries no
 * history worth keeping and leaving it struck through would sit in the "did not
 * come back" list forever.
 */
export async function removeMovement(input: { id: string }): Promise<DayResult> {
  await requireDayRecorder()

  if (!z.uuid().safeParse(input.id).success) return { ok: false, message: 'No such line.' }

  const supabase = await createClient()
  const { error, count: removed } = await supabase
    .from('warehouse_movements')
    .delete({ count: 'exact' })
    .eq('id', input.id)

  if (error) return { ok: false, message: readable(error.message) }
  if (removed === 0) return { ok: false, message: 'That line could not be removed from your account.' }

  revalidate()
  return { ok: true }
}

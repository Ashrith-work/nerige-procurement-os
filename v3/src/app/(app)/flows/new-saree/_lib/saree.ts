import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { INTAKE_LIST_COLUMNS, type IntakeListRow } from '@/app/(app)/intake/_lib/data'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * The saree this person is part-way through.
 *
 * NOTHING IS REMEMBERED IN A COMPONENT. The new-saree form hands back its
 * Unique Code in client state, which is gone the moment the phone locks — and
 * this phone locks constantly, because it is in an apron pocket at a warehouse
 * table. So each step of the flow asks the database instead: `?code=16005` when
 * the URL names one, otherwise the last saree this person saved. Both survive a
 * reload, a second device and a fortnight.
 *
 * `submitted_by` is what makes the default right rather than merely recent: two
 * people entering sarees at the same table must each come back to their own.
 */
export async function loadFlowSaree(
  supabase: Supabase,
  userId: string,
  code: string | undefined,
): Promise<{ row: IntakeListRow | null; problem: string | null }> {
  if (code) {
    const unique = Number(code)
    if (!Number.isSafeInteger(unique)) return { row: null, problem: `${code} is not a saree code.` }

    const { data } = await supabase
      .from('product_intakes')
      .select(INTAKE_LIST_COLUMNS)
      .eq('unique_code', unique)
      .maybeSingle()

    return data
      ? { row: data as unknown as IntakeListRow, problem: null }
      : { row: null, problem: `No saree with code ${unique}.` }
  }

  const { data } = await supabase
    .from('product_intakes')
    .select(INTAKE_LIST_COLUMNS)
    .eq('submitted_by', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return { row: (data as unknown as IntakeListRow | null) ?? null, problem: null }
}

/**
 * The SKU split at its tail: everything before the Unique Code, and the code.
 *
 * The tail is the only part written on the fabric by hand, and the only part
 * that differs between two sarees from the same weaver, collection, fabric and
 * colour — so it is the part that has to be read character by character. The
 * split is done on the code itself rather than on a separator, because the
 * separator is a setting and this must not break when somebody changes it.
 */
export function splitSku(sku: string | null, uniqueCode: number): { head: string; tail: string } {
  const code = String(uniqueCode)
  if (!sku) return { head: '', tail: code }
  return sku.endsWith(code)
    ? { head: sku.slice(0, sku.length - code.length), tail: code }
    : { head: sku, tail: '' }
}

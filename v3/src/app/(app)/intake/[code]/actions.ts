'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/session'

/**
 * Marks one entry in the error history as dealt with.
 *
 * Owner only, matching `intake_errors_admin_write` (migration 022). The entry
 * itself is never edited or removed — the table is append-only history — only
 * the `resolved` triage flag, with who and when.
 */
export async function resolveIntakeError(formData: FormData): Promise<void> {
  const user = await requireAdmin()
  const id = Number(formData.get('error_id'))
  const code = Number(formData.get('unique_code'))
  if (!Number.isSafeInteger(id) || id <= 0) return

  const supabase = await createClient()
  const { error } = await supabase
    .from('intake_errors')
    .update({ resolved: true, resolved_by: user.id, resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Could not mark the error resolved: ${error.message}`)

  revalidatePath(`/intake/${code}`)
}

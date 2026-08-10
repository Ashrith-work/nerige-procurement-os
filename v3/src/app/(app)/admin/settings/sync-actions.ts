'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireProcurement } from '@/lib/auth/session'
import { runSync, type SyncKind } from '@/lib/shopify/run-sync'

export interface SyncState {
  status: 'idle' | 'done' | 'error'
  message?: string
}

/**
 * The sync button.
 *
 * Runs as the signed-in admin, not the service role — the RPCs check
 * `app.is_internal()` and she satisfies it, so there is no reason to reach for
 * a key that bypasses every policy. The scheduled route has no session and has
 * to; this does not.
 *
 * Synchronous, and it can take a minute on a full products pass. That is
 * honest: an admin who presses this wants to know whether it worked, and a
 * button that returns instantly and fails quietly in the background is the
 * thing this whole `sync_runs` table exists to prevent.
 */
export async function triggerSync(_prev: SyncState, formData: FormData): Promise<SyncState> {
  const admin = await requireProcurement()

  const kind = String(formData.get('kind') ?? 'shopify_products') as SyncKind
  if (kind !== 'shopify_products' && kind !== 'shopify_orders') {
    return { status: 'error', message: 'Unknown sync.' }
  }

  const supabase = await createClient()
  const result = await runSync(supabase, kind, { triggeredBy: admin.id })

  revalidatePath('/admin/settings')
  revalidatePath('/reorder', 'layout')

  return result.status === 'succeeded'
    ? { status: 'done', message: result.message }
    : { status: 'error', message: result.message }
}

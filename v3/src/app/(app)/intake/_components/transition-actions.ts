'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth/session'
import { isIntakeStatus, STATUS_LABELS } from '@/lib/intake/status'

export interface TransitionState {
  status: 'idle' | 'moved' | 'error'
  message?: string
  /** Echoed so the card that acted is the one that shows the result. */
  uniqueCode?: number
}

/**
 * Moves one saree one step — the single action behind every workflow button on
 * the queue, the shooting board and the review screen.
 *
 * `requireStaff()` and not a narrower guard: which role may take which edge is
 * `transition_intake`'s decision (migration 035), made per edge, and a second
 * copy of that table here would be a second place for it to drift. The guard
 * exists so a weaver who reaches the endpoint gets a redirect, and so view-as
 * refuses the write with a sentence before it reaches the database.
 *
 * `from` is the status the screen was showing. The database uses it to make a
 * double tap harmless and a stale screen honest.
 */
export async function transitionIntake(_prev: TransitionState, formData: FormData): Promise<TransitionState> {
  await requireStaff()

  const uniqueCode = Number(formData.get('unique_code'))
  const to = String(formData.get('to') ?? '')
  const from = String(formData.get('from') ?? '')
  const countRaw = String(formData.get('image_count') ?? '').trim()
  const reason = String(formData.get('reason') ?? '').trim()

  if (!Number.isSafeInteger(uniqueCode) || uniqueCode <= 0) return { status: 'error', message: 'No saree given.' }
  if (!isIntakeStatus(to)) return { status: 'error', message: 'Unknown step.', uniqueCode }

  let imageCount: number | null = null
  if (countRaw !== '') {
    imageCount = Number(countRaw)
    if (!Number.isInteger(imageCount) || imageCount < 0 || imageCount > 500) {
      return { status: 'error', message: 'Enter the number of photographs as a whole number.', uniqueCode }
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('transition_intake', {
    p_unique_code: uniqueCode,
    p_to: to,
    p_from: isIntakeStatus(from) ? from : null,
    p_image_count: imageCount,
    p_reason: reason || null,
  })

  if (error) return { status: 'error', message: error.message, uniqueCode }

  revalidatePath('/intake/queue')
  revalidatePath(`/intake/${uniqueCode}`)
  revalidatePath('/warehouse/shooting')
  revalidatePath('/review')

  const outcome = (data as { outcome?: string } | null)?.outcome
  return {
    status: 'moved',
    message: outcome === 'already' ? `Already ${STATUS_LABELS[to].toLowerCase()}.` : `${STATUS_LABELS[to]}.`,
    uniqueCode,
  }
}

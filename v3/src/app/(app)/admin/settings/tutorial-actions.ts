'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireProcurement } from '@/lib/auth/session'
import { isLocale } from '@/lib/i18n'
import { parseYouTubeUrl } from '@/lib/tutorial/youtube'

export interface TutorialState {
  status: 'idle' | 'saved' | 'error'
  message?: string
}

/**
 * Save the how-this-works film for one language.
 *
 * The URL is validated here rather than trusted, because the failure mode is
 * invisible: a link that does not parse renders as "the video could not be
 * loaded" on a weaver's phone and as nothing at all on this screen, and the
 * person who pasted it has no reason to go and look.
 *
 * One active row per language is a unique index in the database, so replacing a
 * video means deactivating the old row and inserting the new one — done in that
 * order, because doing it the other way trips the index.
 */
export async function saveTutorial(
  _prev: TutorialState,
  formData: FormData,
): Promise<TutorialState> {
  await requireProcurement()

  const locale = String(formData.get('locale') ?? '')
  const youtubeUrl = String(formData.get('youtube_url') ?? '').trim()
  const title = String(formData.get('title') ?? '').trim()
  const caption = String(formData.get('caption') ?? '').trim()

  if (!isLocale(locale)) return { status: 'error', message: 'Pick a language.' }
  if (!title) return { status: 'error', message: 'Give the video a title.' }

  if (!parseYouTubeUrl(youtubeUrl)) {
    return {
      status: 'error',
      message:
        'That is not a YouTube link this can read. Paste the address from the browser bar, or the one the Share button gives.',
    }
  }

  const supabase = await createClient()

  const { error: deactivateError } = await supabase
    .from('tutorial_videos')
    .update({ is_active: false })
    .eq('locale', locale)
    .eq('is_active', true)

  if (deactivateError) {
    return { status: 'error', message: `Could not replace the old video: ${deactivateError.message}` }
  }

  const { error } = await supabase.from('tutorial_videos').insert({
    locale,
    youtube_url: youtubeUrl,
    title,
    caption: caption || null,
    is_active: true,
  })

  if (error) return { status: 'error', message: `Could not save: ${error.message}` }

  revalidatePath('/portal', 'layout')
  revalidatePath('/admin/settings')

  return { status: 'saved' }
}

/** Take a language's video down without replacing it. */
export async function removeTutorial(formData: FormData): Promise<void> {
  await requireProcurement()

  const id = String(formData.get('id') ?? '')
  if (!id) return

  const supabase = await createClient()
  await supabase.from('tutorial_videos').update({ is_active: false }).eq('id', id)

  revalidatePath('/portal', 'layout')
  revalidatePath('/admin/settings')
}

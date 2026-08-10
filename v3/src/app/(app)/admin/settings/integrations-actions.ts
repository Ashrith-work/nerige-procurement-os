'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireProcurement } from '@/lib/auth/session'
import { parseDriveFolderId } from '@/lib/integrations/drive'

export interface IntegrationsState {
  status: 'idle' | 'saved' | 'error'
  message?: string
}

/**
 * Where purchase orders go once they are generated.
 *
 * The Drive folder is pasted as a link and the folder id is parsed out of it,
 * because nobody has the id — Drive shows you a URL and never the bare
 * identifier. Storing both means the link stays clickable on this screen and
 * the API call has what it needs.
 *
 * NOTE, and it is the thing that catches everyone: pasting the link does not
 * grant access. A Google service account is a separate principal with its own
 * address, and the folder has to be SHARED with that address the same way it
 * would be shared with a colleague. See v3/docs/google-drive-setup.md — the
 * message below repeats it because this is the screen where the mistake gets
 * made.
 */
export async function saveIntegrations(
  _prev: IntegrationsState,
  formData: FormData,
): Promise<IntegrationsState> {
  const admin = await requireProcurement()

  const driveUrl = String(formData.get('drive_folder_url') ?? '').trim()
  const slackChannelId = String(formData.get('slack_channel_id') ?? '').trim()
  const slackChannelName = String(formData.get('slack_channel_name') ?? '').trim()
  const poPrefix = String(formData.get('po_prefix') ?? '').trim() || 'NRG-PO'

  const update: Record<string, unknown> = {
    po_prefix: poPrefix,
    slack_channel_id: slackChannelId || null,
    slack_channel_name: slackChannelName || null,
    updated_by: admin.id,
  }

  if (driveUrl) {
    const folderId = parseDriveFolderId(driveUrl)
    if (!folderId) {
      return {
        status: 'error',
        message:
          'That does not look like a Google Drive folder link. Open the folder in Drive and copy the address from the browser bar.',
      }
    }
    update.drive_folder_url = driveUrl
    update.drive_folder_id = folderId
  } else {
    update.drive_folder_url = null
    update.drive_folder_id = null
  }

  const supabase = await createClient()
  const { error } = await supabase.from('app_settings').update(update).eq('id', 1)

  if (error) return { status: 'error', message: `Could not save: ${error.message}` }

  revalidatePath('/admin/settings')
  return { status: 'saved' }
}

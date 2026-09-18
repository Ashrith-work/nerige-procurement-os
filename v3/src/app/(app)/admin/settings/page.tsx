import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { rowOrThrow, rowsOrNull } from '@/lib/supabase/rows'
import { Alert, PageHeader } from '@/components/ui/primitives'
import { TutorialEditor, type TutorialRow } from './tutorial-editor'
import { SyncPanel } from './sync-panel'
import { IntegrationsPanel } from './integrations-panel'

export const metadata = { title: 'Settings' }

export default async function AdminSettingsPage() {
  await requireProcurement()
  const supabase = await createClient()

  const [videoResult, runResult, settingsResult] = await Promise.all([
    supabase
      .from('tutorial_videos')
      .select('id, locale, youtube_url, title, caption')
      .eq('is_active', true),
    supabase
      .from('sync_runs')
      .select('id, kind, status, started_at, finished_at, rows_seen, rows_changed, error')
      .order('started_at', { ascending: false })
      .limit(10),
    supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
  ])

  // The settings row is what this screen is for: a failure throws rather than
  // handing the panel a null, which renders as "nothing is configured" — the
  // reading that makes somebody paste a Drive folder and a Slack channel back
  // in over the top of the ones already there.
  const settings = rowOrThrow(settingsResult, 'the settings')
  // The films and the sync history are separate panels, so they say what is
  // missing rather than taking the screen with them.
  const videos = rowsOrNull(videoResult)
  const runs = rowsOrNull(runResult)

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Settings"
        subtitle="The tutorial films weavers see, the Shopify sync, and where else this connects."
      />

      {videos === null ? (
        <Alert tone="error">The tutorial films did not load. Reload before changing them — saving now would be working from a blank list.</Alert>
      ) : (
        <TutorialEditor videos={videos as TutorialRow[]} />
      )}

      {runs === null ? (
        <Alert tone="error">The sync history did not load, so this screen cannot say when the catalogue last updated.</Alert>
      ) : (
        <SyncPanel runs={runs} />
      )}

      <IntegrationsPanel settings={settings} />
    </div>
  )
}

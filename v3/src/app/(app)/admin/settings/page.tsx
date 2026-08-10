import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/primitives'
import { TutorialEditor, type TutorialRow } from './tutorial-editor'
import { SyncPanel } from './sync-panel'
import { IntegrationsPanel } from './integrations-panel'

export const metadata = { title: 'Settings · Nerige' }

export default async function AdminSettingsPage() {
  await requireProcurement()
  const supabase = await createClient()

  const [{ data: videos }, { data: runs }, { data: settings }] = await Promise.all([
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

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="What the portal shows, and where it gets its data." />

      <TutorialEditor videos={(videos ?? []) as TutorialRow[]} />

      <SyncPanel runs={runs ?? []} />

      <IntegrationsPanel settings={settings ?? null} />
    </div>
  )
}

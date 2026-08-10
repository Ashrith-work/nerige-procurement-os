'use client'

import { useActionState, useEffect, useState } from 'react'
import { Button, Card, Field, Input, Select, Alert } from '@/components/ui/primitives'
import { saveIntegrations, type IntegrationsState } from './integrations-actions'

export interface AppSettings {
  drive_folder_url: string | null
  drive_folder_id: string | null
  slack_channel_id: string | null
  slack_channel_name: string | null
  po_prefix: string | null
}

interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
  isMember: boolean
}

const IDLE: IntegrationsState = { status: 'idle' }

/**
 * The three settings that are one value each: the Drive folder, the Slack
 * destination, and the PO number prefix.
 *
 * The Slack picker loads its options from the Slack API rather than asking
 * anyone to type a channel ID — nobody knows their channel IDs, and a mistyped
 * one fails at post time with "channel_not_found", long after the PO has been
 * generated and uploaded.
 *
 * It is fetched on mount rather than server-rendered because a Slack token that
 * has expired should not stop this whole settings page from rendering. If the
 * list fails to load, the rest of the screen still works and the field falls
 * back to whatever is already saved.
 */
export function IntegrationsPanel({ settings }: { settings: AppSettings | null }) {
  const [state, action, pending] = useActionState(saveIntegrations, IDLE)
  const [channels, setChannels] = useState<SlackChannel[] | null>(null)
  const [channelsError, setChannelsError] = useState<string | null>(null)
  const [channelId, setChannelId] = useState(settings?.slack_channel_id ?? '')

  useEffect(() => {
    let cancelled = false

    fetch('/api/slack/channels')
      .then(async (res) => {
        const body = (await res.json()) as { channels?: SlackChannel[]; error?: string }
        if (cancelled) return
        if (body.error) setChannelsError(body.error)
        else setChannels(body.channels ?? [])
      })
      .catch(() => {
        if (!cancelled) setChannelsError('Could not reach Slack.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const chosen = channels?.find((c) => c.id === channelId)

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-medium text-stone-900">Purchase orders</h2>
        <p className="text-sm text-stone-500">
          Where a generated PO is filed, and who gets told about it.
        </p>
      </div>

      {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}
      {state.status === 'saved' && <Alert tone="success">Saved.</Alert>}

      <form action={action} className="space-y-3">
        <Field
          label="Google Drive folder link"
          hint="Open the folder in Drive and copy the address bar."
        >
          <Input
            name="drive_folder_url"
            defaultValue={settings?.drive_folder_url ?? ''}
            placeholder="https://drive.google.com/drive/folders/…"
          />
        </Field>

        <Alert tone="info">
          Pasting the link does not grant access. Share the folder with the service account
          address — it looks like an email and is in{' '}
          <code className="font-mono text-xs">GOOGLE_SERVICE_ACCOUNT_EMAIL</code> — giving it
          Editor. Without that, uploads fail with &ldquo;File not found&rdquo; even though the link
          works for you.
        </Alert>

        <Field label="Slack destination" hint="Where the PO link is posted.">
          {channels && channels.length > 0 ? (
            <Select
              name="slack_channel_id"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              <option value="">Do not post to Slack</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.isPrivate ? '🔒' : '#'}
                  {c.name}
                  {c.isMember ? '' : ' — bot is not in this channel'}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              name="slack_channel_id"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              placeholder="C0123456789"
            />
          )}
        </Field>

        <input type="hidden" name="slack_channel_name" value={chosen?.name ?? settings?.slack_channel_name ?? ''} />

        {channelsError && (
          <p className="text-sm text-amber-700">
            {channelsError} Enter the channel ID by hand, or see v3/docs/slack-setup.md.
          </p>
        )}

        {chosen && !chosen.isMember && (
          <Alert tone="error">
            The Nerige bot is not in #{chosen.name}. Posting will fail until someone invites it —
            type <code className="font-mono text-xs">/invite @Nerige</code> in that channel.
          </Alert>
        )}

        <Field label="PO number prefix" hint="Purchase orders are numbered PREFIX-0001 upwards.">
          <Input name="po_prefix" defaultValue={settings?.po_prefix ?? 'NRG-PO'} className="font-mono" />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Card>
  )
}

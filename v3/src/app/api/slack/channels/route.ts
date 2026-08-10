import { NextResponse } from 'next/server'
import { requireProcurement } from '@/lib/auth/session'
import { listSlackChannels, slackConfig, SlackError } from '@/lib/integrations/slack'

/**
 * The channel picker's options.
 *
 * A route handler rather than a server action because the settings screen
 * fetches this on mount: a Slack token that has expired should degrade to a
 * text field, not stop the whole settings page from rendering.
 *
 * `requireProcurement()` first. The channel list of a company Slack is not
 * public information, and this endpoint would otherwise hand it to anyone who
 * guessed the path.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  await requireProcurement()

  const config = slackConfig()
  if (!config) {
    return NextResponse.json({
      error: 'Slack is not connected. Set SLACK_BOT_TOKEN in .env.local.',
    })
  }

  try {
    return NextResponse.json({ channels: await listSlackChannels(config) })
  } catch (err) {
    // 200 with an error field, deliberately. The caller renders this as a hint
    // beside a still-usable field; a 500 would show as a failed fetch and say
    // nothing about why.
    return NextResponse.json({
      error: err instanceof SlackError ? err.message : 'Could not reach Slack.',
    })
  }
}

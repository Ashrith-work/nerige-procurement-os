import 'server-only'

/**
 * Posting a purchase order link into Slack.
 *
 * Raw fetch rather than `@slack/web-api`: this needs two methods —
 * `conversations.list` to populate the picker and `chat.postMessage` to send —
 * and the SDK is a large dependency for two POSTs with a bearer token.
 *
 * Slack answers 200 with `{ok: false, error: "..."}` for every failure,
 * including authentication ones. Treating an HTTP 200 as success is how a
 * "sent" state gets recorded for a message that was never delivered, so every
 * call here checks `ok` and surfaces Slack's own error string — those strings
 * (`not_in_channel`, `channel_not_found`, `invalid_auth`) each name their own
 * fix, which a generic failure message would throw away.
 */

export interface SlackConfig {
  botToken: string
}

export function slackConfig(): SlackConfig | null {
  const botToken = process.env.SLACK_BOT_TOKEN
  return botToken ? { botToken } : null
}

export class SlackError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'SlackError'
  }
}

/** Slack's own error codes, in language that names the fix. */
const EXPLANATIONS: Record<string, string> = {
  not_in_channel:
    'The Nerige bot is not in that channel. Type /invite @Nerige in it and try again.',
  channel_not_found:
    'Slack does not recognise that channel. Pick it again from the list in Settings.',
  invalid_auth: 'The Slack token is not valid any more. Re-issue it — see v3/docs/slack-setup.md.',
  missing_scope:
    'The Slack app is missing a permission scope. See the scope list in v3/docs/slack-setup.md.',
  is_archived: 'That channel is archived.',
  restricted_action: 'Slack workspace settings do not allow the bot to post there.',
}

async function call<T>(
  config: SlackConfig,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  const data = (await response.json()) as T & { ok: boolean; error?: string }

  if (!data.ok) {
    const code = data.error ?? 'unknown'
    throw new SlackError(EXPLANATIONS[code] ?? `Slack refused: ${code}`, code)
  }

  return data
}

export interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
  isMember: boolean
}

/**
 * Channels and people the PO can be sent to.
 *
 * Both public and private channels, and DMs, so "a channel or a person" is one
 * picker rather than two. `is_member` is carried through to the UI because a
 * channel the bot is not in will accept being selected here and then fail at
 * post time — which is after the PO has been generated and uploaded, and is
 * therefore the worst possible moment to discover it.
 */
export async function listSlackChannels(config: SlackConfig): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = []
  let cursor: string | undefined

  // Paginated. A workspace of any size has more than the 200-per-page default,
  // and the channel somebody wants is reliably on page two.
  do {
    const page = await call<{
      channels: { id: string; name: string; is_private: boolean; is_member: boolean }[]
      response_metadata?: { next_cursor?: string }
    }>(config, 'conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    })

    for (const c of page.channels ?? []) {
      channels.push({
        id: c.id,
        name: c.name,
        isPrivate: c.is_private,
        isMember: c.is_member,
      })
    }

    cursor = page.response_metadata?.next_cursor || undefined
  } while (cursor)

  return channels.sort((a, b) => a.name.localeCompare(b.name))
}

export interface PostedMessage {
  channel: string
  ts: string
}

export async function postPurchaseOrder(
  config: SlackConfig,
  opts: {
    channel: string
    vendorName: string
    vendorCode: string
    poNumber: string
    driveLink: string | null
    lineCount: number
    pieceCount: number
  },
): Promise<PostedMessage> {
  const summary = `${opts.poNumber} · ${opts.vendorName}`

  const blocks: unknown[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Purchase order ${opts.poNumber}*\n` +
          `${opts.vendorName} (\`${opts.vendorCode}\`) · ` +
          `${opts.lineCount} line${opts.lineCount === 1 ? '' : 's'} · ` +
          `${opts.pieceCount} piece${opts.pieceCount === 1 ? '' : 's'}`,
      },
    },
  ]

  if (opts.driveLink) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open the PO' },
          url: opts.driveLink,
        },
      ],
    })
  }

  const result = await call<{ channel: string; ts: string }>(config, 'chat.postMessage', {
    channel: opts.channel,
    // Fallback text, and what a phone notification shows. A message with only
    // blocks arrives on a lock screen as "This content can't be displayed".
    text: summary,
    blocks,
    unfurl_links: false,
  })

  return { channel: result.channel, ts: result.ts }
}

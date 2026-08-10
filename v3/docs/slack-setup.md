# Connecting Slack

Once a PO is in Drive, its link gets posted to a Slack channel you choose from a
picker. Ten minutes, no approval queue.

---

## 1. The app

At [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** →
**From scratch**:

| Field | Value |
| --- | --- |
| App name | `Nerige` |
| Workspace | the Nerige workspace |

The name is what appears as the message author, so it is worth getting right
now.

---

## 2. Scopes

**OAuth & Permissions → Bot Token Scopes**. Add exactly these three:

| Scope | Why |
| --- | --- |
| `chat:write` | Post the message. |
| `channels:read` | List public channels for the picker. |
| `groups:read` | List private channels the bot has been invited to. |

Nothing else. In particular **not** `chat:write.public`, which would let the app
post into any public channel without being invited — convenient, and precisely
the permission that turns a misconfiguration into a company-wide message.

---

## 3. Install

**Install App → Install to Workspace → Allow.**

Copy the **Bot User OAuth Token**. It starts `xoxb-`:

```bash
SLACK_BOT_TOKEN=xoxb-...
```

> Take the *Bot* token, not the User token. The User token acts as you, so
> every PO would appear to have been posted by whoever installed the app.

---

## 4. Invite the bot to the channel

A bot cannot post into a channel it is not in. In whichever channel the POs
should land:

```
/invite @Nerige
```

Skipping this is the commonest failure, and it fails at *post* time — after the
PO has been generated and uploaded, which is the worst moment to find out. The
picker in Settings marks channels the bot is not in, and the portal refuses with
a message naming the fix rather than showing `not_in_channel`.

---

## 5. Choose the destination

**Settings → Purchase orders → Slack destination.** The list is loaded live from
the Slack API, so there is no channel ID to look up or mistype.

If Slack is unreachable or the token has expired, the field falls back to a text
input taking a raw channel ID (`C0123456789`) — the rest of the settings screen
still works.

---

## 6. The variable

```bash
SLACK_BOT_TOKEN=xoxb-...
```

The channel is stored in `app_settings` from the picker, not in the environment,
so it can be changed without a deploy.

If the token is unset, the **Send to Slack** button says so and nothing else is
affected.

---

## What gets posted

```
Purchase order NRG-PO-00042
HDR Handlooms (HDR) · 12 lines · 47 pieces
[ Open the PO ]
```

The button links to the Drive file. If the PO has not been uploaded to Drive
yet, the message still posts — with the numbers and without the button — and the
portal says so rather than silently dropping the link.

---

## When it goes wrong

| Slack error | What to do |
| --- | --- |
| `not_in_channel` | `/invite @Nerige` in that channel. |
| `channel_not_found` | Private channel the bot cannot see, or a stale ID. Re-pick it in Settings. |
| `invalid_auth` | Token revoked or the app reinstalled. Copy the token again from OAuth & Permissions. |
| `missing_scope` | A scope from step 2 is absent. Add it, then **reinstall** — scope changes need a reinstall to take effect. |

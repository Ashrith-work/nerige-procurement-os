# Connecting WhatsApp

End to end, in the order the screens actually appear. Budget an hour, plus
however long Meta takes to approve the template — see
[whatsapp-template.md](./whatsapp-template.md), and start that first because it
is the only step with a queue in front of it.

---

## What you are building

The **WhatsApp Cloud API**, hosted by Meta. Not the Business App on a phone, and
not a third-party provider like Twilio. Cloud API is free for the first 1,000
conversations a month and needs no infrastructure.

Four things get created, and they nest:

```
Meta Business Account
└── WhatsApp Business Account (WABA)
    └── phone number          ← the number weavers see the message from
└── Meta app                  ← holds the API credentials and the webhook
```

---

## 1. Meta Business Account

If Nerige already has one for Facebook or Instagram ads, use it — do not create
a second. At [business.facebook.com](https://business.facebook.com):

1. **Settings → Business info** — confirm the legal name and address match the
   registration. This is checked during verification.
2. **Settings → Business verification** — start it now. It takes days and the
   number stays capped at 250 conversations a day until it clears.

---

## 2. The app

At [developers.facebook.com/apps](https://developers.facebook.com/apps):

1. **Create app → Other → Business**.
2. Name it `Nerige Portal`, and link it to the Business Account from step 1.
3. On the dashboard, find **WhatsApp** and press **Set up**.

You now have a test number and a temporary token. Both are for trying things
out; neither survives to production.

---

## 3. The phone number

**A number registered to WhatsApp Business cannot be used.** It has to be
deregistered from the app first, and that deletes its chat history. Use a number
that has never been on WhatsApp — a new SIM, or a landline that can receive a
voice call for the verification code.

In **WhatsApp → API Setup → Add phone number**:

1. Enter the number with its country code.
2. Choose SMS or voice verification and enter the code.
3. Set the **display name** — this is what a weaver sees as the sender. Use
   `Nerige` or `Nerige Story`; Meta rejects names that do not relate to the
   business.

Copy the **Phone number ID** shown on this screen. It is a long number and it is
*not* the phone number:

```bash
WHATSAPP_PHONE_NUMBER_ID=123456789012345
```

> **While testing:** an unverified business can only message numbers on an
> allow-list. Add your own under **API Setup → To**. A send to any other number
> fails with error `131030`, which reads like a broken integration and is not.

---

## 4. A permanent access token

The token on the API Setup screen expires in 24 hours. Do not put it anywhere
except a curl command you are about to run.

For a permanent one, at
[business.facebook.com/settings/system-users](https://business.facebook.com/settings/system-users):

1. **Add** → name it `nerige-portal` → role **Admin**.
2. **Add assets** → your app → toggle **Manage app**.
3. **Generate new token** → select the app → set expiry to **Never**.
4. Tick these two scopes and nothing more:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Copy it. **It is shown once.**

```bash
WHATSAPP_ACCESS_TOKEN=EAAG...
```

---

## 5. The webhook

Without this, `whatsapp_sent_at` means "we handed a message to Meta" and nothing
more. A wrong number, a weaver who has left WhatsApp, a handset that has been
off for a week — all of them accept the send and fail quietly some minutes
later. The webhook is the only way the difference between **sent** and
**delivered** ever reaches the screen.

Pick any random string as a verify token and generate one now:

```bash
openssl rand -hex 24
```

In **WhatsApp → Configuration → Webhook**:

| Field | Value |
| --- | --- |
| Callback URL | `https://YOUR-DOMAIN/api/whatsapp/webhook` |
| Verify token | the string you just generated |

Press **Verify and save**. Meta immediately GETs that URL and expects the
challenge echoed back — the route handles it, but it must be **deployed and
publicly reachable first**. Verifying against localhost cannot work.

Then **Manage** → subscribe to the **`messages`** field. That single field
carries delivery receipts as well as inbound messages.

Finally, the app secret, from **App settings → Basic → App secret → Show**. Every
webhook POST is signed with it, and the route refuses anything that does not
verify — without it, anyone could POST a `delivered` for any message and mark an
order as received by a weaver who never got it.

```bash
WHATSAPP_VERIFY_TOKEN=the-string-you-generated
WHATSAPP_APP_SECRET=abc123...
```

---

## 6. Every variable, together

```bash
# WhatsApp Cloud API
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...

# Set these once Meta approves the template — see whatsapp-template.md
WHATSAPP_TEMPLATE_NAME=nerige_new_order
WHATSAPP_TEMPLATE_LANGUAGE=en
```

If `WHATSAPP_PHONE_NUMBER_ID` or `WHATSAPP_ACCESS_TOKEN` is unset, the WhatsApp
button says so plainly and nothing else in the portal is affected. It is safe to
deploy without them.

---

## 7. The vendor's number

Set on each vendor's admin screen, **in E.164 with the country code**:

```
+919876543210        correct
9876543210           rejected — no country code
+91 98765 43210      rejected — spaces
```

A ten-digit Indian number with `+91` assumed is the single most common way these
sends fail, so the column has a CHECK constraint and the form validates before
saving.

---

## When it goes wrong

| Meta code | What it means | What to do |
| --- | --- | --- |
| `132001` | No approved template by that name | Submit the template. Check `WHATSAPP_TEMPLATE_NAME` and `_LANGUAGE` match the approved one exactly. |
| `132000` | Variable count does not match | The body text and `sendOrderOnWhatsApp` disagree. Both send three. |
| `131047` | Outside the 24-hour window | The template send failed and images were attempted anyway. Look at why the template failed. |
| `131030` | Recipient not on the allow-list | Business not verified yet. Add the number under API Setup → To. |
| `131026` | Not a WhatsApp number | Check the number on the vendor screen. |
| `190` | Token expired | You used the 24-hour token. Go back to step 4. |
| `100` | Malformed request | Nearly always a number not in E.164. |

The portal shows these in plain language rather than as a code — see
`EXPLANATIONS` in `src/lib/integrations/whatsapp.ts`.

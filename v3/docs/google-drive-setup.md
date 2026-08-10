# Connecting Google Drive

Purchase orders upload into one Drive folder that you nominate once.

**The step everyone misses is step 4.** Pasting the folder link into Settings
grants this application nothing. A service account is a separate Google
principal with its own address, and the folder has to be *shared* with that
address exactly as it would be shared with a colleague. Without it, uploads fail
with "File not found" for a folder whose link opens perfectly in your own
browser — because it genuinely is not found, by the account doing the asking.

---

## 1. A Google Cloud project

At [console.cloud.google.com](https://console.cloud.google.com):

1. **Select a project → New project** → name it `nerige-portal`.
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.

Nothing here costs anything. Drive API calls are free at any volume this will
reach.

---

## 2. A service account

**APIs & Services → Credentials → Create credentials → Service account**:

| Field | Value |
| --- | --- |
| Name | `nerige-po-uploader` |
| Role | *(leave empty)* |

The role is deliberately empty. Those are Cloud IAM roles governing Google Cloud
resources; access to a Drive folder is granted by *sharing the folder*, which is
step 4. Granting Cloud roles here does nothing for Drive and widens the account
for no reason.

Copy the account's email — it looks like a real address and behaves like one:

```
nerige-po-uploader@nerige-portal.iam.gserviceaccount.com
```

---

## 3. A key

On the service account → **Keys → Add key → Create new key → JSON**. A file
downloads. It contains a private key and Google will not show it again.

Two fields from it become environment variables:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=nerige-po-uploader@nerige-portal.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN...\n-----END PRIVATE KEY-----\n"
```

> **The newlines matter.** In the JSON file the key contains real line breaks.
> Most hosting environment-variable UIs cannot hold those, so paste it with
> literal `\n` sequences and wrap the whole value in double quotes. The code
> converts them back. A key that keeps its escaped newlines fails signing with
> an ASN.1 parse error that names nothing useful.

Do not commit the JSON file. `.gitignore` already covers `*.json` under a
`credentials/` path, but the safest thing is to keep it out of the repository
entirely.

---

## 4. Share the folder — the step that is actually load-bearing

1. Create or choose the folder in Drive, e.g. **Purchase Orders**.
2. Right-click → **Share**.
3. Paste the service account address from step 2.
4. Set it to **Editor**. Viewer cannot upload.
5. Untick "Notify people" — it is not a person and the mail bounces.
6. **Share**.

Then copy the folder's address from the browser bar and paste it into the portal
under **Settings → Purchase orders → Google Drive folder link**. It looks like:

```
https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv
```

The portal parses the folder id out of it, so any of Drive's link shapes works —
including `?usp=sharing` on the end.

---

## 5. Shared drives

If the folder lives on a **shared drive** rather than in someone's My Drive,
sharing the folder is not enough on its own: the service account must be a
**member of the shared drive**. Add it under the drive's **Manage members**,
with Content manager or above.

The API calls already pass `supportsAllDrives`, so no code change is needed —
but without membership the failure is identical to the one in step 4, which
sends people looking in the wrong place.

---

## 6. Every variable, together

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=nerige-po-uploader@nerige-portal.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

The folder id is not an environment variable — it is stored in `app_settings`
from the link you paste in Settings, so it can be changed without a deploy.

If these are unset, the **Upload to Drive** button says so and everything else
works. Generating and downloading a PO does not touch Drive at all.

---

## When it goes wrong

| Symptom | Cause |
| --- | --- |
| "File not found" on upload | Step 4 was skipped, or the folder was shared with the wrong address. Check it is the `iam.gserviceaccount.com` one. |
| "File not found", folder *is* shared | The folder is on a shared drive and the account is not a member — step 5. |
| `invalid_grant` / ASN.1 error | The private key lost its newlines. Re-paste with literal `\n` and surrounding quotes. |
| 403 `insufficientPermissions` | The account was shared as Viewer, not Editor. |

import 'server-only'
import { JWT } from 'google-auth-library'

/**
 * Uploading a purchase order into a Google Drive folder.
 *
 * THE THING THAT CATCHES EVERYONE: a service account is a separate Google
 * principal with its own address, and pasting a folder link into this
 * application grants it nothing. The folder has to be shared with that address
 * exactly as it would be shared with a colleague. Without that step the API
 * returns "File not found" for a folder whose link opens perfectly in the
 * admin's own browser — because it genuinely is not found, by the account doing
 * the asking. The settings screen says so and so does docs/google-drive-setup.md.
 *
 * The Drive REST API is called directly rather than through `googleapis`. That
 * package is ~50MB of generated clients for every Google product; this needs
 * one multipart POST and one permissions call, and the auth library alone is
 * what provides the hard part (JWT signing and token exchange).
 */

export interface DriveConfig {
  clientEmail: string
  privateKey: string
}

export function driveConfig(): DriveConfig | null {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_PRIVATE_KEY

  if (!clientEmail || !privateKey) return null

  return {
    clientEmail,
    // Environment variables cannot hold real newlines in most hosting UIs, so
    // the key is stored with literal \n and restored here. A key that keeps its
    // escaped newlines fails signing with an unhelpful ASN.1 error.
    privateKey: privateKey.replace(/\\n/g, '\n'),
  }
}

export class DriveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DriveError'
  }
}

/**
 * The folder id, out of whatever the admin pasted.
 *
 * Drive hands out several shapes and never the bare id:
 *   https://drive.google.com/drive/folders/ID
 *   https://drive.google.com/drive/u/0/folders/ID?usp=sharing
 *   https://drive.google.com/open?id=ID
 */
export function parseDriveFolderId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null

  // Pasted bare.
  if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return raw

  try {
    const url = new URL(raw)
    if (!url.hostname.endsWith('google.com')) return null

    const fromQuery = url.searchParams.get('id')
    if (fromQuery && /^[A-Za-z0-9_-]{10,}$/.test(fromQuery)) return fromQuery

    const segments = url.pathname.split('/').filter(Boolean)
    const index = segments.indexOf('folders')
    if (index >= 0 && segments[index + 1]) return segments[index + 1]

    return null
  } catch {
    return null
  }
}

async function accessToken(config: DriveConfig): Promise<string> {
  const jwt = new JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })

  const { access_token: token } = await jwt.authorize()
  if (!token) throw new DriveError('Google refused the service account credentials.')
  return token
}

export interface UploadResult {
  fileId: string
  webViewLink: string
}

/**
 * Multipart upload: one request carrying the metadata and the bytes.
 *
 * `supportsAllDrives` is set because a Nerige shared drive is a different
 * storage backend from a personal My Drive folder, and without the flag the
 * same call succeeds against one and 404s against the other — which presents
 * exactly like the sharing mistake above and sends people looking in the wrong
 * place.
 */
export async function uploadToDrive(
  config: DriveConfig,
  opts: {
    folderId: string
    fileName: string
    mimeType: string
    body: Uint8Array
  },
): Promise<UploadResult> {
  const token = await accessToken(config)

  const boundary = `nerige-${Math.random().toString(36).slice(2)}`

  const metadata = JSON.stringify({
    name: opts.fileName,
    parents: [opts.folderId],
    mimeType: opts.mimeType,
  })

  const head = new TextEncoder().encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${opts.mimeType}\r\n\r\n`,
  )
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`)

  const payload = new Uint8Array(head.length + opts.body.length + tail.length)
  payload.set(head, 0)
  payload.set(opts.body, head.length)
  payload.set(tail, head.length + opts.body.length)

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: payload as unknown as BodyInit,
    },
  )

  const text = await response.text()

  if (!response.ok) {
    if (response.status === 404) {
      throw new DriveError(
        'Google Drive says that folder does not exist. The usual cause is that it has not been ' +
          'shared with the service account address — pasting the link does not grant access. ' +
          'See v3/docs/google-drive-setup.md.',
      )
    }
    throw new DriveError(`Google Drive refused the upload (${response.status}): ${text}`)
  }

  const file = JSON.parse(text) as { id: string; webViewLink?: string }

  return {
    fileId: file.id,
    // webViewLink is only returned when the caller can already see the file;
    // constructing it is safe and always correct for a Drive file id.
    webViewLink: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
  }
}

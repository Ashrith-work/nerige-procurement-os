'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/primitives'

export interface IssuedCredential {
  userId: string
  password: string
  vendorCode: string
  displayName: string
}

/**
 * The one and only time this password is visible.
 *
 * It exists in the response that created it and nowhere else — not in a table,
 * not in a log, not in a cookie. So this card has to be unmissable and has to
 * be easy to get out of the screen and onto paper or into a message, because
 * closing it without doing that means issuing a new one.
 *
 * Hence both a copy button and a print button. Copy is for pasting into
 * WhatsApp; print is for the slip of paper that goes in the post with a weaver
 * who does not use WhatsApp, and prints the credential alone rather than the
 * whole admin screen around it.
 *
 * The password is rendered in a large monospace face with generous letter
 * spacing for the same reason the alphabet excludes O, 0, l, I, 1, S and 5:
 * this gets read aloud down a phone line.
 */
export function CredentialCard({ credential }: { credential: IssuedCredential }) {
  const [copied, setCopied] = useState(false)

  const asText =
    `Nerige portal\n` +
    `User ID: ${credential.userId}\n` +
    `Password: ${credential.password}\n` +
    `Sign in at the link Nerige sent you.`

  return (
    <div
      id="credential-card"
      className="space-y-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4"
    >
      <div>
        <p className="text-sm font-medium text-emerald-900">
          Login created for {credential.displayName}
        </p>
        <p className="text-sm text-emerald-800">
          Copy this now. It cannot be shown again — not by you, not by anyone at Nerige.
        </p>
      </div>

      <dl className="space-y-2 rounded-lg bg-white p-3">
        <div>
          <dt className="text-xs text-stone-500">User ID</dt>
          <dd className="font-mono text-lg text-stone-900">{credential.userId}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Password</dt>
          <dd className="font-mono text-2xl tracking-[0.15em] text-stone-900">
            {credential.password}
          </dd>
        </div>
      </dl>

      <div className="no-print flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(asText)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            } catch {
              // Clipboard is blocked on insecure origins and in some embedded
              // browsers. The text is on screen and selectable either way.
              setCopied(false)
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>

        <Button type="button" variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      {/* Prints this card alone. Everything else on the page carries no-print
          or is hidden by the rule in globals.css. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #credential-card, #credential-card * { visibility: visible; }
          #credential-card { position: absolute; inset: 0; border: none; background: white; }
        }
      `}</style>
    </div>
  )
}

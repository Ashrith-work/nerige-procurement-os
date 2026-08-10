'use client'

import { useActionState, useState } from 'react'
import { format } from 'date-fns'
import { Button, Card, Field, Input, Alert, StatusBadge } from '@/components/ui/primitives'
import { CredentialCard } from '@/components/admin/credential-card'
import {
  addVendorLogin,
  resetVendorPassword,
  type CredentialResult,
} from '../credential-actions'

interface Login {
  user_id: string
  email: string | null
  full_name: string
  status: string
  last_seen_at: string | null
  credential_issued_at: string | null
}

const IDLE: CredentialResult = { status: 'idle' }

/**
 * The logins at one weaver, and the two ways to hand out a password.
 *
 * Both paths end in the same card, and the card is the only place the password
 * ever exists outside Supabase's hash. There is no "view password" action here
 * and there cannot be one — see credential-actions.ts.
 *
 * `credential_issued_at` is shown against every login precisely because the
 * password is not. It is the difference between "I don't know if she was ever
 * given a login" and "she was given one on 4 August and has never signed in",
 * which are two completely different phone calls to make.
 */
export function CredentialPanel({
  vendorId,
  vendorCode,
  logins,
}: {
  vendorId: string
  vendorCode: string
  logins: Login[]
}) {
  const [addState, addAction, adding] = useActionState(addVendorLogin, IDLE)
  const [resetState, resetAction, resetting] = useActionState(resetVendorPassword, IDLE)
  const [showAdd, setShowAdd] = useState(false)

  const issued = addState.credential ?? resetState.credential
  const error = addState.message ?? resetState.message

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-medium text-stone-900">Logins</h2>
          <p className="text-sm text-stone-500">
            Passwords are never stored. Nobody at Nerige can look one up — if it is lost, issue a
            new one.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : 'Add a login'}
        </Button>
      </div>

      {issued && <CredentialCard credential={issued} />}
      {error && <Alert tone="error">{error}</Alert>}

      {showAdd && (
        <form action={addAction} className="space-y-3 rounded-lg bg-stone-50 p-3">
          <input type="hidden" name="vendorId" value={vendorId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Login ID" hint="A short handle, like hdr2. No email needed.">
              <Input name="login_id" required placeholder={`${vendorCode.toLowerCase()}2`} />
            </Field>
            <Field label="Name" hint="Who this login belongs to.">
              <Input name="full_name" required />
            </Field>
          </div>
          <Button type="submit" disabled={adding}>
            {adding ? 'Creating…' : 'Create login'}
          </Button>
        </form>
      )}

      {logins.length === 0 ? (
        <p className="text-sm text-amber-700">
          No login yet. This weaver cannot open the portal at all.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {logins.map((login) => (
            <li key={login.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-900">{login.full_name}</p>
                <p className="text-xs text-stone-500">
                  {login.credential_issued_at
                    ? `Password issued ${format(new Date(login.credential_issued_at), 'd MMM yyyy')}`
                    : 'Password issued before this was recorded'}
                  {' · '}
                  {login.last_seen_at
                    ? `last signed in ${format(new Date(login.last_seen_at), 'd MMM yyyy')}`
                    : 'never signed in'}
                </p>
              </div>

              <StatusBadge status={login.status} />

              <form action={resetAction}>
                <input type="hidden" name="userId" value={login.user_id} />
                <Button type="submit" variant="secondary" disabled={resetting}>
                  {resetting ? 'Working…' : 'Reset password'}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

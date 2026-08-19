'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button, Input, Textarea, Select, Field, Alert } from '@/components/ui/primitives'
import { requestSignup, REQUESTABLE_ROLES, type SignupState } from './actions'

const INITIAL: SignupState = { status: 'idle' }

/**
 * Asking for an account.
 *
 * NO PASSWORD FIELD, and it is worth knowing why rather than assuming it was
 * forgotten. A password typed here would have to be stored until somebody got
 * round to approving it, and Supabase Auth's admin API takes a plaintext
 * password rather than a hash we computed — so the only available shapes are
 * plaintext or reversible, for an account that may never exist. Approval mints
 * a one-time password instead. See migration 028.
 *
 * The weaver code field appears only for a weaver, because it is the only role
 * it means anything for, and an empty box labelled with a word you do not
 * recognise is a reason to abandon a form.
 */
export function SignupForm() {
  const [state, action, pending] = useActionState(requestSignup, INITIAL)
  const [role, setRole] = useState('')

  if (state.status === 'sent') {
    return (
      <div className="space-y-4">
        <Alert tone="success">{state.message}</Alert>
        <p className="text-sm text-stone-500">
          You will not be able to sign in until then. Nobody is sent an email — whoever asked you
          to sign up will pass on your password.
        </p>
        <Link href="/login" className="block">
          <Button variant="secondary" className="w-full">
            Back to sign in
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}

      <Field label="Your name">
        <Input name="full_name" required autoFocus placeholder="Lakshmi Devi" />
      </Field>

      <Field
        label="User ID"
        hint="Your work email, or a short handle in lower case — this is what you will sign in with."
      >
        <Input
          name="user_id"
          required
          // Same reasoning as the sign-in box: Android capitalises the first
          // letter by default, which would show "Hdr" for an account called
          // "hdr" and make the applicant doubt what they typed.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="hdr"
        />
      </Field>

      <Field label="What do you do?">
        <Select name="role" required value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Choose one</option>
          {REQUESTABLE_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>

      {role === 'vendor' && (
        <Field label="Your weaver code" hint="The letters at the start of your SKUs, e.g. HDR.">
          <Input
            name="vendor_code"
            required
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="HDR"
          />
        </Field>
      )}

      <Field label="Phone (optional)" hint="So Nerige can reach you about this request.">
        <Input name="phone" type="tel" placeholder="+91…" />
      </Field>

      <Field label="Anything else? (optional)">
        <Textarea name="note" rows={3} maxLength={500} />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Sending…' : 'Request an account'}
      </Button>

      <p className="text-center text-sm text-stone-500">
        Already have a login?{' '}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </form>
  )
}

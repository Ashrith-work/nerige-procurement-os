'use client'

import { useActionState } from 'react'
import { signIn, type LoginState } from './actions'
import { Button, Input, Field, Alert } from '@/components/ui/primitives'
import type { Dictionary } from '@/lib/i18n'

const INITIAL: LoginState = { status: 'idle' }

/**
 * One form, two fields, for everybody.
 *
 * There used to be a tab here, because the weaver and the Nerige team signed in
 * by different means. They no longer do — both are issued a user ID and a
 * password — and a tab that switches between two identical forms is a decision
 * asked of someone who has no reason to care about the answer.
 *
 * Which portal you land on is decided by your role in `app_users`, not by
 * anything picked on this screen. See `homePathFor`.
 */
export function LoginForm({ next, t }: { next: string; t: Dictionary }) {
  const [state, action, pending] = useActionState(signIn, INITIAL)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <Field label={t.login.userId} hint={t.login.userIdHint}>
        <Input
          name="userId"
          // A handle is lowercase and has no spaces. Android capitalises the
          // first letter of a text field by default, which would send "Hdr" to
          // an account called "hdr" — toAuthEmail() lowercases anyway, but
          // turning it off here means the weaver sees what she typed.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          required
          autoFocus
          placeholder={t.login.userIdPlaceholder}
        />
      </Field>

      <Field label={t.login.password}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t.login.signingIn : t.common.signIn}
      </Button>
    </form>
  )
}

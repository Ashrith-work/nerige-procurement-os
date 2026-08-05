'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  requestMagicLink,
  requestPhoneOtp,
  verifyPhoneOtp,
  signInWithGoogle,
  type LoginState,
} from './actions'
import { Button, Input, Field, Alert } from '@/components/ui/primitives'
import type { Dictionary } from '@/lib/i18n'

const INITIAL: LoginState = { status: 'idle' }

/**
 * Two sign-in channels on one screen.
 *
 * Vendor is the DEFAULT tab, not the Nerige team. There is one Pooja and there
 * are fifty weavers, and the weavers are the ones least able to absorb
 * friction. Every extra decision on this screen is a reason to give up and send
 * a WhatsApp message instead — which is the outcome this portal exists to
 * replace.
 */
export function LoginForm({ next, t }: { next: string; t: Dictionary }) {
  const [tab, setTab] = useState<'vendor' | 'team'>('vendor')

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Sign-in method"
        className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1"
      >
        {(['vendor', 'team'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-11 rounded-md text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-white text-stone-900 shadow-sm'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {key === 'vendor' ? t.login.tabVendor : t.login.tabTeam}
          </button>
        ))}
      </div>

      {tab === 'vendor' ? <VendorLogin t={t} /> : <TeamLogin next={next} t={t} />}
    </div>
  )
}

function VendorLogin({ t }: { t: Dictionary }) {
  const router = useRouter()
  const [requestState, requestAction, requesting] = useActionState(requestPhoneOtp, INITIAL)
  const [verifyState, verifyAction, verifying] = useActionState(verifyPhoneOtp, INITIAL)

  const codeSent = requestState.status === 'sent'

  return codeSent ? (
    <form
      action={async (fd) => {
        await verifyAction(fd)
        router.refresh()
      }}
      className="space-y-4"
    >
      <input type="hidden" name="phone" value={requestState.phone ?? ''} />
      <Field label={t.login.enterCode} hint={requestState.message}>
        <Input
          name="code"
          // inputMode numeric plus autocomplete one-time-code lets Android and
          // iOS offer the SMS code above the keyboard. Saves switching apps to
          // read it — a small detail with a large effect on whether the portal
          // gets used at all.
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          placeholder="123456"
          className="text-center text-2xl tracking-[0.5em]"
        />
      </Field>
      {verifyState.status === 'error' && <Alert tone="error">{verifyState.message}</Alert>}
      <Button type="submit" disabled={verifying} className="w-full">
        {verifying ? t.login.checking : t.common.signIn}
      </Button>
    </form>
  ) : (
    <form action={requestAction} className="space-y-4">
      <Field label={t.login.mobileNumber} hint={t.login.mobileHint}>
        <Input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          autoFocus
          placeholder={t.login.mobilePlaceholder}
        />
      </Field>
      {requestState.status === 'error' && <Alert tone="error">{requestState.message}</Alert>}
      <Button type="submit" disabled={requesting} className="w-full">
        {requesting ? t.login.sending : t.login.sendCode}
      </Button>
    </form>
  )
}

function TeamLogin({ next, t }: { next: string; t: Dictionary }) {
  const [state, action, pending] = useActionState(requestMagicLink, INITIAL)

  return (
    <div className="space-y-4">
      {/* Google first: it is one tap, and the team all have work accounts. The
          magic link stays because it needs no provider configured and is the
          one that still works when Google is having a bad day. */}
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="secondary" className="w-full">
          <GoogleMark />
          {t.login.continueWithGoogle}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-stone-200" />
        <span className="text-xs text-stone-400">{t.login.or}</span>
        <span className="h-px flex-1 bg-stone-200" />
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label={t.login.workEmail}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@nerigestory.com"
          />
        </Field>
        {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}
        {state.status === 'sent' && <Alert tone="success">{state.message}</Alert>}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? t.login.sending : t.login.emailMeALink}
        </Button>
      </form>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 00.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}

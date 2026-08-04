'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { requestMagicLink, requestPhoneOtp, verifyPhoneOtp, type LoginState } from './actions'
import { Button, Input, Field, Alert } from '@/components/ui/primitives'

const INITIAL: LoginState = { status: 'idle' }

/**
 * Two sign-in channels on one screen.
 *
 * Vendor is the DEFAULT tab, not staff. There are four internal users and
 * potentially dozens of vendors, and vendors are the ones least able to absorb
 * friction. Every extra decision on this screen is a reason to give up and send
 * a WhatsApp message instead — which is the outcome this whole project exists
 * to prevent.
 */
export function LoginForm({ next }: { next: string }) {
  const [tab, setTab] = useState<'vendor' | 'staff'>('vendor')

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Sign-in method"
        className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1"
      >
        {(['vendor', 'staff'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-10 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {key === 'vendor' ? 'Vendor' : 'Nerige team'}
          </button>
        ))}
      </div>

      {tab === 'vendor' ? <VendorLogin /> : <StaffLogin next={next} />}
    </div>
  )
}

function VendorLogin() {
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
      <Field label="Enter the 6-digit code" hint={requestState.message}>
        <Input
          name="code"
          // inputMode numeric + autocomplete one-time-code lets Android and iOS
          // offer the SMS code above the keyboard. Saves the vendor switching
          // apps to read it — small detail, large adoption effect.
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
        {verifying ? 'Checking…' : 'Sign in'}
      </Button>
    </form>
  ) : (
    <form action={requestAction} className="space-y-4">
      <Field label="Mobile number" hint="The number registered with Nerige Story.">
        <Input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          autoFocus
          placeholder="98765 43210"
        />
      </Field>
      {requestState.status === 'error' && <Alert tone="error">{requestState.message}</Alert>}
      <Button type="submit" disabled={requesting} className="w-full">
        {requesting ? 'Sending…' : 'Send code'}
      </Button>
    </form>
  )
}

function StaffLogin({ next }: { next: string }) {
  const [state, action, pending] = useActionState(requestMagicLink, INITIAL)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Work email">
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
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
    </form>
  )
}

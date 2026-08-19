import { SignupForm } from './signup-form'
import { isSupabaseConfigured } from '@/lib/auth/guards'
import { Alert } from '@/components/ui/primitives'

export const metadata = { title: 'Request an account · Nerige' }

/**
 * The one page in this application a stranger may open.
 *
 * It creates nothing. Everything it can do is `request_signup`, which records
 * an asking; an account exists only after an admin approves it and application
 * code mints the login. That distinction is the whole design — see migration
 * 028 — and it is what lets this page be public without reopening the hole that
 * migration 009 closed when it removed OAuth and OTP, both of which created an
 * account as a side effect of somebody merely arriving.
 */
export default function SignupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-xl font-medium tracking-tight text-stone-900">Nerige</h1>
          <p className="text-sm text-stone-500">Request an account</p>
        </header>

        {!isSupabaseConfigured() && (
          <Alert tone="error">
            This deployment has no Supabase project behind it yet, so requests cannot be recorded.
          </Alert>
        )}

        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <SignupForm />
        </div>

        <p className="text-center text-xs text-stone-400">
          Accounts are approved by Nerige. Nothing is created until then.
        </p>
      </div>
    </main>
  )
}

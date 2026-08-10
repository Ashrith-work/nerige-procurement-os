import { notFound } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { LOCALES, LOCALE_NAMES } from '@/lib/i18n'
import { toDisplayUserId } from '@/lib/auth/user-id'
import { PageHeader, Card, Button, Select, Field, StatusBadge } from '@/components/ui/primitives'
import { setVendorLocale, startImpersonating } from '../actions'
import { CredentialPanel } from './credential-panel'

export const metadata = { title: 'Vendor · Nerige' }

interface Login {
  user_id: string
  email: string | null
  full_name: string
  status: string
  last_seen_at: string | null
  credential_issued_at: string | null
}

/**
 * One weaver.
 *
 * Three things happen here and nothing else: her portal language is set, her
 * logins are managed, and her portal is opened as she sees it.
 *
 * The language control is the one the whole Phase 1 locale change exists for.
 * It is a property of the WEAVER rather than of a login, so every account at
 * that house inherits it — the Gadwal weaver's son getting a second login next
 * month gets Telugu without anybody remembering to set it.
 */
export default async function AdminVendorPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  await requireProcurement()
  const supabase = await createClient()

  const { data: vendor } = await supabase
    .from('vendors')
    .select(
      'id, code, display_name, status, default_locale, primary_phone, default_lead_time_days',
    )
    .eq('code', decodeURIComponent(code).toUpperCase())
    .is('deleted_at', null)
    .maybeSingle()

  if (!vendor) notFound()

  const [{ data: summary }, { data: loginRows }, { data: viewedRows }] = await Promise.all([
    supabase
      .from('vendor_summary')
      .select('design_count, reorder_count, open_order_count, last_order_at')
      .eq('vendor_id', vendor.id)
      .maybeSingle(),
    supabase
      .from('vendor_users')
      .select('user_id, app_users(email, full_name, status, last_seen_at, credential_issued_at)')
      .eq('vendor_id', vendor.id)
      .is('deleted_at', null),
    supabase
      .from('impersonation_log')
      .select('started_at, app_users!impersonation_log_admin_user_id_fkey(full_name)')
      .eq('vendor_id', vendor.id)
      .order('started_at', { ascending: false })
      .limit(5),
  ])

  type EmbeddedUser = {
    email: string | null
    full_name: string
    status: string
    last_seen_at: string | null
    credential_issued_at: string | null
  }

  const logins: Login[] = (loginRows ?? []).map((row) => {
    const raw = row.app_users as EmbeddedUser | EmbeddedUser[] | null
    const u = Array.isArray(raw) ? raw[0] : raw
    return {
      user_id: row.user_id as string,
      email: u?.email ?? null,
      full_name: u?.full_name ?? '—',
      status: u?.status ?? 'unknown',
      last_seen_at: u?.last_seen_at ?? null,
      credential_issued_at: u?.credential_issued_at ?? null,
    }
  })

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={vendor.display_name}
        subtitle={vendor.code}
        action={
          <div className="flex gap-2">
            <Link href={`/admin/products?vendor=${encodeURIComponent(vendor.code)}`}>
              <Button variant="secondary">Her products</Button>
            </Link>

            {/* The whole point of this button: see her screen, not a report
                about her screen. */}
            <form action={startImpersonating}>
              <input type="hidden" name="vendorId" value={vendor.id} />
              <Button type="submit">View her portal</Button>
            </form>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Designs" value={summary?.design_count ?? 0} />
        <Stat label="To reorder" value={summary?.reorder_count ?? 0} />
        <Stat label="Open orders" value={summary?.open_order_count ?? 0} />
        <Stat
          label="Last order"
          value={summary?.last_order_at ? format(new Date(summary.last_order_at), 'd MMM') : '—'}
        />
      </div>

      <Card className="space-y-3">
        <div>
          <h2 className="text-base font-medium text-stone-900">Portal language</h2>
          <p className="text-sm text-stone-500">
            Her portal opens in this language from her first sign-in. She can change it herself
            from her own header; that choice then overrides this one for her login only.
          </p>
        </div>

        <form action={setVendorLocale} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="vendorId" value={vendor.id} />
          <div className="min-w-48 flex-1">
            <Field label="Language">
              <Select name="default_locale" defaultValue={vendor.default_locale}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_NAMES[l]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit">Save</Button>
        </form>
      </Card>

      <CredentialPanel vendorId={vendor.id} vendorCode={vendor.code} logins={logins} />

      {(viewedRows ?? []).length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-base font-medium text-stone-900">Recently viewed as this vendor</h2>
          <ul className="space-y-1 text-sm text-stone-600">
            {(viewedRows ?? []).map((row, i) => {
              const raw = row.app_users as { full_name: string } | { full_name: string }[] | null
              const who = Array.isArray(raw) ? raw[0] : raw
              return (
                <li key={i}>
                  {who?.full_name ?? 'Someone'} ·{' '}
                  {format(new Date(row.started_at as string), 'd MMM yyyy, HH:mm')}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <Card className="space-y-1 text-sm text-stone-600">
        <p>
          Status <StatusBadge status={vendor.status} />
        </p>
        <p>Usual lead time: {vendor.default_lead_time_days} days</p>
        {vendor.primary_phone && <p>Phone: {vendor.primary_phone}</p>}
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-stone-200 px-3 py-2.5">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="text-lg font-medium tabular-nums text-stone-900">
        {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </p>
    </div>
  )
}

export { toDisplayUserId }

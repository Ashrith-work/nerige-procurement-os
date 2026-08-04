import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireUser, canManageVendors } from '@/lib/auth/session'
import { Card, StatusBadge, Alert } from '@/components/ui/primitives'
import { GST_STATE_CODES, MSME_MAX_PAYMENT_DAYS } from '@/lib/validation/india'

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{value ?? <span className="text-stone-400">—</span>}</dd>
    </div>
  )
}

export default async function VendorDetailPage({
  params,
}: {
  // Next.js 16: params is async.
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()
  const supabase = await createClient()

  // No explicit vendor_id filter needed — RLS scopes this. An internal user
  // sees any vendor; a vendor user would see only themselves.
  const { data: vendor } = await supabase
    .from('vendors')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!vendor) notFound()

  const [{ data: banks }, { data: contacts }, { data: addresses }, { data: docs }] =
    await Promise.all([
      supabase
        .from('vendor_bank_accounts')
        .select('id, account_holder_name, account_number, ifsc, bank_name, is_active, verified_at')
        .eq('vendor_id', id)
        .is('deleted_at', null),
      supabase
        .from('vendor_contacts')
        .select('id, name, designation, phone, email, purposes, is_primary')
        .eq('vendor_id', id)
        .is('deleted_at', null),
      supabase
        .from('vendor_addresses')
        .select('id, kind, line1, line2, city, state, state_code, pincode, is_primary')
        .eq('vendor_id', id)
        .is('deleted_at', null),
      supabase
        .from('documents')
        .select('id, kind, file_name, created_at')
        .eq('vendor_id', id)
        .is('deleted_at', null),
    ])

  const isMsme = vendor.msme_category === 'micro' || vendor.msme_category === 'small'
  const activeBank = banks?.find((b) => b.is_active)

  // KYC completeness drives activation. Listed explicitly so the Procurement
  // Head can see exactly what is missing rather than guessing why the vendor
  // cannot be activated.
  const kyc = [
    { label: 'GSTIN recorded', done: Boolean(vendor.gstin) || vendor.gst_registration_type !== 'regular' },
    { label: 'PAN recorded', done: Boolean(vendor.pan) },
    { label: 'Registered address', done: (addresses?.length ?? 0) > 0 },
    { label: 'Active bank account', done: Boolean(activeBank) },
    { label: 'Bank account verified', done: Boolean(activeBank?.verified_at) },
    { label: 'Documents uploaded', done: (docs?.length ?? 0) > 0 },
  ]
  const outstanding = kyc.filter((k) => !k.done)

  return (
    <div className="space-y-5">
      <div>
        <Link href="/vendors" className="text-sm text-stone-500 hover:underline">
          ← Vendors
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{vendor.display_name}</h1>
          <StatusBadge status={vendor.status} />
          <span className="font-mono text-xs text-stone-500">{vendor.code}</span>
        </div>
        <p className="mt-0.5 text-sm text-stone-500">{vendor.legal_name}</p>
      </div>

      {isMsme && (
        <Alert tone="info">
          <strong>MSME supplier ({vendor.msme_category}).</strong> Invoices must be settled within{' '}
          {MSME_MAX_PAYMENT_DAYS} days of acceptance — Income Tax Act s.43B(h). Ageing alerts arrive
          with invoice tracking in M6.
        </Alert>
      )}

      {vendor.status === 'pending_kyc' && outstanding.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <h2 className="text-sm font-semibold text-amber-900">
            KYC incomplete — this vendor cannot receive a purchase order
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            {kyc.map((k) => (
              <li key={k.label} className="flex items-center gap-2">
                <span aria-hidden>{k.done ? '✓' : '○'}</span>
                <span className={k.done ? 'line-through opacity-60' : ''}>{k.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold">Tax &amp; statutory</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Detail label="GST type" value={vendor.gst_registration_type} />
            <Detail
              label="GSTIN"
              value={vendor.gstin ? <span className="font-mono">{vendor.gstin}</span> : null}
            />
            <Detail label="PAN" value={vendor.pan ? <span className="font-mono">{vendor.pan}</span> : null} />
            <Detail
              label="Place of supply"
              value={vendor.state_code ? GST_STATE_CODES[vendor.state_code] : null}
            />
            <Detail label="MSME" value={vendor.msme_category.replace(/_/g, ' ')} />
            <Detail label="Udyam" value={vendor.udyam_number} />
          </dl>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold">Commercial</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Detail label="Payment terms" value={`${vendor.payment_terms_days} days`} />
            <Detail label="Expected lead time" value={`${vendor.default_lead_time_days} days`} />
            <Detail label="Contact" value={vendor.primary_contact_name} />
            <Detail label="Mobile" value={vendor.primary_phone} />
            <Detail label="Email" value={vendor.primary_email} />
          </dl>
          {vendor.notes && (
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{vendor.notes}</p>
            </div>
          )}
        </Card>

        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Bank account</h2>
          {activeBank ? (
            <dl className="grid grid-cols-2 gap-4">
              <Detail label="Holder" value={activeBank.account_holder_name} />
              <Detail label="Bank" value={activeBank.bank_name} />
              <Detail
                label="Account"
                value={
                  // Last four only. Whoever needs the full number has the
                  // cancelled cheque; a detail page open on a shared screen
                  // should not expose payout details.
                  <span className="font-mono">••••{activeBank.account_number.slice(-4)}</span>
                }
              />
              <Detail label="IFSC" value={<span className="font-mono">{activeBank.ifsc}</span>} />
              <Detail
                label="Verified"
                value={
                  activeBank.verified_at ? (
                    new Date(activeBank.verified_at).toLocaleDateString('en-IN')
                  ) : (
                    <span className="font-medium text-amber-700">Not verified</span>
                  )
                }
              />
            </dl>
          ) : (
            <p className="text-sm text-stone-500">No bank account on record.</p>
          )}
        </Card>

        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Contacts &amp; addresses</h2>
          {(contacts?.length ?? 0) === 0 && (addresses?.length ?? 0) === 0 ? (
            <p className="text-sm text-stone-500">Nothing on record yet.</p>
          ) : (
            <div className="space-y-3 text-sm">
              {contacts?.map((c) => (
                <div key={c.id}>
                  <p className="font-medium">
                    {c.name} {c.is_primary && <span className="text-xs text-stone-500">· primary</span>}
                  </p>
                  <p className="text-stone-500">
                    {[c.designation, c.phone, c.email].filter(Boolean).join(' · ')}
                  </p>
                </div>
              ))}
              {addresses?.map((a) => (
                <div key={a.id}>
                  <p className="text-xs uppercase tracking-wide text-stone-500">{a.kind}</p>
                  <p>
                    {[a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {canManageVendors(user.role) && (
        <p className="text-xs text-stone-500">
          Bank details, contacts, addresses and document upload are managed here from M1&nbsp;+. Every
          change is recorded in the audit trail with your name against it.
        </p>
      )}
    </div>
  )
}

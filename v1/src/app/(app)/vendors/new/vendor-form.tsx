'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { createVendor, type VendorFormState } from '../actions'
import { Button, Input, Select, Field, Card, Alert } from '@/components/ui/primitives'
import { MSME_MAX_PAYMENT_DAYS } from '@/lib/validation/india'

const INITIAL: VendorFormState = { status: 'idle' }

export function VendorForm() {
  const [state, action, pending] = useActionState(createVendor, INITIAL)

  // Mirrored client-side so the form can react before submission — the
  // authoritative checks still run on the server and in the database.
  const [gstType, setGstType] = useState('regular')
  const [msme, setMsme] = useState('not_registered')

  const isMsme = msme === 'micro' || msme === 'small'
  const err = state.fieldErrors ?? {}

  return (
    <form action={action} className="space-y-5">
      {state.status === 'error' && state.message && <Alert tone="error">{state.message}</Alert>}

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-900">Identity</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Vendor code"
            required
            error={err.code}
            hint="Short code used on POs and in SKU prefixes, e.g. SHAN, ILKAL."
          >
            <Input name="code" required maxLength={16} placeholder="SHAN" className="font-mono uppercase" />
          </Field>
          <Field label="Display name" required error={err.display_name} hint="What the team calls them.">
            <Input name="display_name" required maxLength={120} placeholder="Shantiniketan Handlooms" />
          </Field>
        </div>
        <Field
          label="Legal name"
          required
          error={err.legal_name}
          hint="Exactly as printed on the GST certificate — this appears on the PO."
        >
          <Input name="legal_name" required maxLength={200} />
        </Field>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-900">Tax registration</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="GST registration" required>
            <Select
              name="gst_registration_type"
              value={gstType}
              onChange={(e) => setGstType(e.target.value)}
            >
              <option value="regular">Regular</option>
              <option value="composition">Composition</option>
              <option value="unregistered">Unregistered</option>
              <option value="exempt">Exempt</option>
            </Select>
          </Field>
          <Field
            label="GSTIN"
            required={gstType === 'regular'}
            error={err.gstin}
            hint="15 characters. The checksum is verified, so a typo is caught here."
          >
            <Input
              name="gstin"
              maxLength={15}
              required={gstType === 'regular'}
              placeholder="29AABCU9603R1ZJ"
              className="font-mono uppercase"
            />
          </Field>
        </div>
        <Field
          label="PAN"
          error={err.pan}
          hint="Optional — derived from the GSTIN when left blank."
        >
          <Input name="pan" maxLength={10} placeholder="AABCU9603R" className="font-mono uppercase" />
        </Field>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-900">MSME status &amp; terms</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="MSME category"
            error={err.msme_category}
            hint="Ask for the Udyam certificate. This has legal consequences."
          >
            <Select name="msme_category" value={msme} onChange={(e) => setMsme(e.target.value)}>
              <option value="not_registered">Not registered</option>
              <option value="micro">Micro</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
            </Select>
          </Field>
          <Field
            label="Udyam number"
            required={msme !== 'not_registered'}
            error={err.udyam_number}
          >
            <Input
              name="udyam_number"
              placeholder="UDYAM-KA-03-1234567"
              required={msme !== 'not_registered'}
              className="font-mono uppercase"
            />
          </Field>
        </div>

        {isMsme && (
          <Alert tone="info">
            <strong>Micro and small suppliers must be paid within {MSME_MAX_PAYMENT_DAYS} days.</strong>{' '}
            Under Income Tax Act s.43B(h), paying later means the expense is disallowed for that
            financial year. Payment terms are capped accordingly.
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Payment terms (days)"
            required
            error={err.payment_terms_days}
            hint={isMsme ? `Capped at ${MSME_MAX_PAYMENT_DAYS} for MSME suppliers.` : 'Agreed credit period.'}
          >
            <Input
              name="payment_terms_days"
              type="number"
              inputMode="numeric"
              min={0}
              max={isMsme ? MSME_MAX_PAYMENT_DAYS : 180}
              defaultValue={30}
              required
            />
          </Field>
          <Field
            label="Expected lead time (days)"
            required
            error={err.default_lead_time_days}
            hint="A starting estimate. Replaced by observed data once receipts flow in."
          >
            <Input
              name="default_lead_time_days"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              defaultValue={21}
              required
            />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-900">Primary contact</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name" error={err.primary_contact_name}>
            <Input name="primary_contact_name" maxLength={120} />
          </Field>
          <Field
            label="Mobile"
            error={err.primary_phone}
            hint="Any format. This becomes their sign-in number."
          >
            <Input name="primary_phone" type="tel" inputMode="tel" placeholder="98765 43210" />
          </Field>
        </div>
        <Field label="Email" error={err.primary_email}>
          <Input name="primary_email" type="email" />
        </Field>
        <Field label="Notes" hint="Anything the team should know — collections supplied, quirks, history.">
          <textarea
            name="notes"
            rows={3}
            maxLength={2000}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
          />
        </Field>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Create vendor'}
        </Button>
        <Link href="/vendors">
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
      </div>

      <p className="text-xs text-stone-500">
        New vendors are created as <strong>pending KYC</strong>. Upload the GST certificate, PAN and
        a cancelled cheque, then activate — a vendor cannot receive a purchase order until then.
      </p>
    </form>
  )
}

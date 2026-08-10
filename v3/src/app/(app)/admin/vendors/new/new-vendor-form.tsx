'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { LOCALES, LOCALE_NAMES } from '@/lib/i18n'
import { Button, Card, Field, Input, Select, Alert } from '@/components/ui/primitives'
import { CredentialCard } from '@/components/admin/credential-card'
import { createVendor, type CredentialResult } from '../credential-actions'

const IDLE: CredentialResult = { status: 'idle' }

/**
 * Five fields, and the code is the one that matters.
 *
 * `code` is not a label. It is the SKU prefix, and it is the entire basis of
 * vendor isolation in this system — `PGW-BRHM-SLK-CRM-5855` belongs to PGW
 * because the string says so, and there is no product-to-vendor mapping table
 * anywhere. Getting it wrong does not mis-name a weaver; it makes her catalogue
 * empty forever, because no SKU will ever start with what was typed.
 *
 * Hence the hint, and hence uppercase-on-the-way-in rather than a validation
 * error after the fact.
 */
export function NewVendorForm() {
  const [state, action, pending] = useActionState(createVendor, IDLE)

  if (state.credential) {
    return (
      <div className="space-y-4">
        <CredentialCard credential={state.credential} />
        <div className="no-print flex gap-2">
          <Link href={`/admin/vendors/${encodeURIComponent(state.credential.vendorCode)}`}>
            <Button variant="secondary">Open this vendor</Button>
          </Link>
          <Link href="/admin/vendors/new">
            <Button variant="ghost">Add another</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <form action={action} className="space-y-4">
        {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}

        <Field
          label="Vendor code"
          required
          hint="The SKU prefix, exactly as it appears in her codes — PGW in PGW-BRHM-SLK-CRM-5855. Her whole catalogue is found by this string."
        >
          <Input
            name="code"
            required
            autoCapitalize="characters"
            className="font-mono uppercase"
            placeholder="PGW"
          />
        </Field>

        <Field label="Display name" required hint="What Nerige calls her.">
          <Input name="display_name" required placeholder="Pranav Gadwal" />
        </Field>

        <Field
          label="WhatsApp number"
          hint="With country code, e.g. +919876543210. Orders are sent here."
        >
          <Input name="whatsapp_number" type="tel" placeholder="+919876543210" />
        </Field>

        <Field
          label="Portal language"
          required
          hint="Her portal opens in this from her first sign-in."
        >
          <Select name="default_locale" defaultValue="en">
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Login ID"
          required
          hint="A short handle she types to sign in. No email address needed."
        >
          <Input name="login_id" required className="font-mono" placeholder="pgw" />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create vendor and login'}
        </Button>
      </form>
    </Card>
  )
}

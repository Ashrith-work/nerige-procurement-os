import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { isDemoMode, demoVendors, demoVendor, demoBank } from '@/lib/demo'

/**
 * Vendor reads, in one place.
 *
 * Introduced so pages do not each carry an `if (demo)` branch — but it earns
 * its place beyond demo mode. When M2 adds Shopify-sourced fields and M7 adds
 * scorecard aggregates, the shape of a "vendor for the list screen" will change
 * in exactly one file rather than in every screen that renders one.
 *
 * Note there is no vendor_id filtering here. That is not an oversight: RLS
 * scopes these queries in the database. Filtering in application code as well
 * would imply the database guarantee is not trusted, and the moment anyone
 * believes that, someone starts reaching for the service-role key.
 */

export interface VendorListRow {
  id: string
  code: string
  display_name: string
  status: string
  gstin: string | null
  msme_category: string
  payment_terms_days: number
  default_lead_time_days: number
  primary_phone: string | null
}

const LIST_COLUMNS =
  'id, code, display_name, status, gstin, msme_category, payment_terms_days, default_lead_time_days, primary_phone'

export async function listVendors(filters: { q?: string; status?: string } = {}): Promise<{
  vendors: VendorListRow[]
  error: string | null
}> {
  if (isDemoMode()) {
    return { vendors: demoVendors(filters), error: null }
  }

  const supabase = await createClient()
  let query = supabase
    .from('vendors')
    .select(LIST_COLUMNS)
    .is('deleted_at', null)
    .order('display_name')

  // Trigram index backs the name search; code is exact-prefix.
  if (filters.q) {
    query = query.or(`display_name.ilike.%${filters.q}%,code.ilike.${filters.q}%`)
  }
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query
  return { vendors: (data as VendorListRow[]) ?? [], error: error?.message ?? null }
}

export async function getVendor(id: string) {
  if (isDemoMode()) {
    const vendor = demoVendor(id)
    if (!vendor) return null
    return {
      vendor,
      bank: demoBank(id),
      contacts: vendor.primary_contact_name
        ? [
            {
              id: `c-${id}`,
              name: vendor.primary_contact_name,
              designation: null,
              phone: vendor.primary_phone,
              email: vendor.primary_email,
              is_primary: true,
            },
          ]
        : [],
      addresses: [],
      documents: [],
    }
  }

  const supabase = await createClient()
  const { data: vendor } = await supabase
    .from('vendors')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!vendor) return null

  const [banks, contacts, addresses, documents] = await Promise.all([
    supabase
      .from('vendor_bank_accounts')
      .select('id, account_holder_name, account_number, ifsc, bank_name, is_active, verified_at')
      .eq('vendor_id', id)
      .is('deleted_at', null),
    supabase
      .from('vendor_contacts')
      .select('id, name, designation, phone, email, is_primary')
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

  return {
    vendor,
    bank: banks.data?.find((b) => b.is_active) ?? null,
    contacts: contacts.data ?? [],
    addresses: addresses.data ?? [],
    documents: documents.data ?? [],
  }
}

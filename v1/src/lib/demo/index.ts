import 'server-only'
import type { SessionUser } from '@/lib/auth/session'

/**
 * DEMO MODE — local evaluation only.
 *
 * Lets the application be explored before a Supabase project exists, with
 * realistic seed data and a fake session. It exists because "I want to see the
 * screens" is a legitimate need that should not require provisioning cloud
 * infrastructure first.
 *
 * THREE INDEPENDENT SAFETY GATES, because this bypasses authentication and the
 * repository is public:
 *
 *   1. Hard-off whenever NODE_ENV === 'production'. Not configurable, not
 *      overridable — a stray DEMO_MODE=1 in a Vercel environment variable
 *      cannot switch it on.
 *   2. Off unless DEMO_MODE=1 is explicitly set.
 *   3. Every screen renders a visible banner, so nobody can mistake demo data
 *      for real procurement data.
 *
 * The data below never touches the database. Real Supabase queries continue to
 * run under RLS exactly as before — demo mode does not weaken them, it simply
 * is not consulted when disabled.
 */
export function isDemoMode(): boolean {
  // Gate 1 first and unconditionally: production can never enter demo mode.
  if (process.env.NODE_ENV === 'production') return false
  return process.env.DEMO_MODE === '1'
}

/** Thrown rather than silently returning data if a caller mis-guards. */
function assertDemo() {
  if (!isDemoMode()) throw new Error('Demo data requested while demo mode is disabled')
}

export const DEMO_USER: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'founder',
  fullName: 'Demo Admin',
  email: 'demo@nerigestory.test',
  phone: null,
  locale: 'en',
  vendorId: null,
  vendorName: null,
}

export interface DemoVendor {
  id: string
  code: string
  legal_name: string
  display_name: string
  status: string
  gst_registration_type: string
  gstin: string | null
  pan: string | null
  state_code: string | null
  msme_category: string
  udyam_number: string | null
  payment_terms_days: number
  default_lead_time_days: number
  primary_contact_name: string | null
  primary_phone: string | null
  primary_email: string | null
  notes: string | null
  created_at: string
}

/**
 * Seed vendors modelled on the real catalogue — Ilkal, Chettinad, Narayanpet
 * and Banarasi weaves, with the mix of statuses a live vendor master actually
 * has. One MSME supplier is included deliberately so the 45-day s.43B(h)
 * warning is visible rather than theoretical.
 */
const VENDORS: DemoVendor[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    code: 'SHAN',
    legal_name: 'Shantiniketan Handlooms Private Limited',
    display_name: 'Shantiniketan Handlooms',
    status: 'active',
    gst_registration_type: 'regular',
    gstin: '29AABCU9603R1ZJ',
    pan: 'AABCU9603R',
    state_code: '29',
    msme_category: 'small',
    udyam_number: 'UDYAM-KA-03-1234567',
    payment_terms_days: 45,
    default_lead_time_days: 21,
    primary_contact_name: 'Ravi Kumar',
    primary_phone: '+919845012345',
    primary_email: 'ravi@shantiniketan.test',
    notes: 'Supplies semi-Banarasi and soft silk. Reliable, but slows down around festival season.',
    created_at: '2026-05-12T09:00:00Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    code: 'ILKAL',
    legal_name: 'Ilkal Weavers Co-operative Society',
    display_name: 'Ilkal Weavers Co-op',
    status: 'active',
    gst_registration_type: 'regular',
    gstin: '29AAGCB7383J1Z4',
    pan: 'AAGCB7383J',
    state_code: '29',
    msme_category: 'micro',
    udyam_number: 'UDYAM-KA-07-7654321',
    payment_terms_days: 30,
    default_lead_time_days: 35,
    primary_contact_name: 'Shobha Patil',
    primary_phone: '+919886054321',
    primary_email: null,
    notes: 'Co-operative of 40+ weavers. Long lead times — plan Ilkal restocks a month ahead.',
    created_at: '2026-05-20T09:00:00Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    code: 'CHET',
    legal_name: 'Chettinad Cotton Traders',
    display_name: 'Chettinad Cotton Traders',
    status: 'pending_kyc',
    gst_registration_type: 'regular',
    gstin: '33AAPFU0939F1ZV',
    pan: 'AAPFU0939F',
    state_code: '33',
    msme_category: 'not_registered',
    udyam_number: null,
    payment_terms_days: 30,
    default_lead_time_days: 18,
    primary_contact_name: 'Murugan S',
    primary_phone: '+919840098765',
    primary_email: 'murugan@chettinadcotton.test',
    notes: 'New vendor. Awaiting cancelled cheque and bank verification.',
    created_at: '2026-07-28T09:00:00Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    code: 'NARPET',
    legal_name: 'Narayanpet Silks & Cottons',
    display_name: 'Narayanpet Silks',
    status: 'on_hold',
    gst_registration_type: 'regular',
    gstin: '36AABCU9603R1ZG',
    pan: 'AABCU9603R',
    state_code: '36',
    msme_category: 'not_registered',
    udyam_number: null,
    payment_terms_days: 45,
    default_lead_time_days: 28,
    primary_contact_name: 'Anil Reddy',
    primary_phone: '+919701023456',
    primary_email: null,
    notes: 'On hold — three consecutive shipments arrived with colour variance against sample.',
    created_at: '2026-04-02T09:00:00Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    code: 'VINT',
    legal_name: 'Heritage Vintage Textiles',
    display_name: 'Heritage Vintage',
    status: 'active',
    gst_registration_type: 'unregistered',
    gstin: null,
    pan: 'BXZPK1234M',
    state_code: null,
    msme_category: 'not_registered',
    udyam_number: null,
    payment_terms_days: 7,
    default_lead_time_days: 5,
    primary_contact_name: 'Meera Joshi',
    primary_phone: '+919820011223',
    primary_email: null,
    notes: 'Sources one-off vintage pieces. Buys are opportunistic and lot-based — not reorderable.',
    created_at: '2026-06-15T09:00:00Z',
  },
]

export function demoVendors(filters?: { q?: string; status?: string }): DemoVendor[] {
  assertDemo()
  let rows = [...VENDORS]

  if (filters?.q) {
    const q = filters.q.toLowerCase()
    rows = rows.filter(
      (v) => v.display_name.toLowerCase().includes(q) || v.code.toLowerCase().startsWith(q),
    )
  }
  if (filters?.status) rows = rows.filter((v) => v.status === filters.status)

  return rows.sort((a, b) => a.display_name.localeCompare(b.display_name))
}

export function demoVendor(id: string): DemoVendor | null {
  assertDemo()
  return VENDORS.find((v) => v.id === id) ?? null
}

export interface DemoBank {
  id: string
  account_holder_name: string
  account_number: string
  ifsc: string
  bank_name: string
  is_active: boolean
  verified_at: string | null
}

export function demoBank(vendorId: string): DemoBank | null {
  assertDemo()
  const vendor = demoVendor(vendorId)
  if (!vendor || vendor.status === 'pending_kyc') return null

  return {
    id: `bank-${vendorId}`,
    account_holder_name: vendor.legal_name,
    account_number: '502010012345678',
    ifsc: 'HDFC0001234',
    bank_name: 'HDFC Bank',
    is_active: true,
    // Narayanpet is deliberately left unverified so the warning state is visible.
    verified_at: vendor.code === 'NARPET' ? null : '2026-06-01T09:00:00Z',
  }
}

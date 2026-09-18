import { requireProcurement } from '@/lib/auth/session'
import { LOCALE_NAMES } from '@/lib/i18n'
import { getDictionary } from '@/lib/i18n'
import { PageHeader, Card } from '@/components/ui/primitives'
import { LanguagePicker } from '@/components/language-picker'
import { toDisplayUserId } from '@/lib/auth/user-id'

export const metadata = { title: 'My profile' }

/**
 * What each role is called to the person holding it. The page used to say
 * "Procurement head" to everybody, including the owner.
 */
const ROLE_NAMES: Record<string, string> = {
  admin: 'Owner — everything',
  procurement_head: 'Procurement head',
  warehouse_manager: 'Warehouse manager',
  customer_support: 'Answering questions',
}

export default async function AdminProfilePage() {
  const user = await requireProcurement()
  const t = getDictionary(user.locale)

  return (
    <div className="max-w-xl space-y-5">
      <PageHeader title="My profile" subtitle={user.fullName} />

      <Card className="space-y-3">
        <Row label="Name" value={user.fullName} />
        <Row label="Your login" value={toDisplayUserId(user.email) ?? '—'} mono />
        <Row label="What you can do" value={ROLE_NAMES[user.role] ?? user.role} />
        <Row label="Language" value={LOCALE_NAMES[user.locale]} />

        <div className="flex items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <div>
            <p className="text-sm font-medium text-stone-700">Change my language</p>
            <p className="text-xs text-stone-500">
              Affects only your own screens. A weaver&rsquo;s language is set on her vendor.
            </p>
          </div>
          <LanguagePicker current={user.locale} label={t.common.language} />
        </div>
      </Card>

      <Card className="space-y-1 text-sm text-stone-600">
        <p className="font-medium text-stone-900">Changing your password</p>
        <p>
          Passwords here are issued by hand, never reset by email — there is no reset link, by
          design, because the weavers&rsquo; addresses cannot receive mail. Ask an owner to issue
          you a new one; they will give it to you once and it will not be shown again.
        </p>
      </Card>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-stone-500">{label}</span>
      <span className={`text-sm text-stone-900 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

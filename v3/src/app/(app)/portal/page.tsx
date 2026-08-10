import Link from 'next/link'
import { format } from 'date-fns'
import { requireVendor } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getDictionary, interpolate, formatCount, type Dictionary, type Locale } from '@/lib/i18n'
import { PageHeader } from '@/components/ui/primitives'
import { TutorialCard, type TutorialVideo } from '@/components/tutorial-card'

export const metadata = { title: 'My orders · Nerige' }

interface OrderRow {
  id: string
  order_number: string
  status: string
  issued_at: string
  promised_date: string | null
  dispatched_at: string | null
  order_lines: { count: number }[]
}

/**
 * Vendor home. Her orders, grouped by what needs her, and nothing else.
 *
 * Three groups in the order the work happens: what she has not answered yet,
 * what she is weaving, what has gone. No counts of anything, no catalogue
 * summary, no chrome — a weaver opens this to answer one question, and every
 * extra thing on the screen is a delay in answering it.
 *
 * The vendor filter is stated rather than left to `orders_select_own`. For a
 * weaver the policy already decides it; for Pooja viewing this portal as a
 * weaver it does not, because she is still an admin and
 * `orders_select_internal` returns every vendor's orders.
 */
export default async function PortalHome() {
  const user = await requireVendor()
  const t = getDictionary(user.locale)
  const supabase = await createClient()

  const [{ data }, video] = await Promise.all([
    supabase
      .from('orders')
      .select(
        'id, order_number, status, issued_at, promised_date, dispatched_at, order_lines(count)',
      )
      .eq('vendor_id', user.vendorId)
      .order('issued_at', { ascending: false }),
    tutorialFor(supabase, user.locale),
  ])

  const orders = (data ?? []) as unknown as OrderRow[]

  // Cancelled orders are not in any of the three groups: a cancelled order
  // needs nothing from her. It still opens at its own URL and says so.
  const toAccept = orders.filter((o) => o.status === 'issued')
  const inProgress = orders.filter((o) => o.status === 'accepted')
  const sent = orders.filter((o) => o.status === 'dispatched' || o.status === 'received')

  const nothing = toAccept.length + inProgress.length + sent.length === 0

  return (
    <div className="mx-auto max-w-md space-y-8">
      <PageHeader title={user.vendorName ?? t.nav.myOrders} subtitle={user.vendorCode ?? undefined} />

      {/* Above the orders, every visit. A weaver who does not yet know what the
          code under the photograph is for will not scroll past her orders to
          find out. */}
      <TutorialCard video={video} t={t} />

      {nothing && <p className="text-sm text-stone-500">{t.portal.nothingYet}</p>}

      <Group
        title={t.portal.toAccept}
        help={t.portal.toAcceptHelp}
        orders={toAccept}
        t={t}
        locale={user.locale}
      />
      <Group
        title={t.portal.inProgress}
        help={t.portal.inProgressHelp}
        orders={inProgress}
        t={t}
        locale={user.locale}
      />
      <Group title={t.portal.sent} orders={sent} t={t} locale={user.locale} />
    </div>
  )
}

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * Her language, or English.
 *
 * Two queries rather than one `in ('kn','en')` because the fallback has to be
 * unambiguous: with both rows in one result set, "the first row" depends on
 * whatever order Postgres felt like returning, and she would get English on
 * some page loads and Kannada on others.
 */
async function tutorialFor(supabase: Supabase, locale: Locale): Promise<TutorialVideo | null> {
  const pick = async (l: string) => {
    const { data } = await supabase
      .from('tutorial_videos')
      .select('youtube_url, title, caption')
      .eq('locale', l)
      .eq('is_active', true)
      .maybeSingle()
    return (data as TutorialVideo | null) ?? null
  }

  if (locale === 'en') return pick('en')
  return (await pick(locale)) ?? (await pick('en'))
}

/** Renders nothing at all when empty. A screen of empty headings reads as broken. */
function Group({
  title,
  help,
  orders,
  t,
  locale,
}: {
  title: string
  help?: string
  orders: OrderRow[]
  t: Dictionary
  locale: Locale
}) {
  if (orders.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-base font-medium text-stone-900">
          {title} <span className="text-stone-400">({formatCount(orders.length, locale)})</span>
        </h2>
        {help && <p className="text-sm text-stone-500">{help}</p>}
      </div>

      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id}>
            <Link
              href={`/portal/orders/${o.id}`}
              className="block rounded-xl border border-stone-200 p-4 hover:border-stone-300"
            >
              <p className="font-mono text-base text-stone-900">{o.order_number}</p>
              <p className="mt-0.5 text-sm text-stone-500">
                {interpolate(t.portal.linesInOrder, {
                  n: formatCount(o.order_lines?.[0]?.count ?? 0, locale),
                })}
                {o.promised_date && (
                  <>
                    {' · '}
                    {t.portal.promisedBy} {format(new Date(o.promised_date), 'd MMM')}
                  </>
                )}
                {o.dispatched_at && (
                  <>
                    {' · '}
                    {t.portal.sentOn} {format(new Date(o.dispatched_at), 'd MMM')}
                  </>
                )}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

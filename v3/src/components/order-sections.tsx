import type { RestockLine, NewDesignLine, VendorOrder } from '@/lib/orders/view'
import { formatPieces, type Dictionary, type Locale } from '@/lib/i18n'
import { DesignCard, NextPhoto, type PhotoComponent } from '@/components/design-card'
import { SalesBadges } from '@/components/sales-badges'
import type { Tier } from '@/lib/reorder/sort'

/**
 * The order screen's two kinds of card.
 *
 * A restock card IS a design card — same photograph, same code, same words —
 * with the quantity wanted beneath. A new-design card is a different animal
 * entirely, because there is no design yet and no code to show.
 *
 * Both are pure: they take a view model and render it. Nothing here queries
 * anything, which is what lets the screen be rendered and looked at outside a
 * browser — see scripts/preview-order.tsx.
 */

/** How many, said plainly. The only number on this screen she acts on. */
function Quantity({ n, t, locale }: { n: number; t: Dictionary; locale: Locale }) {
  return (
    <p className="text-[17px] font-medium tabular-nums text-stone-900">
      {formatPieces(t, n, locale)}
    </p>
  )
}

export function RestockCard({
  line,
  t,
  locale = 'en',
  Photo = NextPhoto,
}: {
  line: RestockLine
  t: Dictionary
  locale?: Locale
  Photo?: PhotoComponent
}) {
  return (
    <DesignCard
      sku={line.sku}
      title={line.title}
      imageUrl={line.imageUrl}
      Photo={Photo}
      footer={<Quantity n={line.quantity} t={t} locale={locale} />}
      // Live rather than snapshotted, on purpose — see RestockLine.unitsSold.
      // Below the quantity, quiet: nothing on this card may compete with the
      // code she is about to write on the fabric.
      badges={
        <SalesBadges
          units={line.unitsSold ?? 0}
          tier={(line.tier as Tier | null) ?? null}
          window={90}
          t={t}
          locale={locale}
        />
      }
    />
  )
}

export function NewDesignCard({
  line,
  t,
  locale = 'en',
  Photo = NextPhoto,
}: {
  line: NewDesignLine
  t: Dictionary
  locale?: Locale
  Photo?: PhotoComponent
}) {
  return (
    <article className="space-y-4 break-inside-avoid rounded-xl border border-stone-200 p-4">
      {/* Pooja's words come first and largest. On this card they are the brief;
          there is no code to lead with. */}
      <p className="text-lg leading-snug text-stone-900">{line.brief}</p>

      {line.references.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-stone-500">{t.order.referencePhotos}</p>
          {/* A strip, not a grid: one to six photographs, scrolled sideways
              inside the card so the card itself never scrolls. */}
          <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
            {line.references.map((ref) => (
              <li key={ref.sku} className="shrink-0 snap-start">
                <Photo url={ref.imageUrl} alt={ref.sku} className="h-[150px] w-[115px]" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* In place of a code. The single most important sentence on this card:
          it tells her not to go looking for one. */}
      <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">{t.order.noCode}</p>

      <Quantity n={line.quantity} t={t} locale={locale} />
    </article>
  )
}

function SectionHeading({ title, help }: { title: string; help: string }) {
  return (
    <div className="space-y-0.5">
      <h2 className="text-base font-medium text-stone-900">{title}</h2>
      <p className="text-sm text-stone-500">{help}</p>
    </div>
  )
}

/**
 * Two headed sections, restock first, then new designs.
 *
 * The order matters and is not cosmetic: restock is what she can start on
 * today, because it names a saree she has made before.
 */
export function OrderSections({
  order,
  t,
  locale = 'en',
  Photo = NextPhoto,
}: {
  order: VendorOrder
  t: Dictionary
  locale?: Locale
  Photo?: PhotoComponent
}) {
  if (order.restock.length === 0 && order.newDesigns.length === 0) {
    return <p className="text-sm text-stone-500">{t.order.emptyOrder}</p>
  }

  return (
    <>
      {order.restock.length > 0 && (
        <section className="space-y-4">
          <SectionHeading title={t.order.sectionRestock} help={t.order.sectionRestockHelp} />
          {order.restock.map((line) => (
            <RestockCard key={line.id} line={line} t={t} locale={locale} Photo={Photo} />
          ))}
        </section>
      )}

      {order.newDesigns.length > 0 && (
        <section className="space-y-4">
          <SectionHeading title={t.order.sectionNewDesigns} help={t.order.sectionNewDesignsHelp} />
          {order.newDesigns.map((line) => (
            <NewDesignCard key={line.id} line={line} t={t} locale={locale} Photo={Photo} />
          ))}
        </section>
      )}
    </>
  )
}

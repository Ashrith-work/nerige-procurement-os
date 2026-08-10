'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSelection, type Selected } from '@/lib/reorder/selection'
import { shopifyImage } from '@/lib/orders/view'
import { issueOrders, type IssuedOrder } from '../actions'
import { Button, Textarea, Alert, EmptyState } from '@/components/ui/primitives'

/** A line Pooja has moved out of restock: a note plus one to six references. */
interface Draft {
  id: string
  vendorCode: string
  brief: string
  quantity: number
  refs: string[]
}

const MAX_REFS = 6

/**
 * The review step, and the last thing between a selection and three orders.
 *
 * Its whole job is the move: any tapped saree can stop being "make this again"
 * and become "make me more in this direction", which is a different line, a
 * different card on the weaver's phone, and a saree that comes back with no
 * code on it. That is one button here and a large consequence there, so the
 * screen shows both sections at once rather than hiding one behind a tab.
 *
 * A design is either being reordered or being used as a reference, never both —
 * moving one takes it out of restock, and removing it from the references puts
 * it back.
 */
export function Review() {
  const router = useRouter()
  const { items, ready, remove, clear } = useSelection()

  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<IssuedOrder[] | null>(null)
  const [whatsappNote, setWhatsappNote] = useState<string | null>(null)

  /**
   * Two channels, and the dashboard one is not a choice.
   *
   * Creating the order IS delivering it to her portal, so there is nothing to
   * opt into — the checkbox would be permanently ticked and disabled. WhatsApp
   * is the real decision, and it defaults on because a weaver who does not open
   * the portal for three days is the reason it exists.
   */
  const [alsoWhatsApp, setAlsoWhatsApp] = useState(true)

  const bySku = useMemo(() => new Map(items.map((i) => [i.sku, i])), [items])
  const usedAsRef = useMemo(() => new Set(drafts.flatMap((d) => d.refs)), [drafts])

  const vendors = useMemo(() => {
    const map = new Map<string, Selected[]>()
    for (const i of items) {
      if (usedAsRef.has(i.sku)) continue
      map.set(i.vendorCode, [...(map.get(i.vendorCode) ?? []), i])
    }
    // A weaver with every line moved into a new design still needs her heading.
    for (const d of drafts) if (!map.has(d.vendorCode)) map.set(d.vendorCode, [])
    return [...map].sort(([a], [b]) => a.localeCompare(b))
  }, [items, usedAsRef, drafts])

  const qty = (sku: string) => quantities[sku] ?? 1

  const moveToNewDesign = (item: Selected) => {
    setDrafts((prev) => [
      ...prev,
      {
        id: `${item.sku}-${prev.length}`,
        vendorCode: item.vendorCode,
        brief: '',
        quantity: qty(item.sku),
        refs: [item.sku],
      },
    ])
  }

  const attachRef = (draftId: string, sku: string) =>
    setDrafts((prev) =>
      prev.map((d) =>
        d.id === draftId && d.refs.length < MAX_REFS ? { ...d, refs: [...d.refs, sku] } : d,
      ),
    )

  const detachRef = (draftId: string, sku: string) =>
    setDrafts((prev) =>
      prev.flatMap((d) => {
        if (d.id !== draftId) return [d]
        const refs = d.refs.filter((r) => r !== sku)
        // The last reference gone means the line has nothing to point at.
        return refs.length === 0 ? [] : [{ ...d, refs }]
      }),
    )

  const submit = async () => {
    setPending(true)
    setError(null)

    const result = await issueOrders({
      restock: items
        .filter((i) => !usedAsRef.has(i.sku))
        .map((i) => ({ sku: i.sku, quantity: qty(i.sku) })),
      new_designs: drafts.map((d) => ({
        brief: d.brief.trim(),
        quantity: d.quantity,
        refs: d.refs,
      })),
      alsoWhatsApp,
    })

    setPending(false)

    if (result.status === 'error') {
      setError(result.message)
      return
    }

    setIssued(result.orders)
    setWhatsappNote(result.whatsapp ?? null)
    clear()
    router.refresh()
  }

  if (!ready) return null

  if (issued) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <Alert tone="success">
          {issued.length} {issued.length === 1 ? 'order' : 'orders'} issued, and in their portals.
        </Alert>

        {/* Reported separately, and not as a failure of the send. The orders
            exist and are in the portal regardless; WhatsApp is a second channel
            that can fail on its own — a wrong number, an unapproved template —
            without any of that being untrue. */}
        {whatsappNote && (
          <Alert tone={whatsappNote.includes(' of ') ? 'error' : 'success'}>{whatsappNote}</Alert>
        )}
        <ul className="space-y-2">
          {issued.map((o) => (
            <li key={o.order_id} className="rounded-xl border border-stone-200 p-4">
              <p className="font-mono text-base">{o.order_number}</p>
              <p className="text-sm text-stone-500">
                {o.vendor_name} · {o.lines} lines
              </p>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Link href="/orders">
            <Button>Go to orders</Button>
          </Link>
          <Link href="/reorder">
            <Button variant="secondary">Back to reorder</Button>
          </Link>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing selected"
        body="Choose a vendor and tap the sarees you want made again."
        action={
          <Link href="/reorder">
            <Button>Back to reorder</Button>
          </Link>
        }
      />
    )
  }

  const incomplete = drafts.some((d) => !d.brief.trim())

  return (
    <div className="space-y-8 pb-28">
      {vendors.map(([vendorCode, lines]) => {
        const vendorDrafts = drafts.filter((d) => d.vendorCode === vendorCode)

        return (
          <section key={vendorCode} className="space-y-4">
            <h2 className="text-base font-medium">
              {vendorCode}{' '}
              <span className="font-normal text-stone-400 tabular-nums">
                {lines.length + vendorDrafts.length} lines
              </span>
            </h2>

            {lines.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-stone-500">
                  Make these again — the weaver writes the same code on each piece.
                </p>
                <ul className="space-y-2">
                  {lines.map((item) => (
                    <li
                      key={item.sku}
                      className="flex items-center gap-3 rounded-xl border border-stone-200 p-2"
                    >
                      <Thumb item={item} />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm break-words">{item.sku}</p>
                        <p className="truncate text-xs text-stone-500">{item.title}</p>
                      </div>
                      <input
                        type="number"
                        min={1}
                        value={qty(item.sku)}
                        aria-label={`Quantity for ${item.sku}`}
                        onChange={(e) =>
                          setQuantities((p) => ({
                            ...p,
                            [item.sku]: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                        className="min-h-11 w-16 rounded-lg border border-stone-300 px-2 text-center text-base tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => moveToNewDesign(item)}
                        className="min-h-11 shrink-0 rounded-lg px-2 text-xs text-stone-600 underline underline-offset-2"
                      >
                        Make new
                        <br />
                        like this
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(item.sku)}
                        aria-label={`Remove ${item.sku}`}
                        className="min-h-11 shrink-0 px-2 text-stone-400 hover:text-stone-700"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {vendorDrafts.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-stone-500">
                  New designs — nothing here comes back with a code on it.
                </p>
                {vendorDrafts.map((d) => (
                  <div key={d.id} className="space-y-3 rounded-xl border border-stone-300 p-3">
                    <Textarea
                      rows={3}
                      value={d.brief}
                      placeholder="Make me more in this direction…"
                      aria-label="Note to the weaver"
                      onChange={(e) =>
                        setDrafts((p) =>
                          p.map((x) => (x.id === d.id ? { ...x, brief: e.target.value } : x)),
                        )
                      }
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      {d.refs.map((sku) => (
                        <span key={sku} className="relative">
                          <Thumb item={bySku.get(sku)} />
                          <button
                            type="button"
                            onClick={() => detachRef(d.id, sku)}
                            aria-label={`Remove reference ${sku}`}
                            className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-xs text-white"
                          >
                            ×
                          </button>
                        </span>
                      ))}

                      {d.refs.length < MAX_REFS && lines.length > 0 && (
                        <select
                          aria-label="Attach another reference"
                          value=""
                          onChange={(e) => e.target.value && attachRef(d.id, e.target.value)}
                          className="min-h-11 rounded-lg border border-dashed border-stone-300 px-2 text-sm"
                        >
                          <option value="">+ reference</option>
                          {lines.map((l) => (
                            <option key={l.sku} value={l.sku}>
                              {l.sku}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-sm text-stone-500" htmlFor={`q-${d.id}`}>
                        How many
                      </label>
                      <input
                        id={`q-${d.id}`}
                        type="number"
                        min={1}
                        value={d.quantity}
                        onChange={(e) =>
                          setDrafts((p) =>
                            p.map((x) =>
                              x.id === d.id
                                ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) }
                                : x,
                            ),
                          )
                        }
                        className="min-h-11 w-16 rounded-lg border border-stone-300 px-2 text-center text-base tabular-nums"
                      />
                      {!d.brief.trim() && (
                        <span className="text-xs text-red-600">A note is required</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}

      {error && <Alert tone="error">{error}</Alert>}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/reorder" className="text-sm text-stone-500 underline underline-offset-2">
            Back
          </Link>
          <span className="flex-1" />

          {/* The dashboard is not offered as a choice: creating the order is
              what puts it in her portal. WhatsApp is the decision. */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={alsoWhatsApp}
              onChange={(e) => setAlsoWhatsApp(e.target.checked)}
              className="h-4 w-4"
            />
            Also send on WhatsApp
          </label>

          <Button onClick={submit} disabled={pending || incomplete}>
            {pending
              ? 'Sending…'
              : `Send to ${vendors.length} ${vendors.length === 1 ? 'vendor' : 'vendors'}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Thumb({ item }: { item: Selected | undefined }) {
  const src = shopifyImage(item?.imageUrl ?? null, 400)
  return (
    <span className="relative block h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-stone-100">
      {src && (
        <Image src={src} alt={item?.sku ?? ''} fill sizes="44px" className="object-cover" />
      )}
    </span>
  )
}

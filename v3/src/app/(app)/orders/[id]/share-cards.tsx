'use client'

import { useState } from 'react'
import { skuTail } from '@/lib/po/share-card'

/**
 * The cards, ready to send.
 *
 * WHAT THIS REPLACES. Open Shopify, find the design, pick an image, screenshot
 * it, crop the screenshot, crop it again, copy it, send it — per design, every
 * time anything is ordered. It is the largest single consumer of Pooja's day.
 * Everything in that sequence is already known here: which photograph, which
 * part of it, which code, how many.
 *
 * WHY THUMBNAILS AND NOT JUST A BUTTON. The crop is per product and is
 * sometimes wrong — a design whose third image is the model rather than the
 * fabric produces a card of somebody's shoulder. Seeing the cards before they
 * go means that is caught here, where it costs a correction on the product,
 * rather than on the weaver's phone where it costs a wrong saree.
 *
 * DOWNLOAD ONE AT A TIME, DELIBERATELY. Browsers rate-limit and sometimes
 * silently drop rapid successive downloads, and a pack that quietly delivers
 * nine of twelve is worse than one that takes a moment — the missing three are
 * not noticed until the order is short. So they are sequenced, with the count
 * shown as it goes.
 */

export interface ShareCardLine {
  id: string
  sku: string | null
  brief: string | null
  quantity: number
  isNewDesign: boolean
}

export function ShareCards({ orderId, lines }: { orderId: string; lines: ShareCardLine[] }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)

  if (lines.length === 0) return null

  const cardUrl = (lineId: string) => `/api/orders/${orderId}/cards/${lineId}`

  const filename = (line: ShareCardLine) => {
    const tail = skuTail(line.sku)
    const stem = tail || (line.isNewDesign ? 'new-design' : 'saree')
    return `${stem}-x${line.quantity}.png`
  }

  /**
   * Fetch, then save from a blob rather than pointing an anchor at the route.
   *
   * A plain `<a download>` at an API path leaves the filename to the server and
   * gives no signal when one fails. Fetching means a card that 404s is reported
   * instead of silently missing from the pack.
   */
  const downloadAll = async () => {
    setBusy(true)
    setDone(0)
    try {
      for (const line of lines) {
        const response = await fetch(cardUrl(line.id))
        if (!response.ok) continue

        const blob = await response.blob()
        const href = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = href
        anchor.download = filename(line)
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(href)

        setDone((n) => n + 1)
        // Enough of a gap that the browser treats these as separate saves.
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 border-t border-stone-200 pt-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Cards for WhatsApp</h2>
          <p className="text-sm text-stone-500">
            {lines.length} {lines.length === 1 ? 'card' : 'cards'} · the saree, its code and the
            quantity. No prices.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadAll}
          disabled={busy}
          className="shrink-0 rounded-lg bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? `Saving ${done}/${lines.length}…` : 'Download all'}
        </button>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {lines.map((line) => {
          const tail = skuTail(line.sku)
          return (
            <li key={line.id}>
              <a
                href={cardUrl(line.id)}
                download={filename(line)}
                className="block overflow-hidden rounded-xl border border-stone-200 transition hover:border-stone-400"
                title="Save this card"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cardUrl(line.id)}
                  alt={tail ? `Card for ${tail}` : 'Card for a new design'}
                  className="block w-full bg-stone-100"
                  loading="lazy"
                />
              </a>
              <p className="mt-1 font-mono text-xs text-stone-500">
                {line.isNewDesign ? 'New design' : tail} · {line.quantity}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

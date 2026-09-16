'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { cropForMode, cropStyle, sizedImage, type CropRect } from '@/lib/products/image'
import { Alert, Button, Card } from '@/components/ui/primitives'
import { saveCrop } from './actions'

/**
 * Cropping a queue of sarees, one after another.
 *
 * The full editor at /admin/products/[sku] does more — it also picks the image
 * and takes a pasted URL — and doing three hundred sarees through it means
 * three hundred round trips through a list, a product page and a back button.
 * This screen asks one question, keeps the answer in the same place on screen
 * every time, and moves on.
 *
 * WHY THE WHOLE QUEUE ARRIVES AT ONCE. The photographs are the slow part, so
 * the next two are prefetched by the browser while this one is being drawn.
 * Moving on is then instant, which is the difference between a tool somebody
 * works through and one they abandon at saree forty.
 *
 * WHY THE FRAME IS 3:4. That is the shape of the weaver's card — the same
 * mathematics as `cropStyle`, at the size she sees. A crop drawn against a
 * different shape is not the crop she gets.
 */

export interface QueueItem {
  sku: string
  title: string | null
  url: string
  vendorCode: string | null
  units90d: number | null
  /** What it is framed by now: a hand-drawn rectangle, or the named mode. */
  crop: CropRect | null
  cropMode: string | null
}

export function CropQueue({ items, remaining }: { items: QueueItem[]; remaining: number }) {
  const [index, setIndex] = useState(0)
  // Rectangles drawn during this session, by SKU. Derived rather than copied
  // into state on every move, so going back to a saree shows what was drawn for
  // it and a fresh one starts from whatever it already carries.
  const [drawn, setDrawn] = useState<Record<string, CropRect | null>>({})
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState<{ sku: string; message: string } | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const frame = useRef<HTMLDivElement>(null)

  const item = items[index]
  const crop = item && item.sku in drawn ? drawn[item.sku] : (item?.crop ?? null)
  const setCrop = (next: CropRect | null | ((c: CropRect | null) => CropRect | null)) => {
    if (!item) return
    setDrawn((d) => ({
      ...d,
      [item.sku]: typeof next === 'function' ? next(item.sku in d ? d[item.sku] : (item.crop ?? null)) : next,
    }))
  }

  const advance = () => setIndex((i) => Math.min(i + 1, items.length))

  const save = () => {
    if (!item || pending) return
    const payload = crop ? JSON.stringify(crop) : ''
    startTransition(async () => {
      const result = await saveCrop(item.sku, payload)
      if (result.status === 'error') {
        setError({ sku: item.sku, message: result.message ?? 'Could not save.' })
        return
      }
      setDone((d) => [...d, item.sku])
      advance()
    })
  }

  // Enter saves and moves on, so a whole session is one hand on the mouse and
  // one finger on Enter. Escape clears a rectangle drawn wrong.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'Enter') {
        event.preventDefault()
        save()
      }
      if (event.key === 'Escape') setCrop(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!item) {
    return (
      <Card className="space-y-3 text-center">
        <p className="font-medium text-stone-900">
          {done.length > 0 ? `${done.length} cropped.` : 'Nothing in the queue.'}
        </p>
        <p className="text-sm text-stone-500">
          {remaining > items.length
            ? `${(remaining - done.length).toLocaleString('en-IN')} sarees still have no hand-drawn crop. Reload for the next batch.`
            : 'Every saree in this selection has been framed by hand.'}
        </p>
        {remaining > done.length && (
          <div className="flex justify-center">
            <Link
              href="/admin/products/cropping"
              className="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
            >
              Next batch
            </Link>
          </div>
        )}
      </Card>
    )
  }

  const effective = crop ?? cropForMode(item.cropMode)
  const next = items.slice(index + 1, index + 3)

  const pointFrom = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return null
    return {
      x: Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1),
      y: Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1),
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-stone-500">
        <p>
          <span className="font-medium text-stone-900">{index + 1}</span> of {items.length} in this
          batch · {done.length} saved · {remaining.toLocaleString('en-IN')} without a crop in total
        </p>
        <Link href={`/admin/products/${encodeURIComponent(item.sku)}`} className="underline-offset-2 hover:underline">
          Open the full editor for this saree
        </Link>
      </div>

      {error?.sku === item.sku && <Alert tone="error">{error.message}</Alert>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* --- Draw ------------------------------------------------------ */}
        <Card className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-base text-stone-900">{item.sku}</p>
            <p className="text-xs text-stone-500">
              {item.vendorCode ?? '—'}
              {item.units90d !== null && ` · ${item.units90d} sold in 90 days`}
            </p>
          </div>

          <div
            ref={frame}
            className="relative mx-auto aspect-[3/4] w-full max-w-[460px] touch-none overflow-hidden rounded-lg bg-stone-100 select-none"
            onPointerDown={(event) => {
              const point = pointFrom(event)
              if (!point) return
              event.currentTarget.setPointerCapture(event.pointerId)
              setDrag(point)
              setCrop(null)
            }}
            onPointerMove={(event) => {
              if (!drag) return
              const point = pointFrom(event)
              if (!point) return
              setCrop({
                x: Math.min(drag.x, point.x),
                y: Math.min(drag.y, point.y),
                w: Math.abs(point.x - drag.x),
                h: Math.abs(point.y - drag.y),
              })
            }}
            onPointerUp={() => {
              setDrag(null)
              // A tap rather than a drag clears the rectangle instead of saving
              // a one-pixel box, which renders as a blank card.
              setCrop((c) => (c && c.w > 0.02 && c.h > 0.02 ? c : null))
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sizedImage(item.url, 800) ?? item.url}
              alt={item.title ?? item.sku}
              className="h-full w-full object-cover"
              draggable={false}
            />

            {crop && (
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 bg-black/45" style={{ height: `${crop.y * 100}%` }} />
                <div
                  className="absolute inset-x-0 bottom-0 bg-black/45"
                  style={{ height: `${(1 - crop.y - crop.h) * 100}%` }}
                />
                <div
                  className="absolute left-0 bg-black/45"
                  style={{ top: `${crop.y * 100}%`, height: `${crop.h * 100}%`, width: `${crop.x * 100}%` }}
                />
                <div
                  className="absolute right-0 bg-black/45"
                  style={{
                    top: `${crop.y * 100}%`,
                    height: `${crop.h * 100}%`,
                    width: `${(1 - crop.x - crop.w) * 100}%`,
                  }}
                />
                <div
                  className="absolute border-2 border-white"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`,
                    height: `${crop.h * 100}%`,
                  }}
                />
              </div>
            )}
          </div>

          <p className="text-center text-xs text-stone-500">
            Drag a rectangle over the fabric. Tap once to clear it. Enter saves and moves on.
          </p>
        </Card>

        {/* --- What she will see ----------------------------------------- */}
        <div className="space-y-3">
          <Card className="space-y-2">
            <p className="text-sm font-medium text-stone-700">Her card</p>
            <div className="relative h-[300px] w-full overflow-hidden rounded-lg bg-stone-100">
              <div className="absolute inset-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sizedImage(item.url, 800) ?? item.url}
                  alt=""
                  className="absolute max-w-none object-cover"
                  style={cropStyle(effective)}
                  draggable={false}
                />
              </div>
            </div>
            <p className="font-mono text-[15px] text-stone-900">{item.sku}</p>
            {!crop && <p className="text-xs text-stone-500">Default framing — nothing saved for this saree yet.</p>}
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={pending} className="flex-1">
              {pending ? 'Saving…' : crop ? 'Save and next' : 'Use default and next'}
            </Button>
            <Button type="button" variant="secondary" onClick={advance} disabled={pending}>
              Skip
            </Button>
          </div>

          {next.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-stone-500">Next</p>
              <div className="flex gap-2">
                {next.map((n) => (
                  // Prefetched by being on the page; moving on is then instant.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={n.sku}
                    src={sizedImage(n.url, 400) ?? n.url}
                    alt=""
                    className="h-20 w-16 rounded object-cover opacity-70"
                    draggable={false}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

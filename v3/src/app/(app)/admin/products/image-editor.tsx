'use client'

import { useActionState, useRef, useState } from 'react'
import { cropForMode, cropStyle, sizedImage, type CropRect } from '@/lib/products/image'
import { Button, Card, Field, Input, Select, Alert } from '@/components/ui/primitives'
import { saveProductImage, type ImageState } from './image-actions'

export interface EditableProduct {
  sku: string
  title: string | null
  image_urls: string[] | null
  display_image_position: number | null
  manual_image_url: string | null
  crop_json: CropRect | null
  crop_mode: string | null
}

const IDLE: ImageState = { status: 'idle' }

/**
 * Choosing the photograph, and cutting it.
 *
 * THE PREVIEW IS THE CARD. It is rendered at the same aspect and with the same
 * crop mathematics the weaver's card uses, at 300px tall, because a crop that
 * looks right in a wide admin box and wrong on a phone is the only kind of
 * mistake this screen exists to catch.
 *
 * THE DRAG IS IN FRACTIONS, NOT PIXELS. The rectangle is stored as proportions
 * of the source image, so it survives the source being served at 400px here and
 * 800px on the card — and survives Shopify re-encoding the original at a
 * different size, which it does.
 *
 * Pointer events rather than mouse events: the same handler works for a
 * trackpad and for the admin doing this on an iPad, and pointer capture means a
 * drag that leaves the box still ends cleanly instead of leaving the rectangle
 * stuck to the cursor.
 */
export function ImageEditor({ product }: { product: EditableProduct }) {
  const [state, action, pending] = useActionState(saveProductImage, IDLE)

  const urls = (product.image_urls ?? []).filter(Boolean)
  const [position, setPosition] = useState(product.display_image_position ?? 3)
  const [manual, setManual] = useState(product.manual_image_url ?? '')
  const [mode, setMode] = useState(product.crop_mode ?? 'top')
  const [crop, setCrop] = useState<CropRect | null>(product.crop_json ?? null)

  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)

  const chosen =
    manual.trim() || (urls.length > 0 ? urls[Math.min(Math.max(position, 1), urls.length) - 1] : null)

  const effectiveCrop = crop ?? cropForMode(mode)

  /** Pointer position as a fraction of the frame, clamped to it. */
  const pointFrom = (event: React.PointerEvent) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return null
    return {
      x: Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1),
      y: Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1),
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-medium text-stone-900">Photograph</h2>
        <p className="text-sm text-stone-500">
          Image 3 by default — image 1 is the full-length model shot on nearly every product here,
          and the saree is a quarter of that frame.
        </p>
      </div>

      {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}
      {state.status === 'saved' && <Alert tone="success">Saved. This survives the next sync.</Alert>}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* --- Drawing surface ------------------------------------------- */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-stone-700">Drag to crop</p>

          <div
            ref={frame}
            className="relative aspect-[3/4] w-full touch-none overflow-hidden rounded-lg bg-stone-100 select-none"
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
              // A tap rather than a drag. Treated as "clear the crop" instead
              // of saving a one-pixel rectangle that renders as a blank card.
              setCrop((c) => (c && c.w > 0.02 && c.h > 0.02 ? c : null))
            }}
          >
            {chosen ? (
              // A pasted manual_image_url can be on any host, and next/image
              // refuses anything not in remotePatterns. This is an admin tool.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sizedImage(chosen, 800) ?? chosen}
                alt={product.sku}
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-stone-400">
                No image
              </div>
            )}

            {crop && (
              <>
                {/* Everything outside the rectangle, dimmed. Four divs rather
                    than a box-shadow so it works over any image. */}
                <div className="pointer-events-none absolute inset-0">
                  <div
                    className="absolute inset-x-0 top-0 bg-black/50"
                    style={{ height: `${crop.y * 100}%` }}
                  />
                  <div
                    className="absolute inset-x-0 bottom-0 bg-black/50"
                    style={{ height: `${(1 - crop.y - crop.h) * 100}%` }}
                  />
                  <div
                    className="absolute left-0 bg-black/50"
                    style={{
                      top: `${crop.y * 100}%`,
                      height: `${crop.h * 100}%`,
                      width: `${crop.x * 100}%`,
                    }}
                  />
                  <div
                    className="absolute right-0 bg-black/50"
                    style={{
                      top: `${crop.y * 100}%`,
                      height: `${crop.h * 100}%`,
                      width: `${(1 - crop.x - crop.w) * 100}%`,
                    }}
                  />
                </div>
                <div
                  className="pointer-events-none absolute border-2 border-white"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`,
                    height: `${crop.h * 100}%`,
                  }}
                />
              </>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setCrop(null)}>
              Clear crop
            </Button>
            {crop && (
              <span className="self-center text-xs text-stone-500 tabular-nums">
                {Math.round(crop.w * 100)}% × {Math.round(crop.h * 100)}%
              </span>
            )}
          </div>
        </div>

        {/* --- What she will see ------------------------------------------ */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-stone-700">What the weaver sees</p>

          <div className="w-full max-w-[320px] space-y-3 rounded-xl border border-stone-200 p-4">
            <div className="relative h-[300px] w-full overflow-hidden rounded-xl bg-stone-100">
              {chosen && (
                // eslint-disable-next-line @next/next/no-img-element -- see above
                <img
                  src={sizedImage(chosen, 800) ?? chosen}
                  alt={product.sku}
                  className="absolute max-w-none object-cover"
                  style={cropStyle(effectiveCrop)}
                />
              )}
            </div>
            <p className="font-mono text-[19px] leading-tight font-medium break-words text-stone-900">
              {product.sku}
            </p>
            {product.title && <p className="text-base text-stone-900">{product.title}</p>}
          </div>
        </div>
      </div>

      {/* --- The thumbnails --------------------------------------------- */}
      {urls.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-stone-700">
            All {urls.length} Shopify images — tap one to use it
          </p>
          <ul className="flex snap-x gap-2 overflow-x-auto pb-2">
            {urls.map((url, i) => (
              <li key={url} className="shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => {
                    setPosition(i + 1)
                    setManual('')
                  }}
                  className={`block overflow-hidden rounded-lg border-2 ${
                    !manual && position === i + 1 ? 'border-stone-900' : 'border-transparent'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                  <img
                    src={sizedImage(url, 200) ?? url}
                    alt={`Image ${i + 1}`}
                    className="h-24 w-20 object-cover"
                  />
                  <span className="block bg-white py-0.5 text-center text-xs text-stone-600">
                    {i + 1}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={action} className="space-y-3 border-t border-stone-100 pt-4">
        <input type="hidden" name="sku" value={product.sku} />
        <input type="hidden" name="display_image_position" value={position} />
        <input type="hidden" name="crop_json" value={crop ? JSON.stringify(crop) : ''} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Image number" hint="Which Shopify image to use.">
            <Input
              type="number"
              min={1}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value) || 1)}
            />
          </Field>

          <Field label="Crop" hint="Used when no rectangle is drawn.">
            <Select name="crop_mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="top">Top — cuts head and floor</option>
              <option value="centre">Centre</option>
              <option value="none">No crop</option>
            </Select>
          </Field>
        </div>

        <Field
          label="Or paste an image address"
          hint="Overrides everything above. Must start with https://. Leave empty to go back to the Shopify image."
        >
          <Input
            name="manual_image_url"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="https://…"
          />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save photograph'}
        </Button>
      </form>
    </Card>
  )
}

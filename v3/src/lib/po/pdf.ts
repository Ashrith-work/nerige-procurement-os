import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib'
import { sizedImage } from '@/lib/products/image'

/**
 * The purchase order, as a PDF.
 *
 * pdf-lib rather than headless Chrome. Rendering HTML to PDF properly means
 * shipping a browser, which on a serverless function is a 50MB layer and a cold
 * start measured in seconds — for a one-page document with a table and some
 * thumbnails.
 *
 * THE THUMBNAIL PROBLEM, stated because it is the one thing here that can fail
 * on real data: pdf-lib embeds JPEG and PNG and nothing else. Shopify serves
 * WebP to clients that advertise it and sometimes by default. So each image is
 * fetched, its magic bytes are checked, and anything that is not JPEG or PNG is
 * drawn as an empty box rather than throwing — a PO missing one thumbnail is a
 * usable document; a PO that failed to generate is not.
 */

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 48
const INK = rgb(0.11, 0.1, 0.09)
const MUTED = rgb(0.45, 0.42, 0.4)
const RULE = rgb(0.85, 0.83, 0.81)

export interface PoLine {
  sku: string | null
  name: string | null
  quantity: number
  imageUrl: string | null
  isNewDesign: boolean
}

export interface PoDocument {
  poNumber: string
  orderNumber: string
  issuedAt: Date
  vendorName: string
  vendorCode: string
  vendorPhone: string | null
  restock: PoLine[]
  newDesigns: PoLine[]
}

/**
 * Fetch a thumbnail and embed it, or return null.
 *
 * Never throws. A network hiccup on one of twelve images must not lose the
 * document — and the SKU and quantity, which are what the weaver is actually
 * paid against, do not depend on the picture.
 */
async function embedThumbnail(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null

  try {
    const sized = sizedImage(url, 200) ?? url
    const response = await fetch(sized, { cache: 'no-store' })
    if (!response.ok) return null

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length < 4) return null

    // Magic bytes, not the Content-Type header: a CDN that mislabels a WebP as
    // image/jpeg would take the whole document down with an unhelpful error
    // from deep inside pdf-lib.
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8
    const isPng =
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47

    if (isJpeg) return await pdf.embedJpg(bytes)
    if (isPng) return await pdf.embedPng(bytes)

    // WebP, AVIF, or something else. Skipped deliberately — see the header.
    return null
  } catch {
    return null
  }
}

export async function buildPurchaseOrder(doc: PoDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${doc.poNumber} — ${doc.vendorName}`)
  pdf.setCreator('Nerige')

  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const medium = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono = await pdf.embedFont(StandardFonts.Courier)

  // Fetched up front, in parallel: doing it inside the layout loop would
  // serialise twelve network round trips behind the drawing.
  const allLines = [...doc.restock, ...doc.newDesigns]
  const thumbnails = new Map<PoLine, PDFImage | null>()
  await Promise.all(
    allLines.map(async (line) => thumbnails.set(line, await embedThumbnail(pdf, line.imageUrl))),
  )

  let page = pdf.addPage([A4.width, A4.height])
  let y = A4.height - MARGIN

  const newPage = () => {
    page = pdf.addPage([A4.width, A4.height])
    y = A4.height - MARGIN
  }

  const text = (
    value: string,
    opts: { x?: number; size?: number; font?: PDFFont; color?: typeof INK } = {},
  ) => {
    page.drawText(value, {
      x: opts.x ?? MARGIN,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? regular,
      color: opts.color ?? INK,
    })
  }

  const rule = () => {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4.width - MARGIN, y },
      thickness: 0.5,
      color: RULE,
    })
  }

  // --- Letterhead ------------------------------------------------------------
  // Wordmark rather than a logo file. There is no brand asset in this
  // repository, and inventing one that is subtly wrong is worse than setting
  // the name well.
  y -= 18
  text('NERIGE', { size: 22, font: medium })
  y -= 14
  text('Nerige Story · Handloom sarees', { size: 9, color: MUTED })

  y -= 30
  text('PURCHASE ORDER', { size: 11, font: medium })
  y -= 16
  text(doc.poNumber, { size: 18, font: mono })

  // Right-aligned block: date and source order.
  const rightX = A4.width - MARGIN - 170
  page.drawText(doc.issuedAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }), { x: rightX, y: y + 16, size: 10, font: regular, color: INK })
  page.drawText(`Order ${doc.orderNumber}`, {
    x: rightX,
    y,
    size: 9,
    font: regular,
    color: MUTED,
  })

  y -= 24
  rule()

  // --- Vendor ----------------------------------------------------------------
  y -= 20
  text('SUPPLIER', { size: 8, font: medium, color: MUTED })
  y -= 15
  text(doc.vendorName, { size: 13, font: medium })
  y -= 14
  text(doc.vendorCode, { size: 10, font: mono, color: MUTED })
  if (doc.vendorPhone) {
    y -= 13
    text(doc.vendorPhone, { size: 10, color: MUTED })
  }

  y -= 22
  rule()

  // --- Sections --------------------------------------------------------------
  const ROW_HEIGHT = 54
  const THUMB = 44

  const section = (heading: string, note: string, lines: PoLine[]) => {
    if (lines.length === 0) return

    if (y < MARGIN + 110) newPage()

    y -= 24
    text(heading, { size: 11, font: medium })
    y -= 13
    text(note, { size: 8.5, color: MUTED })

    y -= 12
    rule()
    y -= 12
    text('ITEM', { size: 7.5, font: medium, color: MUTED, x: MARGIN + THUMB + 12 })
    page.drawText('QTY', {
      x: A4.width - MARGIN - 34,
      y,
      size: 7.5,
      font: medium,
      color: MUTED,
    })
    y -= 6
    rule()

    for (const line of lines) {
      if (y < MARGIN + ROW_HEIGHT + 20) {
        newPage()
        y -= 10
      }

      y -= ROW_HEIGHT

      const image = thumbnails.get(line) ?? null
      if (image) {
        // Cover-fit inside a square, cropping the long side rather than
        // squashing — a stretched saree is unrecognisable.
        const scale = Math.max(THUMB / image.width, THUMB / image.height)
        page.drawRectangle({
          x: MARGIN,
          y,
          width: THUMB,
          height: THUMB,
          color: rgb(0.96, 0.96, 0.95),
        })
        page.drawImage(image, {
          x: MARGIN - (image.width * scale - THUMB) / 2,
          y: y - (image.height * scale - THUMB) / 2,
          width: image.width * scale,
          height: image.height * scale,
        })
      } else {
        page.drawRectangle({
          x: MARGIN,
          y,
          width: THUMB,
          height: THUMB,
          color: rgb(0.96, 0.96, 0.95),
        })
      }

      const textX = MARGIN + THUMB + 12
      const maxWidth = A4.width - MARGIN - 50 - textX

      // The code, monospace, and never truncated. It is the string that gets
      // copied onto a fabric label by hand.
      page.drawText(line.sku ?? 'No code — we will label this on arrival', {
        x: textX,
        y: y + THUMB - 12,
        size: line.sku ? 11 : 9,
        font: line.sku ? mono : regular,
        color: line.sku ? INK : MUTED,
      })

      if (line.name) {
        page.drawText(truncate(line.name, regular, 9, maxWidth), {
          x: textX,
          y: y + THUMB - 27,
          size: 9,
          font: regular,
          color: MUTED,
        })
      }

      page.drawText(String(line.quantity), {
        x: A4.width - MARGIN - 30,
        y: y + THUMB - 14,
        size: 12,
        font: medium,
        color: INK,
      })
    }

    y -= 10
    rule()
  }

  section(
    'Make these again',
    'Write the code shown against each piece before packing.',
    doc.restock,
  )
  section(
    'New designs',
    'Nothing here has a code. These arrive unlabelled and are coded on receipt.',
    doc.newDesigns,
  )

  // --- Totals ----------------------------------------------------------------
  const totalPieces = allLines.reduce((sum, line) => sum + line.quantity, 0)

  if (y < MARGIN + 60) newPage()

  y -= 26
  text('TOTAL', { size: 9, font: medium, color: MUTED })
  page.drawText(`${allLines.length} lines`, {
    x: A4.width - MARGIN - 150,
    y,
    size: 10,
    font: regular,
    color: MUTED,
  })
  page.drawText(`${totalPieces} pieces`, {
    x: A4.width - MARGIN - 60,
    y,
    size: 12,
    font: medium,
    color: INK,
  })

  y -= 30
  text(
    'No price is stated on this document. Rates are agreed separately and settled against invoice.',
    { size: 7.5, color: MUTED },
  )

  return pdf.save()
}

/** Cuts a string to fit, with an ellipsis. Names run long; the code never gets this. */
function truncate(value: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value

  let cut = value
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > maxWidth) {
    cut = cut.slice(0, -1)
  }
  return `${cut}…`
}

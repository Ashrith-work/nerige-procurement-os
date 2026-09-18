import { Montserrat, Nunito_Sans } from 'next/font/google'

/**
 * The two faces nerigestory.com actually loads, self-hosted by `next/font` so
 * no screen in this application makes a request to fonts.gstatic.com.
 *
 * The storefront declares them in its own `:root`:
 *   --heading-font-family: Montserrat, sans-serif;   weight 500
 *   --text-font-family: "Nunito Sans", sans-serif;   weight 400
 * (source: the inline <style> block on https://nerigestory.com — see
 * docs/BRAND.md). Both are Google Fonts under the OFL, so unlike a paid
 * Shopify face there is nothing stopping us serving them ourselves.
 *
 * Both are requested as variable fonts: one file each covers 500 for headings
 * and 400/600 for prose, instead of three static files on a warehouse tablet.
 *
 * Neither face reaches a data table. `--font-sans` — the platform UI stack —
 * stays the face for every column of numbers, every SKU and every dense row,
 * because a column of figures is scanned rather than read and the platform face
 * is the one the reader's eye is already calibrated to. See globals.css.
 */
export const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
})

export const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  variable: '--font-nunito-sans',
  display: 'swap',
})

export const brandFontClass = `${montserrat.variable} ${nunitoSans.variable}`

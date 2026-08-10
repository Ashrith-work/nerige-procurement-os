import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

/**
 * next-intl, pointed at a request config that resolves the language from the
 * session rather than from the URL. There is no `/kn/portal` and nothing for a
 * weaver to pick before she can read her order — see src/i18n/request.ts.
 */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  images: {
    // Every product photograph in the seed data is on the Shopify CDN (verified:
    // 9,646 of 9,646 non-blank image URLs). next/image refuses any host not
    // listed here, so this is what makes the photo grid render at all.
    //
    // Sizes are requested per surface with Shopify's `?width=` parameter —
    // 400 for grid tiles, 800 for vendor cards — because a weaver on a phone
    // should not be pulling a 3000px original down a mobile connection.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.shopify.com',
        pathname: '/s/files/**',
      },
    ],
  },
}

export default withNextIntl(nextConfig)

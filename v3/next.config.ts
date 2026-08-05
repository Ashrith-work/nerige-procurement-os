import type { NextConfig } from 'next'

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

export default nextConfig

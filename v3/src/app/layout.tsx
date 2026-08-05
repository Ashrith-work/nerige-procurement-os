import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nerige',
  description: 'Vendor portal',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Not maximumScale: 1. Pinning the zoom stops a weaver enlarging a SKU she
  // is copying onto a label by hand, which is the one thing these screens
  // exist to make readable.
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}

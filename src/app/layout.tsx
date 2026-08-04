import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  // Latin only for now. When the vendor portal ships in Kannada, Tamil and
  // Telugu (M4), this needs a script-capable companion — Noto Sans Kannada /
  // Tamil / Telugu — or those locales fall back to system fonts and look
  // visibly second-class next to English.
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nerige Story · Procurement",
  description: "Procurement operating system for Nerige Story.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately no maximum-scale: a vendor reading a PO on a phone must be
  // able to pinch-zoom. Locking zoom is a common mobile reflex and an
  // accessibility failure.
};

// Typed explicitly rather than with Next's generated `LayoutProps<"/">`, which
// only exists after a build has emitted .next/types — so `tsc --noEmit` in CI
// would fail on a clean checkout.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-stone-50 text-stone-900">
        {children}
      </body>
    </html>
  );
}

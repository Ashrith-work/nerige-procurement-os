'use client'

import { Button } from '@/components/ui/primitives'

/**
 * A weaver keeps a printed sheet of codes beside the loom. The browser can
 * already do this; the button is here so she does not have to know that.
 */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="no-print">
      {label}
    </Button>
  )
}

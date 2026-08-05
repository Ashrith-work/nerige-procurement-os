import Link from 'next/link'
import { Button } from '@/components/ui/primitives'

export const metadata = { title: 'Not authorised' }

export default function NotAuthorisedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-semibold">You do not have access to that page</h1>
        <p className="text-sm text-stone-500">
          If you think this is wrong, ask the procurement team to check your role.
        </p>
        <Link href="/">
          <Button variant="secondary">Back to start</Button>
        </Link>
      </div>
    </main>
  )
}

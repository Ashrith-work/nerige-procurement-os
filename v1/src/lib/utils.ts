import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Conditional class names with Tailwind conflict resolution.
 *
 * Lives at `@/lib/utils` because that is where `npx shadcn add` expects to find
 * it — putting it anywhere else means hand-editing the import in every
 * component the CLI generates from here on.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

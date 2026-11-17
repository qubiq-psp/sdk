import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind classes: conditional parts via clsx, conflicts (`p-2` vs `p-4`) resolved by tailwind-merge. */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}

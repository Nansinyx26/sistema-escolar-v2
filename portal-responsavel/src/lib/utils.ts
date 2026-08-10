/**
 * utils.ts
 * Helper `cn` exigido pelos componentes dos registries shadcn / Magic UI /
 * React Bits: junta classes condicionais (clsx) e resolve conflitos de
 * utilitarios Tailwind (tailwind-merge).
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

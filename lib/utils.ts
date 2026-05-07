import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditionnel de classes Tailwind (résout les conflits "p-2 p-4" → "p-4").
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatage centimes → EUR (source unique pour tout le projet) */
export function formatEUR(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

/** Formatage minutes → heures avec une décimale */
export function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

/** Date ISO lisible en français */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

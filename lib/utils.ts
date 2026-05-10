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

/**
 * Nombre d'heures dans un jour de travail standard.
 * Utilisé pour convertir minutes ↔ jours dans l'UI.
 */
export const HOURS_PER_DAY = 8;
export const MINUTES_PER_DAY = HOURS_PER_DAY * 60; // 480

/** Formatage minutes → jours avec une décimale. "0j" pour zéro. */
export function formatDays(minutes: number): string {
  if (minutes === 0) return "0j";
  const days = minutes / MINUTES_PER_DAY;
  if (Number.isInteger(days)) return `${days}j`;
  return `${days.toFixed(1)}j`;
}

/** Convertit jours (décimal) → minutes (entier arrondi). */
export function daysToMinutes(days: number): number {
  return Math.round(days * MINUTES_PER_DAY);
}

/** Convertit minutes → jours (valeur décimale). */
export function minutesToDays(minutes: number): number {
  return minutes / MINUTES_PER_DAY;
}

/** Date ISO lisible en français */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

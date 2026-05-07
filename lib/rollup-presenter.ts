import type { RollupRow } from "@/lib/tickets/types";

/**
 * Helpers de présentation spécifiques aux roll-ups.
 * Les formats génériques (EUR, heures) sont dans lib/utils.ts.
 */

export type VarianceTone = "success" | "warning" | "danger" | "neutral";

/** Seuil d'alerte dérive : à partir de +10% on considère en risque. */
export const VARIANCE_WARNING_THRESHOLD = 10;
/** Seuil critique : à partir de +25% de dérive, couleur rouge. */
export const VARIANCE_DANGER_THRESHOLD = 25;

export function getVarianceTone(variancePercent: number): VarianceTone {
  if (variancePercent <= 0) return "success";
  if (variancePercent >= VARIANCE_DANGER_THRESHOLD) return "danger";
  if (variancePercent >= VARIANCE_WARNING_THRESHOLD) return "warning";
  return "neutral";
}

/** Format lisible "+12.5%" / "-3.2%" */
export function formatVariance(variancePercent: number): string {
  const sign = variancePercent > 0 ? "+" : "";
  return `${sign}${variancePercent.toFixed(1)}%`;
}

/**
 * Agrège plusieurs RollupRows (ex: tous les Epics d'un projet) en totaux.
 */
export function sumRollups(rollups: Iterable<RollupRow>): {
  totalEstimatedMinutes: number;
  totalLoggedMinutes: number;
  totalCostCents: number;
  progressPercent: number;
  variancePercent: number;
} {
  let estimated = 0;
  let logged = 0;
  let cost = 0;
  for (const r of rollups) {
    estimated += r.totalEstimatedMinutes;
    logged += r.totalLoggedMinutes;
    cost += r.totalCostCents;
  }
  const progress = estimated === 0 ? 0 : Math.round((logged / estimated) * 1000) / 10;
  const variance =
    estimated === 0 ? 0 : Math.round(((logged - estimated) / estimated) * 1000) / 10;
  return {
    totalEstimatedMinutes: estimated,
    totalLoggedMinutes: logged,
    totalCostCents: cost,
    progressPercent: progress,
    variancePercent: variance,
  };
}

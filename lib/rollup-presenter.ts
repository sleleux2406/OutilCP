import type { RollupRow } from "@/lib/tickets/types";

/**
 * Helpers de présentation spécifiques aux roll-ups.
 */

export type VarianceTone = "success" | "warning" | "danger" | "neutral";

export const VARIANCE_WARNING_THRESHOLD = 10;
export const VARIANCE_DANGER_THRESHOLD = 25;

export function getVarianceTone(variancePercent: number): VarianceTone {
  if (variancePercent <= 0) return "success";
  if (variancePercent >= VARIANCE_DANGER_THRESHOLD) return "danger";
  if (variancePercent >= VARIANCE_WARNING_THRESHOLD) return "warning";
  return "neutral";
}

/** Format lisible "+12.5%" / "-3.2%" / "0%" */
export function formatVariance(variancePercent: number): string {
  if (variancePercent === 0) return "0%";
  const sign = variancePercent > 0 ? "+" : "";
  return `${sign}${variancePercent.toFixed(1)}%`;
}

/** Pourcentage de dérive pour une RollupRow. */
export function variancePercentFromRollup(rollup: RollupRow): number {
  if (rollup.totalEstimatedMinutes === 0) return 0;
  return (
    Math.round((rollup.varianceMinutes / rollup.totalEstimatedMinutes) * 1000) / 10
  );
}

/**
 * Agrège plusieurs RollupRows (ex: tous les Epics d'un projet) en totaux.
 */
export function sumRollups(rollups: Iterable<RollupRow>): {
  totalEstimatedMinutes: number;
  totalLoggedMinutes: number;
  totalRemainingMinutes: number;
  totalProjectedMinutes: number;
  varianceMinutes: number;
  progressPercent: number;
  variancePercent: number;
} {
  let estimated = 0;
  let logged = 0;
  let remaining = 0;
  for (const r of rollups) {
    estimated += r.totalEstimatedMinutes;
    logged += r.totalLoggedMinutes;
    remaining += r.totalRemainingMinutes;
  }
  const projected = logged + remaining;
  const variance = projected - estimated;
  const progress = estimated === 0 ? 0 : Math.round((logged / estimated) * 1000) / 10;
  const variancePct =
    estimated === 0 ? 0 : Math.round((variance / estimated) * 1000) / 10;
  return {
    totalEstimatedMinutes: estimated,
    totalLoggedMinutes: logged,
    totalRemainingMinutes: remaining,
    totalProjectedMinutes: projected,
    varianceMinutes: variance,
    progressPercent: progress,
    variancePercent: variancePct,
  };
}

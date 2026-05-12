import type { TicketStatus, TicketType } from "@prisma/client";

/**
 * DTO "léger" d'un ticket utilisé dans le Kanban et les listes.
 */
export interface KanbanTicket {
  id: string;
  key: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority: number;
  boardOrder: number;
  estimatedMinutes: number;
  loggedMinutes: number;
  remainingMinutes: number | null;
  /** Date de fin prévue (calculée via endDate + RAF) — sérialisée en string ISO côté client. */
  endDate: string | null;
  assignee: { id: string; name: string } | null;
  parentKey: string | null;
  /** True si c'est une Feature sans Task/Bug enfant → workflow session d'estimation. */
  needsEstimation?: boolean;
  /** False si la tâche est une TODO non chiffrée (ne compte pas dans l'agrégation). */
  isEstimated?: boolean;
  testStats?: { passed: number; failed: number; total: number };
  rollup: {
    totalEstimatedMinutes: number;
    totalLoggedMinutes: number;
    totalRemainingMinutes: number;
    totalProjectedMinutes: number;
    varianceMinutes: number;
    progressPercent: number;
  } | null;
}

export interface RollupRow {
  ticketId: string;
  totalEstimatedMinutes: number;
  totalLoggedMinutes: number;
  totalRemainingMinutes: number;
  totalProjectedMinutes: number;
  varianceMinutes: number;
  progressPercent: number;
  usCount: number;
  bugCount: number;
  featureCount: number;
  taskCount: number;
}

/**
 * Indique si le ticket va dépasser ou dépasse déjà son estimation initiale.
 * Un ticket est "over budget" si la projection (loggé + reste) > estimation.
 */
export function isOverBudget(
  rollup:
    | { totalEstimatedMinutes: number; totalProjectedMinutes: number }
    | null
    | undefined
): boolean {
  if (!rollup) return false;
  return (
    rollup.totalEstimatedMinutes > 0 &&
    rollup.totalProjectedMinutes > rollup.totalEstimatedMinutes
  );
}

/**
 * Dérive en pourcentage : (projection − estimation) / estimation × 100.
 * Positif = dépassement prévu, négatif = marge.
 */
export function variancePercent(
  rollup:
    | { totalEstimatedMinutes: number; totalProjectedMinutes: number }
    | null
    | undefined
): number {
  if (!rollup || rollup.totalEstimatedMinutes === 0) return 0;
  const variance =
    ((rollup.totalProjectedMinutes - rollup.totalEstimatedMinutes) /
      rollup.totalEstimatedMinutes) *
    100;
  return Math.round(variance * 10) / 10;
}

import type { TicketStatus, TicketType } from "@prisma/client";

/**
 * DTO "léger" d'un ticket utilisé dans le Kanban et les listes.
 * Volontairement plus restreint que le modèle Prisma pour éviter
 * les sérialisations inutiles et les fuites de champs internes.
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
  assignee: { id: string; name: string } | null;
  parentKey: string | null;
  testStats?: { passed: number; failed: number; total: number };
  rollup: {
    totalEstimatedMinutes: number;
    totalLoggedMinutes: number;
    totalCostCents: number;
    progressPercent: number;
  } | null;
}

export interface RollupRow {
  ticketId: string;
  totalEstimatedMinutes: number;
  totalLoggedMinutes: number;
  totalCostCents: number;
  progressPercent: number;
  usCount: number;
  bugCount: number;
  featureCount: number;
  taskCount: number;
}

/** Indique si le ticket est en dérive (temps loggé > temps estimé). */
export function isOverBudget(rollup: {
  totalEstimatedMinutes: number;
  totalLoggedMinutes: number;
} | null | undefined): boolean {
  if (!rollup) return false;
  return (
    rollup.totalEstimatedMinutes > 0 &&
    rollup.totalLoggedMinutes > rollup.totalEstimatedMinutes
  );
}

/**
 * Dérive en pourcentage (positif = retard, négatif = avance).
 * 0 si pas d'estimation.
 */
export function variancePercent(rollup: {
  totalEstimatedMinutes: number;
  totalLoggedMinutes: number;
} | null | undefined): number {
  if (!rollup || rollup.totalEstimatedMinutes === 0) return 0;
  const variance =
    ((rollup.totalLoggedMinutes - rollup.totalEstimatedMinutes) /
      rollup.totalEstimatedMinutes) *
    100;
  return Math.round(variance * 10) / 10;
}

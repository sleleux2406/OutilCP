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
  /** Titre du parent (utile pour afficher sur la carte bugs escaladés). */
  parentTitle?: string | null;
  /**
   * Clé du sous-projet RUN d'origine si ce ticket est un bug escaladé
   * depuis un RUN vers le board parent. Null sinon.
   */
  sourceRunKey?: string | null;
  /** True si c'est une Feature sans Task/Bug enfant → workflow session d'estimation. */
  needsEstimation?: boolean;
  /** False si la tâche est une TODO non chiffrée (ne compte pas dans l'agrégation). */
  isEstimated?: boolean;
  testStats?: { passed: number; failed: number; total: number };
  /**
   * Module 1.1 : version actuelle des specs sur ce ticket (Feature uniquement).
   */
  versionSpecsCourante?: string | null;
  /**
   * Module 1.1 : version des specs au moment de la creation (heritee du parent).
   * Pour les Tasks/Bugs/US sous une Feature.
   */
  versionSpecsOriginelle?: string | null;
  /**
   * Module 1.3 : derniere version exportee. Si differente de versionSpecsCourante,
   * la Feature est consideree "en retard d'export".
   */
  lastExportedAtVersion?: string | null;
  /**
   * Module 2.2 : nom complet (titre) de la Feature parente, pour affichage sur les cartes Bug.
   */
  parentFullTitle?: string | null;
  /**
   * Module 2.2 : nom du board RUN source (ex: "Recette v2") quand le bug
   * vient d'un RUN. Pour affichage sur la carte du Bug.
   */
  sourceRunName?: string | null;
  /**
   * Module 2.2 : horodatage exact de creation (ISO). Pour affichage detaille.
   */
  createdAt?: string | null;
  /**
   * Phase 3 : alerte si le ticket est assigne a un user qui a un conge
   * couvrant tout ou partie de la periode startDate-endDate.
   */
  leaveAlert?: {
    severity: "full" | "partial";
    overlapStart: string;
    overlapEnd: string;
    overlapDays: number;
  } | null;
  rollup: {
    totalEstimatedMinutes: number;
    totalLoggedMinutes: number;
    totalRemainingMinutes: number;
    /** RAF de la Feature elle-même (hors enfants). */
    totalRemainingSelfMinutes: number;
    /** Σ RAF des Tasks/Bugs chiffrés descendants. */
    totalRemainingChildrenMinutes: number;
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
  /** RAF du ticket lui-même (hors enfants). */
  totalRemainingSelfMinutes: number;
  /** Σ RAF des Tasks/Bugs chiffrés descendants. */
  totalRemainingChildrenMinutes: number;
  totalProjectedMinutes: number;
  varianceMinutes: number;
  progressPercent: number;
  usCount: number;
  bugCount: number;
  featureCount: number;
  taskCount: number;
  /**
   * Mode container du ticket (Lot C1) :
   *   - true : FEATURE avec Task/Bug enfants, OU BUG avec Task chiffrée enfant
   *   - false : ticket en mode feuille (Task, Bug simple, US, Epic, Feature sans enfants)
   *
   * Quand `isContainer = true`, l'estim/RAF/log directs sont gérés via
   * le rollup et le mécanisme de gel (frozenSelfMinutes).
   */
  isContainer: boolean;
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

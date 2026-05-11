import type { TicketStatus } from "@prisma/client";

/**
 * Règles métier sur les champs Estimation Initiale et Reste à Faire (RAF).
 *
 * Règles :
 *   1. Ticket DONE          → RAF forcé à 0, tout verrouillé sauf statut
 *   2. À froid (loggé = 0)  → estimated modifiable ; RAF auto-sync sur estimated
 *   3. À chaud (loggé > 0)  → estimated verrouillé ; RAF modifiable manuellement
 *   4. Ticket avec enfants  → estimated + RAF verrouillés (la vue SQL agrège
 *                              automatiquement à partir des enfants)
 */

export interface EstimationContext {
  status: TicketStatus;
  loggedMinutes: number;
  hasChildren: boolean;
}

export interface EstimationEditability {
  /** Peut-on modifier l'estimation initiale ? */
  canEditEstimated: boolean;
  /** Peut-on modifier le reste à faire ? */
  canEditRemaining: boolean;
  /** Message utilisateur expliquant pourquoi un champ est verrouillé */
  lockReason:
    | "DONE"
    | "HAS_CHILDREN"
    | "COLD_AUTO_SYNC"
    | "HOT_ESTIMATED_FROZEN"
    | null;
}

export function computeEstimationEditability(
  ctx: EstimationContext
): EstimationEditability {
  // Règle 1 : DONE → tout verrouillé
  if (ctx.status === "DONE") {
    return {
      canEditEstimated: false,
      canEditRemaining: false,
      lockReason: "DONE",
    };
  }

  // Règle 4 : ticket parent → valeurs agrégées depuis les enfants
  if (ctx.hasChildren) {
    return {
      canEditEstimated: false,
      canEditRemaining: false,
      lockReason: "HAS_CHILDREN",
    };
  }

  // Règle 2 : à froid (loggé = 0) → estimated libre, RAF auto
  if (ctx.loggedMinutes === 0) {
    return {
      canEditEstimated: true,
      canEditRemaining: false, // auto-sync sur estimated
      lockReason: "COLD_AUTO_SYNC",
    };
  }

  // Règle 3 : à chaud (loggé > 0) → estimated figé historique, RAF libre
  return {
    canEditEstimated: false,
    canEditRemaining: true,
    lockReason: "HOT_ESTIMATED_FROZEN",
  };
}

/** Message d'explication à afficher à l'utilisateur. */
export function getLockReasonLabel(reason: EstimationEditability["lockReason"]): string {
  switch (reason) {
    case "DONE":
      return "Ticket terminé : estimation et reste à faire verrouillés.";
    case "HAS_CHILDREN":
      return "Ce ticket a des enfants : ses valeurs sont calculées automatiquement à partir d'eux.";
    case "COLD_AUTO_SYNC":
      return "Aucun temps loggé : le reste à faire se synchronise automatiquement sur l'estimation initiale.";
    case "HOT_ESTIMATED_FROZEN":
      return "Du temps a déjà été loggé : l'estimation initiale est fixée, ajustez désormais le reste à faire.";
    default:
      return "";
  }
}

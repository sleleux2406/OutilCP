import type { TicketStatus, TicketType } from "@prisma/client";

/**
 * Règles métier sur les champs Estimation Initiale et Reste à Faire (RAF).
 *
 * Règles :
 *   1. Ticket DONE                       → RAF forcé à 0, tout verrouillé
 *   2. À froid (loggé = 0)               → estimated modifiable ; RAF auto-sync
 *   3. À chaud (loggé > 0)               → estimated verrouillé ; RAF modifiable
 *   4. Ticket parent (avec enfants chiffrés) → tout verrouillé, agrégé par vue SQL
 *
 * Cas particulier FEATURE :
 *   - Une Feature peut avoir une estimation initiale saisie manuellement par le PO
 *   - Elle reste modifiable tant qu'aucune Task ou Bug enfant n'est chiffrée
 *   - Logique hybride : estim manuelle + somme des enfants chiffrés côté vue SQL
 */

export interface EstimationContext {
  type: TicketType;
  status: TicketStatus;
  loggedMinutes: number;
  /**
   * Est-ce que le ticket a des enfants qui comptent dans l'agrégation ?
   * Pour Epic/US : true si ≥ 1 enfant (peu importe le type).
   * Pour Feature : true si ≥ 1 enfant Task ou Bug (US legacy exclue).
   * Pour Task/Bug : toujours false.
   */
  hasAggregatingChildren: boolean;
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
  // Règle 0 : un Epic ne gère jamais d'estimation ni de RAF
  // (il sert uniquement à trier la spec fonctionnelle).
  if (ctx.type === "EPIC") {
    return {
      canEditEstimated: false,
      canEditRemaining: false,
      lockReason: "HAS_CHILDREN",
    };
  }

  // Règle 1 : DONE → tout verrouillé
  if (ctx.status === "DONE") {
    return {
      canEditEstimated: false,
      canEditRemaining: false,
      lockReason: "DONE",
    };
  }

  // Règle 4 : ticket parent avec enfants qui agrègent → valeurs auto
  if (ctx.hasAggregatingChildren) {
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
      return "Ce ticket a des enfants chiffrés : ses valeurs sont calculées automatiquement à partir d'eux.";
    case "COLD_AUTO_SYNC":
      return "Aucun temps loggé : le reste à faire se synchronise automatiquement sur l'estimation initiale.";
    case "HOT_ESTIMATED_FROZEN":
      return "Du temps a déjà été loggé : l'estimation initiale est fixée, ajustez désormais le reste à faire.";
    default:
      return "";
  }
}

/**
 * Helper : détermine si les enfants d'un ticket donné "comptent" pour
 * l'agrégation.
 *
 * Pour une FEATURE ou un BUG, seuls les enfants Task/Bug comptent.
 * (Les US legacy ne comptent pas pour Feature, et un Bug n'aura jamais d'US enfant.)
 * Pour les autres types, tout enfant compte.
 */
export function hasAggregatingChildren(
  parentType: TicketType,
  childrenTypes: TicketType[]
): boolean {
  if (childrenTypes.length === 0) return false;
  if (parentType === "FEATURE" || parentType === "BUG") {
    return childrenTypes.some((t) => t === "TASK" || t === "BUG");
  }
  return true;
}

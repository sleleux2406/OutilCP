import { TicketType } from "@prisma/client";

/**
 * Règles de hiérarchie — source unique de vérité pour tout le projet.
 *
 * Structure :
 *   EPIC
 *     └── FEATURE
 *           ├── USER_STORY
 *           │     ├── TASK
 *           │     └── BUG
 *           └── BUG                (bug rattaché directement à la feature)
 */
export const ALLOWED_CHILDREN: Record<TicketType, TicketType[]> = {
  EPIC: ["FEATURE"],
  FEATURE: ["USER_STORY", "BUG"],
  USER_STORY: ["TASK", "BUG"],
  TASK: [],
  BUG: [],
};

/** Types de parents valides pour un type d'enfant donné (inverse du map ci-dessus). */
export const ALLOWED_PARENTS: Record<TicketType, TicketType[]> = {
  EPIC: [],
  FEATURE: ["EPIC"],
  USER_STORY: ["FEATURE"],
  TASK: ["USER_STORY"],
  BUG: ["FEATURE", "USER_STORY"],
};

export function canAttach(parentType: TicketType, childType: TicketType): boolean {
  return ALLOWED_CHILDREN[parentType].includes(childType);
}

/** Les types qui peuvent exister SANS parent (racines). */
export const ROOT_TYPES: TicketType[] = ["EPIC"];

export function canBeRoot(type: TicketType): boolean {
  return ROOT_TYPES.includes(type);
}

/**
 * Niveau dans la hiérarchie (utilisé pour l'ordre de roll-up).
 * Plus le niveau est élevé, plus le ticket est "haut" dans l'arbre.
 */
export const HIERARCHY_LEVEL: Record<TicketType, number> = {
  TASK: 0,
  BUG: 0,
  USER_STORY: 1,
  FEATURE: 2,
  EPIC: 3,
};

/**
 * Les types qui font l'objet d'un test (auxquels on peut attacher des TestCase).
 * Conforme à la spec : les testeurs testent US et Features.
 */
export const TESTABLE_TYPES: TicketType[] = ["USER_STORY", "FEATURE"];

export function isTestable(type: TicketType): boolean {
  return TESTABLE_TYPES.includes(type);
}

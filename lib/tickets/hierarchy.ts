import { TicketType } from "@prisma/client";

/**
 * Règles de hiérarchie — source unique de vérité pour tout le projet.
 *
 * Structure :
 *   EPIC
 *     └── FEATURE
 *           ├── TASK             (nouveau : enfant direct après session d'estimation)
 *           ├── USER_STORY       (legacy, conservé pour compat)
 *           │     ├── TASK
 *           │     └── BUG
 *           └── BUG               (bug rattaché directement à la feature)
 *
 * Depuis le workflow "session d'estimation", on privilégie FEATURE → TASK
 * (la session génère directement des Tasks enfants d'une Feature).
 * Les User Stories restent valides pour la compatibilité.
 */
export const ALLOWED_CHILDREN: Record<TicketType, TicketType[]> = {
  EPIC: ["FEATURE"],
  // Une Feature peut avoir des Tasks, User Stories ou Bugs.
  FEATURE: ["TASK", "USER_STORY", "BUG"],
  USER_STORY: ["TASK", "BUG"],
  TASK: [],
  BUG: [],
};

/** Types de parents valides pour un type d'enfant donné (inverse du map ci-dessus). */
export const ALLOWED_PARENTS: Record<TicketType, TicketType[]> = {
  EPIC: [],
  FEATURE: ["EPIC"],
  USER_STORY: ["FEATURE"],
  // Une Task peut être enfant d'une Feature (session d'estimation)
  // ou d'une User Story (mode legacy).
  TASK: ["FEATURE", "USER_STORY"],
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
 * On teste les User Stories et les Features.
 */
export const TESTABLE_TYPES: TicketType[] = ["USER_STORY", "FEATURE"];

export function isTestable(type: TicketType): boolean {
  return TESTABLE_TYPES.includes(type);
}

/**
 * Types visibles par défaut dans le Kanban selon le rôle.
 *
 *   - DEVELOPER : voit les Tasks + tous les Bugs (il intervient sur l'exécution)
 *   - ADMIN / PRODUCT_OWNER / TESTER : voient Epics + Features (niveau pilotage)
 *
 * Un DEV peut accéder à la Feature parente depuis la page détail d'une Task.
 */
export const KANBAN_VISIBLE_TYPES_BY_ROLE: Record<
  "ADMIN" | "PRODUCT_OWNER" | "DEVELOPER" | "TESTER",
  TicketType[]
> = {
  ADMIN: ["EPIC", "FEATURE"],
  PRODUCT_OWNER: ["EPIC", "FEATURE"],
  DEVELOPER: ["TASK", "BUG"],
  TESTER: ["EPIC", "FEATURE"],
};

/**
 * Une Feature est "à estimer" si elle n'a aucun enfant Task ou Bug.
 * (Les User Stories ne comptent pas — une Feature peut en avoir mais
 * l'estimation concrète se fait via la session d'estimation qui crée des Tasks.)
 *
 * À utiliser sur une Feature avec la liste de ses enfants déjà chargée.
 */
export function isFeatureNeedingEstimation(
  type: TicketType,
  childrenTypes: TicketType[]
): boolean {
  if (type !== "FEATURE") return false;
  // Tant qu'il n'y a aucune Task ni Bug enfant, la Feature est à estimer
  return !childrenTypes.some((t) => t === "TASK" || t === "BUG");
}

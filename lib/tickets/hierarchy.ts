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
 *           │           └── TASK  (lot C0 : decomposition d'un bug en sous-taches)
 *           └── BUG               (bug rattaché directement à la feature)
 *                 └── TASK         (lot C0 : decomposition d'un bug en sous-taches)
 *
 * Depuis le workflow "session d'estimation", on privilégie FEATURE → TASK
 * (la session génère directement des Tasks enfants d'une Feature).
 * Les User Stories restent valides pour la compatibilité.
 *
 * Lot C0 (mode simple) : on autorise TASK comme enfant d'un BUG, mais le BUG
 * conserve son comportement de feuille (estim propre, log direct, etc.).
 * Le rollup additionne quand meme les Tasks enfants au Bug, ce qui peut creer
 * un drift d'estim si le PO ne maintient pas l'estim Bug a jour. Le Lot C1
 * passera en mode "container adaptatif" pour resoudre ce point.
 */
export const ALLOWED_CHILDREN: Record<TicketType, TicketType[]> = {
  EPIC: ["FEATURE"],
  // Une Feature peut avoir des Tasks, User Stories ou Bugs.
  FEATURE: ["TASK", "USER_STORY", "BUG"],
  USER_STORY: ["TASK", "BUG"],
  TASK: [],
  // Lot C0 : un Bug peut etre decompose en Tasks correctives.
  BUG: ["TASK"],
};

/** Types de parents valides pour un type d'enfant donné (inverse du map ci-dessus). */
export const ALLOWED_PARENTS: Record<TicketType, TicketType[]> = {
  EPIC: [],
  FEATURE: ["EPIC"],
  USER_STORY: ["FEATURE"],
  // Une Task peut être enfant d'une Feature, d'une User Story ou d'un Bug.
  TASK: ["FEATURE", "USER_STORY", "BUG"],
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
 * Une Feature est "à estimer" si elle respecte DEUX conditions :
 *   1. Aucun enfant Task ou Bug n'existe (rien de concret saisi)
 *   2. Son estimation initiale n'a pas été renseignée manuellement (estimatedMinutes = 0)
 *
 * Dès que l'une des deux conditions tombe, la Feature est considérée comme
 * chiffrée et le badge "À estimer" disparaît.
 *
 * Logique hybride (voir règles métier) :
 *   - Si le PO saisit 10j en estimation initiale ET qu'on ajoute 3 Tasks
 *     chiffrées de 2j, la vue SQL totalEstimatedMinutes agrège automatiquement
 *     à 10 + 6 = 16j (elle somme node + descendants).
 */
export function isFeatureNeedingEstimation(
  type: TicketType,
  childrenTypes: TicketType[],
  estimatedMinutes: number
): boolean {
  if (type !== "FEATURE") return false;
  const hasTaskOrBug = childrenTypes.some((t) => t === "TASK" || t === "BUG");
  if (hasTaskOrBug) return false;
  if (estimatedMinutes > 0) return false;
  return true;
}

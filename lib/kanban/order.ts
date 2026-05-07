/**
 * Calcul de l'ordre lexicographique entre deux voisins dans une colonne Kanban.
 *
 * Stratégie : entiers espacés (step = 1024). À chaque insertion entre deux
 * voisins, on prend le milieu. Tant que l'écart reste raisonnable, aucune
 * renumérotation n'est nécessaire — gain de performance considérable.
 *
 * Si l'écart devient < MIN_GAP, un job de rebalance doit être lancé côté
 * serveur (hors scope de ce fichier).
 */

const STEP = 1024;
const MIN_GAP = 2;

/**
 * @param prev boardOrder du voisin précédent (ou null si insertion en début)
 * @param next boardOrder du voisin suivant (ou null si insertion en fin)
 */
export function computeNewOrder(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return STEP;
  if (prev == null) return next! - STEP;
  if (next == null) return prev + STEP;
  return Math.floor((prev + next) / 2);
}

/** Détecte si la colonne a besoin d'un rebalance (écarts trop petits). */
export function needsRebalance(orders: number[]): boolean {
  for (let i = 1; i < orders.length; i++) {
    if (orders[i] - orders[i - 1] < MIN_GAP) return true;
  }
  return false;
}

/** Reconstruit des orders espacés pour une colonne. */
export function rebalance(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * STEP);
}

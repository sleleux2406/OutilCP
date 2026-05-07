/**
 * Helpers pour la gestion du champ Ticket.path (hiérarchie matérialisée).
 *
 * Convention : path = "/" pour une racine, "/parentId/grandparentId/..." sinon.
 * Le path contient les IDs des ANCÊTRES (pas le ticket lui-même).
 *
 * Utilisation :
 *   - Recherche "tous les descendants d'un ticket" → WHERE path LIKE '%/ticketId/%'
 *   - Déplacement dans l'arbre → recalculer path de tout le sous-arbre
 *
 * Le vrai roll-up passe par la vue SQL récursive ticket_rollup. Le path
 * sert aux recherches rapides non-agrégées.
 */

export function buildPath(parentPath: string | null, parentId: string | null): string {
  if (!parentPath || !parentId) return "/";
  // Garantit le slash de fin
  const normalized = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
  return `${normalized}${parentId}/`;
}

/** Liste les IDs des ancêtres extraits d'un path. Path racine → []. */
export function parsePathAncestors(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/**
 * Construit une clause SQL LIKE pour trouver tous les descendants d'un ticket.
 * Attention : ticketId DOIT être trusted (venir de Prisma, pas de l'utilisateur).
 * Pour un usage sûr, préférer une requête Prisma paramétrée.
 */
export function descendantsPathPattern(ticketId: string): string {
  return `%/${ticketId}/%`;
}

/** Profondeur d'un ticket (0 = racine). */
export function pathDepth(path: string): number {
  return parsePathAncestors(path).length;
}

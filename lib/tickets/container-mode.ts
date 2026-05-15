import type { TicketType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Mode "container" pour un ticket.
 *
 * Un ticket est en mode container quand son estimation et son temps sont
 * portes par ses enfants chiffres plutot que par lui-meme. Concretement :
 *
 *   - L'estim est calculee par le rollup SQL (somme propre + descendants chiffres)
 *   - Le log de temps direct sur le ticket est bloque (force a logger sur les enfants)
 *   - L'edition de l'estim/RAF est verrouillee
 *   - La page Capacite utilise totalEstimatedMinutes (pas estimatedMinutes propre)
 *   - Au 1er log dans le sous-arbre, frozenSelfMinutes est capture pour figer
 *     la part propre du ticket (regle hybride identique a la Feature)
 *
 * Regles de detection (Lot C1) :
 *
 *   - FEATURE : toujours en mode container des qu'elle a >= 1 enfant Task ou Bug
 *     (logique historique, inchangee)
 *
 *   - BUG : passe en mode container des qu'il a >= 1 Task enfant CHIFFREE
 *     (isEstimated=true). Si toutes les Tasks sont des TODO ou supprimees,
 *     retour en mode feuille.
 *
 *   - EPIC : jamais (les Epics ne portent pas d'estimation/temps)
 *
 *   - TASK, USER_STORY : jamais en mode container ici (USER_STORY a son
 *     propre comportement legacy traite separement).
 */

/**
 * Verifie si un ticket est en mode container, en interrogeant la base
 * pour connaitre l'etat de ses enfants.
 *
 * @param ticketId Id du ticket a verifier
 * @returns true si le ticket est en mode container, false sinon
 */
export async function isContainerMode(ticketId: string): Promise<boolean> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { type: true },
  });
  if (!ticket) return false;
  return isContainerModeForType(ticket.type, await loadChildrenForContainer(ticketId));
}

/**
 * Variante synchrone qui prend les enfants en parametre (utile quand on les
 * a deja charges depuis une autre requete).
 *
 * @param parentType Type du ticket parent
 * @param children Liste des enfants avec au moins type et isEstimated
 */
export function isContainerModeForType(
  parentType: TicketType,
  children: Array<{ type: TicketType; isEstimated: boolean }>
): boolean {
  // FEATURE : container des qu'il y a un Task ou Bug enfant (peu importe isEstimated,
  // car la regle historique pour Feature est plus permissive)
  if (parentType === "FEATURE") {
    return children.some((c) => c.type === "TASK" || c.type === "BUG");
  }
  // BUG : container UNIQUEMENT si au moins une Task enfant est chiffree
  if (parentType === "BUG") {
    return children.some((c) => c.type === "TASK" && c.isEstimated);
  }
  return false;
}

/**
 * Charge les enfants directs d'un ticket avec les champs necessaires
 * pour determiner le mode container.
 */
async function loadChildrenForContainer(
  ticketId: string
): Promise<Array<{ type: TicketType; isEstimated: boolean }>> {
  return prisma.ticket.findMany({
    where: { parentId: ticketId },
    select: { type: true, isEstimated: true },
  });
}

/**
 * Bulk version : determine le mode container pour plusieurs tickets en
 * une seule requete. Utile pour la page Capacite ou le board qui charge
 * beaucoup de tickets.
 *
 * @returns Map<ticketId, isContainer>
 */
export async function getContainerModeForTickets(
  tickets: Array<{ id: string; type: TicketType }>
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (tickets.length === 0) return result;

  // Filtre les types qui peuvent potentiellement etre containers
  const candidates = tickets.filter(
    (t) => t.type === "FEATURE" || t.type === "BUG"
  );
  if (candidates.length === 0) {
    for (const t of tickets) result.set(t.id, false);
    return result;
  }

  // Charge tous les enfants directs en une seule requete
  const allChildren = await prisma.ticket.findMany({
    where: { parentId: { in: candidates.map((t) => t.id) } },
    select: { parentId: true, type: true, isEstimated: true },
  });

  // Groupe par parentId
  const childrenByParent = new Map<
    string,
    Array<{ type: TicketType; isEstimated: boolean }>
  >();
  for (const child of allChildren) {
    if (!child.parentId) continue;
    const list = childrenByParent.get(child.parentId) ?? [];
    list.push({ type: child.type, isEstimated: child.isEstimated });
    childrenByParent.set(child.parentId, list);
  }

  // Calcule le mode pour chaque ticket
  for (const t of tickets) {
    const children = childrenByParent.get(t.id) ?? [];
    result.set(t.id, isContainerModeForType(t.type, children));
  }
  return result;
}

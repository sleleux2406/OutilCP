import type { Prisma } from "@prisma/client";

/**
 * Gel de l'estimation initiale d'un container (Feature OU Bug) au premier log.
 *
 * Règle métier :
 *   - Tant qu'aucun temps n'a été loggé dans le sous-arbre d'un container,
 *     son estimation totale évolue de façon hybride (estim propre + somme
 *     des estimations des Tasks chiffrées).
 *   - Au premier log, on capture cette somme hybride en l'écrivant dans
 *     le champ estimatedMinutes propre du container. L'estim devient alors
 *     figée : si le dev ajoute une nouvelle Task après, l'estim container reste
 *     inchangée mais le RAF gonfle → dépassement visible.
 *
 * Lot C1 :
 *   - FEATURE est toujours considérée comme container (même comportement qu'avant)
 *   - BUG est container UNIQUEMENT si il a >= 1 Task enfant chiffrée
 *
 * En remontant l'arbre depuis le ticket loggé, on gèle CHAQUE container
 * trouvé (un Bug puis sa Feature parente, par exemple).
 *
 * À appeler dans une transaction, juste avant d'incrémenter loggedMinutes
 * sur un ticket dont un container parent pourrait être impacté.
 */
export async function freezeContainerEstimationIfNeeded(
  tx: Prisma.TransactionClient,
  ticketId: string
): Promise<void> {
  // Remonter vers les containers parents en gelant chaque container rencontré.
  // On s'arrête quand on n'a plus de parent (ou en sécurité, si on revient
  // sur un ticket déjà visité).
  let currentId: string | null = ticketId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const current: {
      id: string;
      type: string;
      parentId: string | null;
      estimatedMinutes: number;
    } | null = await tx.ticket.findUnique({
      where: { id: currentId },
      select: { id: true, type: true, parentId: true, estimatedMinutes: true },
    });
    if (!current) return;

    // Cas FEATURE : toujours candidate au gel
    if (current.type === "FEATURE") {
      await freezeSingleContainer(tx, current.id, current.estimatedMinutes, "FEATURE");
      // Apres une Feature, plus rien au-dessus n'a d'estim a geler (les Epics
      // n'ont pas d'estim).
      return;
    }

    // Cas BUG : on gele uniquement si c'est un container (>= 1 Task chiffree enfant)
    if (current.type === "BUG") {
      const hasChiffredTaskChild = await tx.ticket.findFirst({
        where: {
          parentId: current.id,
          type: "TASK",
          isEstimated: true,
        },
        select: { id: true },
      });
      if (hasChiffredTaskChild) {
        await freezeSingleContainer(tx, current.id, current.estimatedMinutes, "BUG");
      }
      // On continue la remontee : le Bug peut avoir une Feature parente
      // qui doit aussi etre gelee.
    }

    // Tous les autres types (TASK, USER_STORY) : on remonte simplement.
    currentId = current.parentId;
  }
}

/**
 * Alias retro-compatible pour l'ancien nom de la fonction.
 * @deprecated Utiliser freezeContainerEstimationIfNeeded.
 */
export const freezeFeatureEstimationIfNeeded = freezeContainerEstimationIfNeeded;

/**
 * Vérifie si le container a déjà du log dans son sous-arbre.
 * Si c'est la PREMIÈRE fois qu'un log arrive, on capture :
 *   - estimatedMinutes propre = snapshot (somme hybride)
 *   - frozenAt = horodatage du gel
 *   - frozenSelfMinutes = "fraction propre" du container au moment du gel
 *     = currentEstimatedMinutes (avant snapshot) — c'est-à-dire l'estim
 *     propre du container qui n'est pas couverte par les Tasks chiffrées
 *
 * Cette fraction propre est ensuite utilisée par la vue SQL pour reconstituer
 * le RAF correctement même quand le RAF des Tasks est ajusté manuellement.
 *
 * Pour un Bug : on ne somme que les TASK chiffrees (pas les BUG, qui ne sont
 * pas des enfants directs autorises sous Bug).
 * Pour une Feature : on somme TASK + BUG chiffres (comportement historique).
 */
async function freezeSingleContainer(
  tx: Prisma.TransactionClient,
  containerId: string,
  currentEstimatedMinutes: number,
  containerType: "FEATURE" | "BUG"
): Promise<void> {
  const container = await tx.ticket.findUnique({
    where: { id: containerId },
    select: { frozenAt: true },
  });

  // Si frozenAt est déjà rempli : gel déjà effectué, rien à faire.
  if (container?.frozenAt) return;

  // C'est le premier log qui va arriver. On calcule la somme hybride et on
  // l'écrit dans estimatedMinutes propre du container + on horodate.
  // Pour Feature : enfants TASK et BUG chiffres
  // Pour Bug : enfants TASK chiffres uniquement
  const childTypes = containerType === "FEATURE" ? ["TASK", "BUG"] : ["TASK"];

  const agg = await tx.ticket.aggregate({
    where: {
      parentId: containerId,
      type: { in: childTypes as Array<"TASK" | "BUG"> },
      isEstimated: true,
    },
    _sum: { estimatedMinutes: true },
  });

  const childrenEstim = agg._sum.estimatedMinutes ?? 0;
  const snapshot = currentEstimatedMinutes + childrenEstim;

  // frozenSelfMinutes = la fraction de l'estim propre du container qui
  // n'est PAS couverte par les Tasks chiffrées au moment du gel.
  // C'est exactement la valeur d'estimatedMinutes AVANT le snapshot.
  const frozenSelfMinutes = currentEstimatedMinutes;

  await tx.ticket.update({
    where: { id: containerId },
    data: {
      estimatedMinutes: snapshot,
      frozenAt: new Date(),
      frozenSelfMinutes,
    },
  });
}

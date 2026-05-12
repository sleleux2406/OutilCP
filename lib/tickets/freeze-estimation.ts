import type { Prisma } from "@prisma/client";

/**
 * Gel de l'estimation initiale d'une Feature au premier log.
 *
 * Règle métier :
 *   - Tant qu'aucun temps n'a été loggé dans le sous-arbre d'une Feature,
 *     son estimation totale évolue de façon hybride (estim propre + somme
 *     des estimations des Tasks chiffrées).
 *   - Au premier log, on capture cette somme hybride en l'écrivant dans
 *     le champ estimatedMinutes propre de la Feature. L'estim devient alors
 *     figée : si le dev ajoute une nouvelle Task après, l'estim Feature reste
 *     inchangée mais le RAF gonfle → dépassement visible.
 *
 * À appeler dans une transaction, juste avant d'incrémenter loggedMinutes
 * sur un ticket dont une Feature parente pourrait être impactée.
 */
export async function freezeFeatureEstimationIfNeeded(
  tx: Prisma.TransactionClient,
  ticketId: string
): Promise<void> {
  // Remonter vers la Feature parente (si on n'est pas déjà sur une Feature).
  // On s'arrête dès qu'on a parcouru toute la chaîne ascendante.
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

    // Si on trouve une Feature, on vérifie s'il faut geler
    if (current.type === "FEATURE") {
      await freezeSingleFeature(tx, current.id, current.estimatedMinutes);
      // Pas besoin de continuer plus haut : les Epics n'ont pas d'estim
      return;
    }

    // Sinon on remonte
    currentId = current.parentId;
  }
}

/**
 * Vérifie si la Feature a déjà du log dans son sous-arbre.
 * Si c'est la PREMIÈRE fois qu'un log arrive, on capture la somme hybride
 * actuelle (estim propre + somme des Tasks/Bugs chiffrés enfants) dans
 * estimatedMinutes propre. Ensuite l'estim devient figée.
 */
async function freezeSingleFeature(
  tx: Prisma.TransactionClient,
  featureId: string,
  currentEstimatedMinutes: number
): Promise<void> {
  // Vérifier s'il y a déjà du log quelque part dans le sous-arbre.
  // Si oui, l'estim est déjà gelée, rien à faire.
  // (On utilise une requête récursive ou on somme simplement les loggedMinutes)
  const subtreeLogs = await tx.$queryRaw<Array<{ total: bigint }>>`
    WITH RECURSIVE sub AS (
      SELECT id, "loggedMinutes" FROM "Ticket" WHERE id = ${featureId}
      UNION ALL
      SELECT c.id, c."loggedMinutes"
      FROM "Ticket" c
      JOIN sub ON c."parentId" = sub.id
    )
    SELECT COALESCE(SUM("loggedMinutes"), 0)::bigint AS total FROM sub
  `;

  const totalLogged = Number(subtreeLogs[0]?.total ?? 0);

  // S'il y a déjà du log : l'estim est déjà figée (on a déjà écrit la valeur
  // dans estimatedMinutes au premier log). Rien à refaire.
  if (totalLogged > 0) return;

  // C'est le premier log qui va arriver. On calcule la somme hybride et on
  // l'écrit dans estimatedMinutes propre de la Feature.
  // Somme des estimations des enfants Task/Bug CHIFFRÉS uniquement.
  const agg = await tx.ticket.aggregate({
    where: {
      parentId: featureId,
      type: { in: ["TASK", "BUG"] },
      isEstimated: true,
    },
    _sum: { estimatedMinutes: true },
  });

  const childrenEstim = agg._sum.estimatedMinutes ?? 0;
  const snapshot = currentEstimatedMinutes + childrenEstim;

  // On écrit uniquement si la valeur change (évite un write inutile)
  if (snapshot !== currentEstimatedMinutes) {
    await tx.ticket.update({
      where: { id: featureId },
      data: { estimatedMinutes: snapshot },
    });
  }
}

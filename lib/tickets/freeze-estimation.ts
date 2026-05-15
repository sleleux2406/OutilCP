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
 * Si c'est la PREMIÈRE fois qu'un log arrive, on capture :
 *   - estimatedMinutes propre = snapshot (somme hybride)
 *   - frozenAt = horodatage du gel
 *   - frozenSelfMinutes = "fraction propre" de la Feature au moment du gel
 *     = currentEstimatedMinutes (avant snapshot) — c'est-à-dire l'estim
 *     propre de la Feature qui n'est pas couverte par les Tasks chiffrées
 *
 * Cette fraction propre est ensuite utilisée par la vue SQL pour reconstituer
 * le RAF correctement même quand le RAF des Tasks est ajusté manuellement.
 */
async function freezeSingleFeature(
  tx: Prisma.TransactionClient,
  featureId: string,
  currentEstimatedMinutes: number
): Promise<void> {
  const feature = await tx.ticket.findUnique({
    where: { id: featureId },
    select: { frozenAt: true },
  });

  // Si frozenAt est déjà rempli : gel déjà effectué, rien à faire.
  if (feature?.frozenAt) return;

  // C'est le premier log qui va arriver. On calcule la somme hybride et on
  // l'écrit dans estimatedMinutes propre de la Feature + on horodate.
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

  // frozenSelfMinutes = la fraction de l'estim propre de la Feature qui
  // n'est PAS couverte par les Tasks chiffrées au moment du gel.
  // C'est exactement la valeur d'estimatedMinutes AVANT le snapshot.
  const frozenSelfMinutes = currentEstimatedMinutes;

  await tx.ticket.update({
    where: { id: featureId },
    data: {
      estimatedMinutes: snapshot,
      frozenAt: new Date(),
      frozenSelfMinutes,
    },
  });
}

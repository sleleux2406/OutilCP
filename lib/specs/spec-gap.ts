import { prisma } from "@/lib/prisma";

/**
 * Compte les Features qui sont actuellement en statut IN_TESTING sur les
 * projets racines uniquement (les RUNs sont exclus).
 *
 * C'est l'indicateur de "retard de documentation" : quand une Feature passe
 * en IN_TESTING sans avoir été exportée vers un RUN, le PO voit ici un décalage
 * entre le développement et la documentation officielle.
 *
 * Dynamique : si une Feature est ramenée en IN_REVIEW / IN_PROGRESS, elle sort
 * automatiquement du compteur (aucun stockage dédié nécessaire).
 */
export async function countFeaturesInTestingOnRoots(): Promise<number> {
  return prisma.ticket.count({
    where: {
      type: "FEATURE",
      status: "IN_TESTING",
      // Uniquement sur les projets racines (parentProjectId = null)
      project: {
        parentProjectId: null,
      },
    },
  });
}

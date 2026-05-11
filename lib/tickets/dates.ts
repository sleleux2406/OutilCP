import type { Prisma } from "@prisma/client";
import {
  computeEndDate,
  minutesToWorkDays,
} from "@/lib/dates/business-days";

/**
 * Calcule la date de fin d'un ticket US/Task à partir de sa startDate et
 * de son RAF effectif (en minutes).
 *
 * Règle métier :
 *   - endDate = startDate + RAF (en jours ouvrés, début inclus)
 *   - Si pas de startDate OU pas de RAF : endDate = null (pas de planning)
 *   - RAF effectif : si remainingMinutes est NULL, on utilise
 *                    max(estimatedMinutes - loggedMinutes, 0) comme fallback
 *
 * Retourne null si la date ne peut pas être calculée.
 */
export function computeTicketEndDate(params: {
  startDate: Date | null;
  remainingMinutes: number | null;
  estimatedMinutes: number;
  loggedMinutes: number;
}): Date | null {
  if (!params.startDate) return null;

  // RAF effectif : saisie manuelle prioritaire, sinon fallback
  const effectiveRemaining =
    params.remainingMinutes !== null
      ? params.remainingMinutes
      : Math.max(params.estimatedMinutes - params.loggedMinutes, 0);

  // Pas de reste → fin = début (ticket déjà terminé sur le plan calendaire)
  if (effectiveRemaining <= 0) return params.startDate;

  const days = minutesToWorkDays(effectiveRemaining);
  return computeEndDate(params.startDate, days);
}

/**
 * Recalcule et sauvegarde endDate en base si nécessaire.
 * À appeler dans une transaction Prisma, juste après un update qui aurait
 * pu modifier startDate, remainingMinutes, estimatedMinutes ou loggedMinutes.
 *
 * Ne fait rien si le ticket est un parent (enfants gèrent leurs propres dates)
 * ou si startDate est null.
 */
export async function recomputeAndSaveEndDate(
  tx: Prisma.TransactionClient,
  ticketId: string
): Promise<Date | null> {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      startDate: true,
      endDate: true,
      remainingMinutes: true,
      estimatedMinutes: true,
      loggedMinutes: true,
      _count: { select: { children: true } },
    },
  });
  if (!ticket) return null;

  // Les tickets parents ont leurs dates agrégées depuis les enfants
  // (voir rollupDatesToParent). On ne calcule pas par formule ici.
  if (ticket._count.children > 0) return ticket.endDate;

  const newEnd = computeTicketEndDate({
    startDate: ticket.startDate,
    remainingMinutes: ticket.remainingMinutes,
    estimatedMinutes: ticket.estimatedMinutes,
    loggedMinutes: ticket.loggedMinutes,
  });

  // Comparer jour-à-jour pour éviter des writes inutiles (Date avec temps)
  const currentMs = ticket.endDate ? ticket.endDate.getTime() : null;
  const newMs = newEnd ? newEnd.getTime() : null;

  if (currentMs !== newMs) {
    await tx.ticket.update({
      where: { id: ticketId },
      data: { endDate: newEnd },
    });
  }

  return newEnd;
}

/**
 * Propage les dates vers un ticket parent (Feature ou Epic) selon la règle
 * de parallélisation :
 *   - startDate parent = min(startDate enfants non-null)
 *   - endDate parent = max(endDate enfants non-null)
 *   - Si tous les enfants ont NULL → le parent repasse à NULL
 *
 * À appeler dans une transaction, typiquement après un update d'enfant.
 * Remonte récursivement jusqu'à la racine (Epic).
 *
 * Ne fait rien si le ticket n'a pas d'enfants (feuille) ou n'existe pas.
 */
export async function rollupDatesToParent(
  tx: Prisma.TransactionClient,
  parentId: string
): Promise<void> {
  let currentId: string | null = parentId;

  // Remontée itérative vers la racine
  while (currentId) {
    const parent: {
      id: string;
      parentId: string | null;
      startDate: Date | null;
      endDate: Date | null;
    } | null = await tx.ticket.findUnique({
      where: { id: currentId },
      select: { id: true, parentId: true, startDate: true, endDate: true },
    });
    if (!parent) return;

    // Agrégats min/max sur les enfants directs
    const agg = await tx.ticket.aggregate({
      where: { parentId: currentId },
      _min: { startDate: true },
      _max: { endDate: true },
    });

    const newStart = agg._min.startDate;
    const newEnd = agg._max.endDate;

    const oldStartMs = parent.startDate?.getTime() ?? null;
    const oldEndMs = parent.endDate?.getTime() ?? null;
    const newStartMs = newStart?.getTime() ?? null;
    const newEndMs = newEnd?.getTime() ?? null;

    // Rien n'a changé → on arrête la remontée (l'ancêtre n'est pas impacté)
    if (oldStartMs === newStartMs && oldEndMs === newEndMs) return;

    await tx.ticket.update({
      where: { id: currentId },
      data: { startDate: newStart, endDate: newEnd },
    });

    // Remonter au grand-parent
    currentId = parent.parentId;
  }
}

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

  // Les tickets parents ont leurs dates agrégées depuis les enfants (Lot 3).
  // Pour l'instant on ignore ; le Lot 3 s'en occupera.
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

import type { PrismaClient, Prisma } from "@prisma/client";

/**
 * Detection de chevauchement entre les dates d'un ticket et les conges
 * de son assignee.
 *
 * Phase 3 : alerte visuelle sur les cartes Kanban et le pilotage si un
 * ticket est assigne a un user qui a un conge couvrant tout ou partie
 * de la periode startDate-endDate du ticket.
 *
 * Logique :
 *   - Pas d'assignee OU pas de startDate/endDate sur le ticket -> pas d'alerte
 *   - Si conge couvre TOUTE la periode -> severity = 'full' (rouge)
 *   - Si conge couvre PARTIELLEMENT -> severity = 'partial' (orange)
 *   - Si pas de chevauchement -> pas d'alerte
 */

export type LeaveOverlapSeverity = "full" | "partial";

export interface LeaveOverlapAlert {
  /** Severite : full = ticket entierement pendant un conge ; partial = chevauchement partiel */
  severity: LeaveOverlapSeverity;
  /** Premier jour de chevauchement (ISO date) */
  overlapStart: string;
  /** Dernier jour de chevauchement (ISO date) */
  overlapEnd: string;
  /** Nombre de jours calendaires en chevauchement */
  overlapDays: number;
}

interface LeaveRange {
  startDate: Date;
  endDate: Date;
}

interface TicketRange {
  /** Date de debut prevue du ticket (peut etre null) */
  startDate: Date | null;
  /** Date de fin prevue du ticket (peut etre null) */
  endDate: Date | null;
  /** Id de l'assignee (peut etre null si non-assigne) */
  assigneeId: string | null;
}

/**
 * Calcule s'il y a un chevauchement entre les dates du ticket et un quelconque
 * conge de son assignee. Retourne null si pas d'alerte.
 *
 * @param ticket Dates et assignee du ticket
 * @param leavesByUser Map des conges indexes par userId
 */
export function detectAssigneeLeaveOverlap(
  ticket: TicketRange,
  leavesByUser: Map<string, LeaveRange[]>
): LeaveOverlapAlert | null {
  // Pre-conditions : il faut un assignee ET au moins une date du ticket
  if (!ticket.assigneeId) return null;
  if (!ticket.startDate && !ticket.endDate) return null;

  const userLeaves = leavesByUser.get(ticket.assigneeId);
  if (!userLeaves || userLeaves.length === 0) return null;

  // Periode du ticket (si une seule date est definie, on prend cette date
  // comme deux extremites pour avoir un point a verifier)
  const tStart = ticket.startDate ?? ticket.endDate!;
  const tEnd = ticket.endDate ?? ticket.startDate!;

  // Pour chaque conge, on calcule l'intersection avec la periode du ticket
  let bestOverlap: { start: Date; end: Date; days: number } | null = null;

  for (const leave of userLeaves) {
    // Intersection : max des debuts, min des fins
    const interStart = leave.startDate > tStart ? leave.startDate : tStart;
    const interEnd = leave.endDate < tEnd ? leave.endDate : tEnd;

    if (interStart > interEnd) continue; // pas de chevauchement

    const days =
      Math.floor(
        (interEnd.getTime() - interStart.getTime()) / (24 * 60 * 60 * 1000)
      ) + 1;

    if (!bestOverlap || days > bestOverlap.days) {
      bestOverlap = { start: interStart, end: interEnd, days };
    }
  }

  if (!bestOverlap) return null;

  // Determine la severite : full si le conge couvre TOUTE la periode du ticket
  const ticketDays =
    Math.floor((tEnd.getTime() - tStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  const severity: LeaveOverlapSeverity =
    bestOverlap.days >= ticketDays ? "full" : "partial";

  return {
    severity,
    overlapStart: bestOverlap.start.toISOString().slice(0, 10),
    overlapEnd: bestOverlap.end.toISOString().slice(0, 10),
    overlapDays: bestOverlap.days,
  };
}

/**
 * Charge tous les conges des users assignees aux tickets, indexes par userId.
 * Retourne uniquement les conges qui chevauchent potentiellement la periode
 * couverte par les tickets (pour optimiser).
 */
export async function buildLeavesByUserMap(
  prisma: PrismaClient,
  args: {
    userIds: string[];
    /** Date la plus tot a considerer (filtre les conges qui se terminent avant) */
    rangeStart?: Date;
    /** Date la plus tard a considerer */
    rangeEnd?: Date;
  }
): Promise<Map<string, LeaveRange[]>> {
  const result = new Map<string, LeaveRange[]>();
  if (args.userIds.length === 0) return result;

  // Filtre BDD : on ne charge que les conges qui chevauchent la fenetre demandee
  const where: Prisma.UserLeaveWhereInput = {
    userId: { in: args.userIds },
  };
  if (args.rangeStart && args.rangeEnd) {
    where.AND = [
      { startDate: { lte: args.rangeEnd } },
      { endDate: { gte: args.rangeStart } },
    ];
  }

  const rows = await prisma.userLeave.findMany({
    where,
    select: { userId: true, startDate: true, endDate: true },
  });

  for (const r of rows) {
    const list = result.get(r.userId) ?? [];
    list.push({ startDate: r.startDate, endDate: r.endDate });
    result.set(r.userId, list);
  }

  return result;
}

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth, canEditTicket } from "@/lib/auth";
import { LogTimeSchema, type LogTimeInput } from "@/lib/tickets/schemas";
import { recomputeAndSaveEndDate, rollupDatesToParent } from "@/lib/tickets/dates";
import { freezeFeatureEstimationIfNeeded } from "@/lib/tickets/freeze-estimation";

export type LogTimeResult =
  | { ok: true; totalLoggedMinutes: number }
  | { ok: false; error: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "TODO_TASK" };

/**
 * Logger du temps sur un ticket.
 *
 * Sécurité :
 *   - Zod valide (cuid, minutes > 0 && <= 14400 = 30j, description <= 500 chars) [A03]
 *   - requireAuth() + canEditTicket() : seul un assigné/créateur/PO/Admin peut logger [A01]
 *   - Refus sur les tâches marquées TODO (isEstimated=false) : elles ne
 *     comptent pas dans l'agrégation, donc le log est désactivé pour éviter
 *     toute confusion métier.
 *   - Transaction : TimeEntry + mise à jour Ticket.loggedMinutes + AuditLog atomiques [A09]
 */
export async function logTimeAction(input: LogTimeInput): Promise<LogTimeResult> {
  const session = await requireAuth();

  const parsed = LogTimeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const ticket = await prisma.ticket.findUnique({
    where: { id: data.ticketId },
    select: {
      id: true,
      projectId: true,
      assigneeId: true,
      creatorId: true,
      parentId: true,
      type: true,
      key: true,
      isEstimated: true,
    },
  });
  if (!ticket) return { ok: false, error: "NOT_FOUND" };

  // Règle métier : les Epics ne gèrent pas de temps (ils servent seulement
  // à trier la spec fonctionnelle, pas à piloter un effort)
  if (ticket.type === "EPIC") {
    return { ok: false, error: "FORBIDDEN" };
  }

  // Règle métier : pas de log sur les TODO (tâches non chiffrées)
  if (!ticket.isEstimated) {
    return { ok: false, error: "TODO_TASK" };
  }

  // Seules les feuilles peuvent avoir du temps loggé direct.
  // Sur Epic/Feature on veut éviter la double comptabilisation (elles remontent via roll-up).
  // Les rôles non-dev (PO) peuvent logger partout pour régulariser.
  const isLeaf = ticket.type === "TASK" || ticket.type === "BUG" || ticket.type === "USER_STORY";
  if (!isLeaf && session.role !== "PRODUCT_OWNER" && session.role !== "ADMIN") {
    return { ok: false, error: "FORBIDDEN" };
  }

  if (!(await canEditTicket(session, ticket))) {
    return { ok: false, error: "FORBIDDEN" };
  }

  const result = await prisma.$transaction(async (tx) => {
    // GEL DE L'ESTIM FEATURE : AVANT d'incrémenter loggedMinutes, on capture
    // éventuellement la somme hybride courante dans la Feature parente (s'il
    // s'agit du tout premier log du sous-arbre). Après ça, l'estim ne bougera
    // plus même si de nouvelles Tasks sont ajoutées.
    await freezeFeatureEstimationIfNeeded(tx, data.ticketId);

    await tx.timeEntry.create({
      data: {
        ticketId: data.ticketId,
        userId: session.userId,
        minutes: data.minutes,
        description: data.description,
      },
    });

    // Incrément atomique : évite les lost-updates en cas de concurrence
    const updated = await tx.ticket.update({
      where: { id: data.ticketId },
      data: { loggedMinutes: { increment: data.minutes } },
      select: { loggedMinutes: true },
    });

    // Le log de temps peut changer le RAF effectif (fallback = estimated - logged),
    // donc recalculer endDate si une startDate est définie.
    await recomputeAndSaveEndDate(tx, data.ticketId);

    // Propagation vers le parent (min startDate / max endDate des enfants)
    if (ticket.parentId) {
      await rollupDatesToParent(tx, ticket.parentId);
    }

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "TIME.LOG",
        entityType: "Ticket",
        entityId: data.ticketId,
        metadata: { minutes: data.minutes },
      },
    });

    return updated;
  });

  revalidatePath(`/tickets/${ticket.key}`);
  revalidatePath(`/projects/[key]/board`, "page");
  revalidatePath(`/projects/[key]/overview`, "page");

  return { ok: true, totalLoggedMinutes: result.loggedMinutes };
}

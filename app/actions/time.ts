"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth, canEditTicket } from "@/lib/auth";
import { LogTimeSchema, type LogTimeInput } from "@/lib/tickets/schemas";
import { recomputeAndSaveEndDate } from "@/lib/tickets/dates";

export type LogTimeResult =
  | { ok: true; totalLoggedMinutes: number }
  | { ok: false; error: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" };

/**
 * Logger du temps sur un ticket.
 *
 * Sécurité :
 *   - Zod valide (cuid, minutes > 0 && <= 14400 = 30j, description <= 500 chars) [A03]
 *   - requireAuth() + canEditTicket() : seul un assigné/créateur/PO/Admin peut logger [A01]
 *   - Transaction : TimeEntry + mise à jour Ticket.loggedMinutes + AuditLog atomiques [A09]
 *   - La vue ticket_rollup se met à jour automatiquement (vue calculée, pas matérialisée)
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
      type: true,
      key: true,
    },
  });
  if (!ticket) return { ok: false, error: "NOT_FOUND" };

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

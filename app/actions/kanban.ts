"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth, canEditTicket } from "@/lib/auth";
import { MoveTicketSchema, type MoveTicketInput } from "@/lib/tickets/schemas";

export type MoveTicketResult =
  | { ok: true }
  | { ok: false; error: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" };

/**
 * Déplace un ticket vers une nouvelle colonne (status) et position (boardOrder).
 *
 * Sécurité :
 *   - Zod valide cuid + enum status + entier nonnegative [A03]
 *   - requireAuth() puis canEditTicket() [A01]
 *   - Transaction (update + audit) [A09]
 *
 * Performance :
 *   - Mise à jour atomique d'une seule ligne (pas de renumérotation)
 *   - Le pattern "order espacé" côté client évite les collisions sur insertion
 */
export async function moveTicketAction(input: MoveTicketInput): Promise<MoveTicketResult> {
  const session = await requireAuth();

  const parsed = MoveTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const ticket = await prisma.ticket.findUnique({
    where: { id: data.ticketId },
    select: {
      id: true,
      status: true,
      projectId: true,
      assigneeId: true,
      creatorId: true,
      key: true,
    },
  });
  if (!ticket) return { ok: false, error: "NOT_FOUND" };

  if (!(await canEditTicket(session, ticket))) {
    return { ok: false, error: "FORBIDDEN" };
  }

  // No-op : même status, même ordre → évite une écriture inutile
  if (ticket.status === data.toStatus) {
    const existing = await prisma.ticket.findUnique({
      where: { id: data.ticketId },
      select: { boardOrder: true },
    });
    if (existing?.boardOrder === data.newOrder) return { ok: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: data.ticketId },
      data: {
        status: data.toStatus,
        boardOrder: data.newOrder,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "TICKET.MOVE",
        entityType: "Ticket",
        entityId: data.ticketId,
        metadata: {
          from: ticket.status,
          to: data.toStatus,
          order: data.newOrder,
        },
      },
    });
  });

  // Le path inclut [key] : revalidate en mode path
  revalidatePath(`/projects/[key]/board`, "page");

  return { ok: true };
}

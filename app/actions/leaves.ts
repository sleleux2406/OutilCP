"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────
// Server Actions — Congés individuels
//
// Règles RBAC :
//   - Un user peut gérer ses propres congés
//   - ADMIN et PRODUCT_OWNER peuvent gérer ceux de n'importe qui
// ─────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function canManageLeavesOf(
  session: { userId: string; role: "ADMIN" | "PRODUCT_OWNER" | "DEVELOPER" | "TESTER" },
  targetUserId: string
): boolean {
  if (session.role === "ADMIN" || session.role === "PRODUCT_OWNER") return true;
  return session.userId === targetUserId;
}

// ─────────────────────────────────────────────────────────────
// Création d'un congé
// ─────────────────────────────────────────────────────────────

const CreateLeaveSchema = z
  .object({
    userId: z.string().cuid(),
    startDate: z.string().regex(ISO_DATE),
    endDate: z.string().regex(ISO_DATE),
    label: z.string().trim().max(200).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "endDate doit être >= startDate",
    path: ["endDate"],
  });

export type CreateLeaveResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "USER_NOT_FOUND"
        | "OVERLAP"
        | "RATE_LIMITED";
    };

/**
 * Crée une plage de congés pour un utilisateur.
 *
 * Sécurité :
 *   - requireAuth + canManageLeavesOf (self ou ADMIN/PO) [A01]
 *   - Zod : format date + endDate >= startDate [A03]
 *   - Détection de chevauchement avec les congés existants du même user [A04]
 *   - Rate-limit 20 créations / 5min / session [A07]
 *   - Audit log
 */
export async function createLeaveAction(
  input: z.input<typeof CreateLeaveSchema>
): Promise<CreateLeaveResult> {
  const session = await requireAuth();

  const rl = rateLimit(`leave:create:${session.userId}`, {
    limit: 20,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = CreateLeaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  if (!canManageLeavesOf(session, data.userId)) {
    return { ok: false, error: "FORBIDDEN" };
  }

  // Vérifier que l'utilisateur existe
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { id: true, name: true },
  });
  if (!user) return { ok: false, error: "USER_NOT_FOUND" };

  const startUTC = new Date(`${data.startDate}T00:00:00Z`);
  const endUTC = new Date(`${data.endDate}T00:00:00Z`);
  if (isNaN(startUTC.getTime()) || isNaN(endUTC.getTime())) {
    return { ok: false, error: "VALIDATION" };
  }

  // Détection de chevauchement : une plage existante telle que
  // existing.start <= new.end AND existing.end >= new.start
  const overlap = await prisma.userLeave.findFirst({
    where: {
      userId: data.userId,
      startDate: { lte: endUTC },
      endDate: { gte: startUTC },
    },
    select: { id: true },
  });
  if (overlap) return { ok: false, error: "OVERLAP" };

  const created = await prisma.$transaction(async (tx) => {
    const leave = await tx.userLeave.create({
      data: {
        userId: data.userId,
        startDate: startUTC,
        endDate: endUTC,
        label: data.label?.trim() || null,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "LEAVE.CREATED",
        entityType: "UserLeave",
        entityId: leave.id,
        metadata: {
          targetUserId: data.userId,
          targetUserName: user.name,
          startDate: data.startDate,
          endDate: data.endDate,
        },
      },
    });
    return leave;
  });

  revalidatePath(`/users/${data.userId}/leaves`);
  revalidatePath("/projects/[key]/board", "page");
  revalidatePath("/projects/[key]/overview", "page");
  revalidatePath("/projects/[key]/capacity", "page");

  return { ok: true, id: created.id };
}

// ─────────────────────────────────────────────────────────────
// Suppression d'un congé
// ─────────────────────────────────────────────────────────────

const DeleteLeaveSchema = z.object({
  id: z.string().cuid(),
});

export type DeleteLeaveResult =
  | { ok: true }
  | { ok: false; error: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" };

export async function deleteLeaveAction(
  input: z.input<typeof DeleteLeaveSchema>
): Promise<DeleteLeaveResult> {
  const session = await requireAuth();

  const parsed = DeleteLeaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const existing = await prisma.userLeave.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      userId: true,
      startDate: true,
      endDate: true,
      label: true,
    },
  });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  if (!canManageLeavesOf(session, existing.userId)) {
    return { ok: false, error: "FORBIDDEN" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "LEAVE.DELETED",
        entityType: "UserLeave",
        entityId: existing.id,
        metadata: {
          targetUserId: existing.userId,
          startDate: existing.startDate.toISOString().slice(0, 10),
          endDate: existing.endDate.toISOString().slice(0, 10),
          label: existing.label,
        },
      },
    });
    await tx.userLeave.delete({ where: { id: existing.id } });
  });

  revalidatePath(`/users/${existing.userId}/leaves`);
  revalidatePath("/projects/[key]/board", "page");
  revalidatePath("/projects/[key]/overview", "page");
  revalidatePath("/projects/[key]/capacity", "page");

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Liste des congés d'un utilisateur (self ou ADMIN/PO)
// ─────────────────────────────────────────────────────────────

const ListLeavesSchema = z.object({
  userId: z.string().cuid(),
});

export type ListLeavesResult =
  | {
      ok: true;
      leaves: { id: string; startDate: string; endDate: string; label: string | null }[];
    }
  | { ok: false; error: "VALIDATION" | "FORBIDDEN" };

export async function listLeavesAction(
  input: z.input<typeof ListLeavesSchema>
): Promise<ListLeavesResult> {
  const session = await requireAuth();

  const parsed = ListLeavesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  if (!canManageLeavesOf(session, parsed.data.userId)) {
    return { ok: false, error: "FORBIDDEN" };
  }

  const rows = await prisma.userLeave.findMany({
    where: { userId: parsed.data.userId },
    orderBy: { startDate: "asc" },
    select: { id: true, startDate: true, endDate: true, label: true },
  });

  return {
    ok: true,
    leaves: rows.map((r) => ({
      id: r.id,
      startDate: r.startDate.toISOString().slice(0, 10),
      endDate: r.endDate.toISOString().slice(0, 10),
      label: r.label,
    })),
  };
}

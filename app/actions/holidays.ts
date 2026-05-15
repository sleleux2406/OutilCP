"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────
// Server Actions — Gestion des jours fériés globaux
// ─────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CreateHolidaySchema = z.object({
  date: z.string().regex(ISO_DATE),
  label: z.string().trim().min(1).max(200),
});

export type CreateHolidayResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "VALIDATION" | "DUPLICATE" | "RATE_LIMITED";
    };

/**
 * Crée un jour férié global. Réservé ADMIN / PRODUCT_OWNER.
 *
 * Sécurité :
 *   - requireRole(ADMIN/PO) [A01]
 *   - Zod valide format date ISO + label borné [A03]
 *   - Rate-limit 20 créations / 5min / utilisateur [A07]
 *   - Gestion du doublon (une seule entrée par date)
 *   - Audit log
 */
export async function createHolidayAction(
  input: z.input<typeof CreateHolidaySchema>
): Promise<CreateHolidayResult> {
  const session = await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  const rl = rateLimit(`holiday:create:${session.userId}`, {
    limit: 20,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = CreateHolidaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const parsedDate = new Date(`${data.date}T00:00:00Z`);
  if (isNaN(parsedDate.getTime())) return { ok: false, error: "VALIDATION" };

  // Doublon : déjà un férié à cette date
  const existing = await prisma.holiday.findUnique({ where: { date: parsedDate } });
  if (existing) return { ok: false, error: "DUPLICATE" };

  const created = await prisma.$transaction(async (tx) => {
    const h = await tx.holiday.create({
      data: { date: parsedDate, label: data.label },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "HOLIDAY.CREATED",
        entityType: "Holiday",
        entityId: h.id,
        metadata: { date: data.date, label: data.label },
      },
    });
    return h;
  });

  revalidatePath("/admin/holidays");
  // La modification des fériés impacte potentiellement les endDate des tickets.
  // La cascade réelle sera implémentée au Lot B4 ; pour l'instant on revalide
  // le board/overview pour forcer un refresh côté UI.
  revalidatePath("/projects/[key]/board", "page");
  revalidatePath("/projects/[key]/overview", "page");
  revalidatePath("/projects/[key]/capacity", "page");

  return { ok: true, id: created.id };
}

// ─────────────────────────────────────────────────────────────
// Suppression d'un jour férié
// ─────────────────────────────────────────────────────────────

const DeleteHolidaySchema = z.object({
  id: z.string().cuid(),
});

export type DeleteHolidayResult =
  | { ok: true }
  | { ok: false; error: "VALIDATION" | "NOT_FOUND" };

export async function deleteHolidayAction(
  input: z.input<typeof DeleteHolidaySchema>
): Promise<DeleteHolidayResult> {
  const session = await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  const parsed = DeleteHolidaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const existing = await prisma.holiday.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, date: true, label: true },
  });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  await prisma.$transaction(async (tx) => {
    // Audit AVANT suppression pour conserver la trace
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "HOLIDAY.DELETED",
        entityType: "Holiday",
        entityId: existing.id,
        metadata: {
          date: existing.date.toISOString().slice(0, 10),
          label: existing.label,
        },
      },
    });
    await tx.holiday.delete({ where: { id: existing.id } });
  });

  revalidatePath("/admin/holidays");
  revalidatePath("/projects/[key]/board", "page");
  revalidatePath("/projects/[key]/overview", "page");
  revalidatePath("/projects/[key]/capacity", "page");

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Liste des jours fériés (consultation - tous utilisateurs connectés)
// ─────────────────────────────────────────────────────────────

export async function listHolidaysAction(): Promise<{
  ok: true;
  holidays: { id: string; date: string; label: string }[];
}> {
  await requireAuth();

  const rows = await prisma.holiday.findMany({
    orderBy: { date: "asc" },
    select: { id: true, date: true, label: true },
  });

  return {
    ok: true,
    holidays: rows.map((h) => ({
      id: h.id,
      date: h.date.toISOString().slice(0, 10),
      label: h.label,
    })),
  };
}

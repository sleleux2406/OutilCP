"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { TicketStatus, TicketType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { canAttach } from "@/lib/tickets/hierarchy";
import { nextTicketKey } from "@/lib/tickets/key-generator";
import { buildPath } from "@/lib/tickets/path";

// ─────────────────────────────────────────────────────────────
// Liste des parents valides (Feature + US) pour rattacher un bug
// ─────────────────────────────────────────────────────────────

const ListParentsSchema = z.object({
  projectId: z.string().cuid(),
  /** Filtre texte (key ou titre). Vide = tous, limit 50. */
  q: z.string().trim().max(200).optional(),
});

export type ParentOption = {
  id: string;
  key: string;
  title: string;
  type: TicketType;
};

export type ListParentsResult =
  | { ok: true; parents: ParentOption[] }
  | { ok: false; error: "VALIDATION" };

/**
 * Liste les tickets Feature + User Story d'un projet qui peuvent accueillir
 * un bug en enfant. Utilisé par le ParentPicker.
 *
 * Sécurité :
 *   - requireAuth() : seul un utilisateur connecté peut lister
 *   - Filtre textuel passé en contains Prisma (paramétré, pas de LIKE risqué)
 *   - Limite à 50 résultats (pas de DoS)
 */
export async function listBugParentsAction(
  input: z.input<typeof ListParentsSchema>
): Promise<ListParentsResult> {
  await requireAuth();
  const parsed = ListParentsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const { projectId, q } = parsed.data;
  const hasQuery = !!q && q.length > 0;

  const parents = await prisma.ticket.findMany({
    where: {
      projectId,
      type: { in: [TicketType.FEATURE, TicketType.USER_STORY] },
      ...(hasQuery
        ? {
            OR: [
              { key: { contains: q, mode: "insensitive" } },
              { title: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, key: true, title: true, type: true },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return { ok: true, parents };
}

// ─────────────────────────────────────────────────────────────
// Création d'un bug libre (manuel) rattaché à Feature ou US
// ─────────────────────────────────────────────────────────────

const CreateFreeBugSchema = z.object({
  projectId: z.string().cuid(),
  parentId: z.string().cuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(10_000).optional(),
  priority: z.number().int().min(1).max(5).default(3),
  estimatedMinutes: z.number().int().min(0).max(60 * 24 * 30).default(0),
});

export type CreateFreeBugResult =
  | { ok: true; bugKey: string; bugId: string }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "PARENT_NOT_FOUND"
        | "INVALID_PARENT"
        | "CROSS_PROJECT"
        | "RATE_LIMITED";
    };

/**
 * Crée un BUG manuellement, rattaché à une Feature ou une US.
 *
 * Sécurité :
 *   - Zod valide chaque champ avec des bornes strictes [A03]
 *   - canAttach() vérifie que BUG peut être enfant du parent choisi [A04]
 *   - Vérification cross-project : le parent doit appartenir au même projet
 *   - Transaction : création + audit [A08]
 */
export async function createFreeBugAction(
  input: z.input<typeof CreateFreeBugSchema>
): Promise<CreateFreeBugResult> {
  const session = await requireAuth();

  // Rate-limit : 20 bugs / 5 minutes par utilisateur (anti-spam) [A07]
  const rl = rateLimit(`bug:create:${session.userId}`, {
    limit: 20,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = CreateFreeBugSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const parent = await prisma.ticket.findUnique({
    where: { id: data.parentId },
    select: { id: true, type: true, projectId: true, path: true, key: true },
  });
  if (!parent) return { ok: false, error: "PARENT_NOT_FOUND" };
  if (parent.projectId !== data.projectId) {
    // Évite qu'un utilisateur rattache un bug à un ticket d'un autre projet
    return { ok: false, error: "CROSS_PROJECT" };
  }
  if (!canAttach(parent.type, TicketType.BUG)) {
    return { ok: false, error: "INVALID_PARENT" };
  }

  const bug = await prisma.$transaction(async (tx) => {
    const key = await nextTicketKey(tx, data.projectId);
    const created = await tx.ticket.create({
      data: {
        key,
        projectId: data.projectId,
        type: TicketType.BUG,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        estimatedMinutes: data.estimatedMinutes,
        status: TicketStatus.TODO,
        parentId: parent.id,
        path: buildPath(parent.path, parent.id),
        creatorId: session.userId,
      },
      select: { id: true, key: true },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "BUG.MANUAL_CREATED",
        entityType: "Ticket",
        entityId: created.id,
        metadata: {
          parentId: parent.id,
          parentKey: parent.key,
          parentType: parent.type,
        },
      },
    });

    return created;
  });

  revalidatePath(`/projects/[key]/board`, "page");
  revalidatePath(`/tickets/${bug.key}`);

  return { ok: true, bugKey: bug.key, bugId: bug.id };
}

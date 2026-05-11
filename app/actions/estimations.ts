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
import { daysToMinutes, MINUTES_PER_DAY } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Server Actions — Sessions d'estimation
//
// Une session consiste à décomposer une Feature en plusieurs Tasks avec
// estimation. N'importe quel rôle connecté peut lancer une session.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Liste des Features à estimer
// ─────────────────────────────────────────────────────────────

export type FeatureToEstimate = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: number;
  project: { key: string; name: string };
  parent: { key: string; title: string } | null;
  assignee: { id: string; name: string } | null;
  createdAt: string;
};

export type ListToEstimateResult =
  | { ok: true; features: FeatureToEstimate[] }
  | { ok: false; error: "VALIDATION" };

/**
 * Liste toutes les Features qui n'ont aucun enfant Task ou Bug.
 * Ce sont les Features "à estimer" : la session d'estimation doit être
 * lancée dessus pour les décomposer en Tasks.
 *
 * Sécurité :
 *   - requireAuth : tout utilisateur connecté peut consulter la liste
 *   - Pas de filtre projet : vue globale cross-projet (la CP pilote tout)
 */
export async function listFeaturesToEstimateAction(): Promise<ListToEstimateResult> {
  await requireAuth();

  const rows = await prisma.ticket.findMany({
    where: {
      type: TicketType.FEATURE,
      children: {
        none: {
          OR: [{ type: TicketType.TASK }, { type: TicketType.BUG }],
        },
      },
    },
    select: {
      id: true,
      key: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      createdAt: true,
      project: { select: { key: true, name: true } },
      parent: { select: { key: true, title: true } },
      assignee: { select: { id: true, name: true } },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  return {
    ok: true,
    features: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// Création groupée de Tasks lors d'une session d'estimation
// ─────────────────────────────────────────────────────────────

const TaskInputSchema = z.object({
  title: z.string().trim().min(3).max(200),
  estimatedDays: z.number().positive().max(30),
  description: z.string().trim().max(5000).optional(),
});

const EstimateFeatureSchema = z.object({
  featureId: z.string().cuid(),
  tasks: z.array(TaskInputSchema).min(1).max(50),
});

export type EstimateFeatureResult =
  | { ok: true; createdCount: number; taskKeys: string[] }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FEATURE_NOT_FOUND"
        | "NOT_A_FEATURE"
        | "ALREADY_ESTIMATED"
        | "RATE_LIMITED";
    };

/**
 * Termine une session d'estimation : crée en batch toutes les Tasks enfants
 * d'une Feature, dans une seule transaction.
 *
 * Règles :
 *   - La Feature doit exister et être de type FEATURE
 *   - Elle ne doit pas déjà avoir de Task/Bug enfant (sinon ALREADY_ESTIMATED)
 *   - Entre 1 et 50 Tasks par session, chacune avec titre et estimation en jours
 *   - Les Tasks créées ont remainingMinutes = estimatedMinutes (auto-sync à froid)
 *   - Audit log par task + audit session globale
 *
 * Sécurité :
 *   - requireAuth (tout rôle peut estimer, cf. spec métier)
 *   - Zod strict : entre 1 et 50 tâches, champs bornés
 *   - Rate-limit 10 sessions / 10 min
 *   - Transaction atomique
 */
export async function estimateFeatureAction(
  input: z.input<typeof EstimateFeatureSchema>
): Promise<EstimateFeatureResult> {
  const session = await requireAuth();

  const rl = rateLimit(`estimation:${session.userId}`, {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = EstimateFeatureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const feature = await prisma.ticket.findUnique({
    where: { id: data.featureId },
    select: {
      id: true,
      key: true,
      type: true,
      projectId: true,
      path: true,
      children: { select: { type: true }, take: 1 },
    },
  });
  if (!feature) return { ok: false, error: "FEATURE_NOT_FOUND" };
  if (feature.type !== TicketType.FEATURE) {
    return { ok: false, error: "NOT_A_FEATURE" };
  }

  // Si des Task/Bug enfants existent déjà → refus pour éviter les doublons
  const hasTaskOrBug = feature.children.some(
    (c) => c.type === TicketType.TASK || c.type === TicketType.BUG
  );
  if (hasTaskOrBug) return { ok: false, error: "ALREADY_ESTIMATED" };

  // Vérif de cohérence avec les règles de hiérarchie
  if (!canAttach(feature.type, TicketType.TASK)) {
    return { ok: false, error: "VALIDATION" };
  }

  // Création batch en transaction
  const childPath = buildPath(feature.path, feature.id);

  const result = await prisma.$transaction(async (tx) => {
    const createdTasks: { id: string; key: string }[] = [];

    for (const t of data.tasks) {
      const minutes = Math.min(
        daysToMinutes(t.estimatedDays),
        30 * MINUTES_PER_DAY
      );
      const key = await nextTicketKey(tx, feature.projectId);
      const created = await tx.ticket.create({
        data: {
          key,
          projectId: feature.projectId,
          type: TicketType.TASK,
          title: t.title,
          description: t.description ?? null,
          status: TicketStatus.BACKLOG,
          priority: 3,
          parentId: feature.id,
          path: childPath,
          estimatedMinutes: minutes,
          // Règle métier : à froid, RAF = estimation
          remainingMinutes: minutes,
          creatorId: session.userId,
        },
        select: { id: true, key: true },
      });
      createdTasks.push(created);

      await tx.auditLog.create({
        data: {
          userId: session.userId,
          action: "TASK.CREATED_FROM_ESTIMATION",
          entityType: "Ticket",
          entityId: created.id,
          metadata: {
            featureId: feature.id,
            featureKey: feature.key,
            estimatedMinutes: minutes,
          },
        },
      });
    }

    // Audit log global de la session
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "FEATURE.ESTIMATION_COMPLETED",
        entityType: "Ticket",
        entityId: feature.id,
        metadata: {
          taskCount: createdTasks.length,
          totalMinutes: data.tasks.reduce(
            (sum, t) => sum + daysToMinutes(t.estimatedDays),
            0
          ),
        },
      },
    });

    return createdTasks;
  });

  revalidatePath("/estimations");
  revalidatePath("/projects/[key]/board", "page");
  revalidatePath("/projects/[key]/overview", "page");
  revalidatePath(`/tickets/${feature.key}`);

  return {
    ok: true,
    createdCount: result.length,
    taskKeys: result.map((t) => t.key),
  };
}

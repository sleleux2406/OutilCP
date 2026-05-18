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
 * Liste toutes les Features qui ne sont pas encore estimées :
 *   - aucun enfant Task ou Bug
 *   - ET pas d'estimation initiale saisie manuellement (estimatedMinutes = 0)
 *   - ET appartenant a un projet RACINE (pas un sous-projet RUN)
 *
 * Sécurité :
 *   - requireAuth : tout utilisateur connecté peut consulter la liste
 *   - Pas de filtre projet : vue globale cross-projet (la CP pilote tout)
 *
 * Note : les Features des sous-projets RUN sont volontairement exclues car
 * elles representent du contenu fige (specs deja estimees) qui n'a pas a etre
 * re-estime dans le projet principal. Les Bugs RUN escalades restent listes
 * separement via listBugsToEstimateAction().
 */
export async function listFeaturesToEstimateAction(): Promise<ListToEstimateResult> {
  await requireAuth();

  const rows = await prisma.ticket.findMany({
    where: {
      type: TicketType.FEATURE,
      estimatedMinutes: 0,
      children: {
        none: {
          OR: [{ type: TicketType.TASK }, { type: TicketType.BUG }],
        },
      },
      // Exclut les Features des sous-projets RUN (project.parentProjectId != null)
      project: { parentProjectId: null },
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
      versionSpecsCourante: true,
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
          // Module 1.1 : heritage de la version des specs depuis la Feature
          versionSpecsOriginelle: feature.versionSpecsCourante,
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

// ─────────────────────────────────────────────────────────────
// Bugs RUN à estimer
// Lister les Bugs qui viennent d'un sous-projet RUN (project.parentProjectId != null)
// et qui n'ont pas encore d'estimation propre ni de Task chiffree enfant.
// ─────────────────────────────────────────────────────────────

export interface BugToEstimate {
  id: string;
  key: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: number;
  estimatedMinutes: number;
  loggedMinutes: number;
  createdAt: string;
  project: {
    key: string;
    name: string;
    parentProject: { key: string; name: string } | null;
  };
  parent: { key: string; title: string } | null;
  assignee: { id: string; name: string } | null;
}

export type ListBugsToEstimateResult =
  | { ok: true; bugs: BugToEstimate[] }
  | { ok: false; error: "VALIDATION" };

/**
 * Liste les Bugs RUN ouverts non encore estimes.
 * Critères :
 *   - type = BUG
 *   - estimatedMinutes = 0 (pas d'estim propre)
 *   - aucune Task chiffree enfant (sinon il est deja decompose en mode container)
 *   - statut non terminal (TODO, IN_PROGRESS, ou tout sauf DONE/BLOCKED)
 *   - project.parentProjectId != null (= sous-projet RUN)
 *   - pas encore de log de temps direct (loggedMinutes = 0) car sinon
 *     l'estim est verrouillee par computeEstimationEditability (HOT mode)
 */
export async function listBugsToEstimateAction(): Promise<ListBugsToEstimateResult> {
  await requireAuth();

  const rows = await prisma.ticket.findMany({
    where: {
      type: TicketType.BUG,
      estimatedMinutes: 0,
      loggedMinutes: 0,
      status: { notIn: [TicketStatus.DONE, TicketStatus.BLOCKED] },
      // Pas de Task chiffree enfant (deja decompose = ne plus apparaitre ici)
      children: {
        none: {
          AND: [{ type: TicketType.TASK }, { isEstimated: true }],
        },
      },
      // Sous-projet RUN uniquement
      project: { parentProjectId: { not: null } },
    },
    select: {
      id: true,
      key: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      estimatedMinutes: true,
      loggedMinutes: true,
      createdAt: true,
      project: {
        select: {
          key: true,
          name: true,
          parentProject: { select: { key: true, name: true } },
        },
      },
      parent: { select: { key: true, title: true } },
      assignee: { select: { id: true, name: true } },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  return {
    ok: true,
    bugs: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// Saisie directe d'une estimation sur un Bug (estimateBugSimpleAction)
// Pour les cas ou la decomposition en Tasks n'est pas necessaire :
// on attribue juste une duree au Bug, qui restera en mode feuille.
// ─────────────────────────────────────────────────────────────

const EstimateBugSimpleSchema = z.object({
  bugId: z.string().cuid(),
  estimatedDays: z.number().positive().max(30),
});

export type EstimateBugSimpleResult =
  | { ok: true; bugKey: string; estimatedMinutes: number }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "BUG_NOT_FOUND"
        | "NOT_A_BUG"
        | "ALREADY_ESTIMATED"
        | "ALREADY_LOGGED"
        | "RATE_LIMITED";
    };

export async function estimateBugSimpleAction(
  input: z.input<typeof EstimateBugSimpleSchema>
): Promise<EstimateBugSimpleResult> {
  const session = await requireAuth();

  const rl = rateLimit(`estimation:bug:${session.userId}`, {
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = EstimateBugSimpleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const bug = await prisma.ticket.findUnique({
    where: { id: data.bugId },
    select: {
      id: true,
      key: true,
      type: true,
      estimatedMinutes: true,
      loggedMinutes: true,
    },
  });
  if (!bug) return { ok: false, error: "BUG_NOT_FOUND" };
  if (bug.type !== TicketType.BUG) return { ok: false, error: "NOT_A_BUG" };
  if (bug.estimatedMinutes > 0) return { ok: false, error: "ALREADY_ESTIMATED" };
  if (bug.loggedMinutes > 0) return { ok: false, error: "ALREADY_LOGGED" };

  // Bornage : 1 jour = 480 min, max 30 jours
  const minutes = Math.min(daysToMinutes(data.estimatedDays), 30 * MINUTES_PER_DAY);

  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: bug.id },
      data: {
        estimatedMinutes: minutes,
        // Regle a froid : RAF = estim
        remainingMinutes: minutes,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "BUG.ESTIMATED",
        entityType: "Ticket",
        entityId: bug.id,
        metadata: {
          estimatedMinutes: minutes,
          estimatedDays: data.estimatedDays,
        },
      },
    });
  });

  revalidatePath("/estimations");
  revalidatePath("/projects/[key]/board", "page");
  revalidatePath("/projects/[key]/overview", "page");
  revalidatePath(`/tickets/${bug.key}`);

  return { ok: true, bugKey: bug.key, estimatedMinutes: minutes };
}

// ─────────────────────────────────────────────────────────────
// Decomposition d'un Bug en Tasks (estimateBugDecomposeAction)
// Reutilise la meme logique que estimateFeatureAction mais pour un Bug parent.
// Le Bug bascule en mode container des qu'une Task chiffree est creee (Lot C1).
// ─────────────────────────────────────────────────────────────

const EstimateBugDecomposeSchema = z.object({
  bugId: z.string().cuid(),
  tasks: z.array(TaskInputSchema).min(1).max(50),
});

export type EstimateBugDecomposeResult =
  | { ok: true; createdCount: number; taskKeys: string[] }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "BUG_NOT_FOUND"
        | "NOT_A_BUG"
        | "ALREADY_DECOMPOSED"
        | "ALREADY_LOGGED"
        | "RATE_LIMITED";
    };

export async function estimateBugDecomposeAction(
  input: z.input<typeof EstimateBugDecomposeSchema>
): Promise<EstimateBugDecomposeResult> {
  const session = await requireAuth();

  const rl = rateLimit(`estimation:bug-decompose:${session.userId}`, {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = EstimateBugDecomposeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const bug = await prisma.ticket.findUnique({
    where: { id: data.bugId },
    select: {
      id: true,
      key: true,
      type: true,
      projectId: true,
      path: true,
      loggedMinutes: true,
      versionSpecsCourante: true,
      versionSpecsOriginelle: true,
      children: {
        select: { type: true, isEstimated: true },
        take: 50,
      },
    },
  });
  if (!bug) return { ok: false, error: "BUG_NOT_FOUND" };
  if (bug.type !== TicketType.BUG) return { ok: false, error: "NOT_A_BUG" };

  // Si une Task chiffree existe deja sous ce Bug, on refuse
  // (le Bug est deja en mode container, l'utilisateur doit ajouter ses Tasks
  // une par une via la page detail du Bug).
  const hasChiffredTaskChild = bug.children.some(
    (c) => c.type === TicketType.TASK && c.isEstimated
  );
  if (hasChiffredTaskChild) {
    return { ok: false, error: "ALREADY_DECOMPOSED" };
  }

  // Si du temps a deja ete logge sur le Bug, on bloque la decomposition
  // car le Bug serait deja gele et le passage en mode container est ambigu.
  if (bug.loggedMinutes > 0) {
    return { ok: false, error: "ALREADY_LOGGED" };
  }

  // Verifie que canAttach(BUG, TASK) = true (devrait etre vrai depuis Lot C0)
  if (!canAttach(TicketType.BUG, TicketType.TASK)) {
    return { ok: false, error: "VALIDATION" };
  }

  // Calcule le path enfant une seule fois
  const childPath = buildPath(bug.path, bug.id);

  const result = await prisma.$transaction(async (tx) => {
    const createdTasks: { id: string; key: string }[] = [];

    for (const t of data.tasks) {
      const minutes = Math.min(
        daysToMinutes(t.estimatedDays),
        30 * MINUTES_PER_DAY
      );
      const key = await nextTicketKey(tx, bug.projectId);
      const created = await tx.ticket.create({
        data: {
          key,
          projectId: bug.projectId,
          type: TicketType.TASK,
          title: t.title,
          description: t.description ?? null,
          status: TicketStatus.BACKLOG,
          priority: 3,
          parentId: bug.id,
          path: childPath,
          estimatedMinutes: minutes,
          remainingMinutes: minutes,
          creatorId: session.userId,
          // Module 1.1 : heritage version specs (le Bug parent peut avoir
          // versionSpecsCourante ou versionSpecsOriginelle s'il est lui-meme un enfant)
          versionSpecsOriginelle:
            bug.versionSpecsCourante ?? bug.versionSpecsOriginelle ?? null,
        },
        select: { id: true, key: true },
      });
      createdTasks.push(created);

      await tx.auditLog.create({
        data: {
          userId: session.userId,
          action: "TASK.CREATED_FROM_BUG_DECOMPOSITION",
          entityType: "Ticket",
          entityId: created.id,
          metadata: { bugId: bug.id, bugKey: bug.key, estimatedMinutes: minutes },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "BUG.DECOMPOSED",
        entityType: "Ticket",
        entityId: bug.id,
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
  revalidatePath(`/tickets/${bug.key}`);

  return {
    ok: true,
    createdCount: result.length,
    taskKeys: result.map((t) => t.key),
  };
}

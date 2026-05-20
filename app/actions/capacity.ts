"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { getProjectRollups } from "@/lib/time-rollup";
import {
  computeCapacityForWeeks,
  startOfWeekUTC,
  type DeveloperLeaves,
  type WeekCapacity,
} from "@/lib/capacity/etp";
import {
  placeP1Tickets,
  type P1Ticket,
  type Allocation,
} from "@/lib/capacity/placement";

// ─────────────────────────────────────────────────────────────
// getCapacityViewAction
// Charge tout ce qu'il faut pour afficher la vue Capacity Planning
// d'un projet : developpeurs, conges, feries, tickets P1, plan existant.
// ─────────────────────────────────────────────────────────────

const GetViewSchema = z.object({
  projectKey: z.string().min(1),
  /** Nombre de semaines à projeter (défaut 12) */
  weeksCount: z.number().int().min(1).max(52).optional(),
});

export interface CapacityViewWeek extends WeekCapacity {
  /** Allocations placées dans cette semaine (issues du plan existant ou vide) */
  allocations: CapacityViewAllocation[];
}

export interface CapacityViewAllocation {
  ticketId: string;
  ticketKey: string;
  title: string;
  type: "TASK" | "BUG" | "FEATURE";
  allocatedMinutes: number;
  position: number;
}

export interface CapacityViewP1Ticket {
  id: string;
  key: string;
  title: string;
  type: "TASK" | "BUG" | "FEATURE";
  status: string;
  estimatedMinutes: number;
  createdAt: string; // ISO
  parentKey: string | null;
}

export type GetCapacityViewResult =
  | {
      ok: true;
      project: { id: string; key: string; name: string };
      weeks: CapacityViewWeek[];
      p1Tickets: CapacityViewP1Ticket[];
      hasPlan: boolean;
      planGeneratedAt: string | null;
      projectedEndDate: string | null;
      leftoverMinutes: number;
      /** ISO du dernier ajout/suppression de congé ou férié (toutes équipes confondues) */
      lastDataChangeAt: string | null;
      /** True si planGeneratedAt < lastDataChangeAt → le plan ne reflète plus les données actuelles */
      isPlanStale: boolean;
    }
  | { ok: false; error: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" };

export async function getCapacityViewAction(
  input: z.input<typeof GetViewSchema>
): Promise<GetCapacityViewResult> {
  await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  const parsed = GetViewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const { projectKey, weeksCount = 12 } = parsed.data;

  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: { id: true, key: true, name: true, parentProjectId: true },
  });
  if (!project) return { ok: false, error: "NOT_FOUND" };

  // Multi-projet : pour la capacite, on prend les developpeurs MEMBRES du
  // projet (ou de son projet parent si c'est un RUN). Les RUN heritent des
  // membres du parent.
  const projectIdForMembers = project.parentProjectId ?? project.id;

  // 1. Developpeurs membres du projet (role DEVELOPER + membership)
  const developers = await prisma.user.findMany({
    where: {
      role: "DEVELOPER",
      deletedAt: null,
      projectMemberships: {
        some: { projectId: projectIdForMembers },
      },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const devIds = developers.map((d) => d.id);

  // 2. Congés des développeurs (toutes plages, on filtrera par semaine côté lib)
  const leavesRaw = devIds.length
    ? await prisma.userLeave.findMany({
        where: { userId: { in: devIds } },
        select: { userId: true, startDate: true, endDate: true },
      })
    : [];

  // 3. Jours fériés globaux
  const holidaysRaw = await prisma.holiday.findMany({
    select: { date: true },
  });
  const holidays = holidaysRaw.map((h) => h.date);

  // 4. Tickets P1 du projet (priority=1, statut non terminal, types pertinents)
  const tickets = await prisma.ticket.findMany({
    where: {
      projectId: project.id,
      priority: 1,
      status: { notIn: ["DONE", "BLOCKED"] },
      type: { in: ["TASK", "BUG", "FEATURE"] },
      isEstimated: true,
    },
    select: {
      id: true,
      key: true,
      title: true,
      type: true,
      status: true,
      estimatedMinutes: true,
      createdAt: true,
      parent: { select: { id: true, key: true, type: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // 5. Charge les rollups (utilises pour Feature et Bug container)
  // ainsi que le statut container pour decider du mode d'affichage.
  const rollups = await getProjectRollups(project.id);

  const p1Tickets: CapacityViewP1Ticket[] = tickets
    .filter((t) => {
      // Lot C1 : exclure les Tasks dont le parent est un Bug container
      // (deja absorbees dans le rollup du Bug parent, eviter double comptage).
      if (t.type === "TASK" && t.parent?.type === "BUG") {
        const parentRollup = rollups.get(t.parent.id);
        if (parentRollup?.isContainer) return false;
      }
      return true;
    })
    .map((t) => {
      // Pour FEATURE : toujours utiliser le rollup (mode container historique)
      // Pour BUG : utiliser le rollup uniquement si c'est un container, sinon estim propre
      // Pour TASK : toujours estim propre
      const rollup = rollups.get(t.id);
      let effort: number;
      if (t.type === "FEATURE") {
        effort = rollup?.totalEstimatedMinutes ?? 0;
      } else if (t.type === "BUG" && rollup?.isContainer) {
        effort = rollup.totalEstimatedMinutes;
      } else {
        effort = t.estimatedMinutes ?? 0;
      }
      return {
        id: t.id,
        key: t.key,
        title: t.title,
        type: t.type as "TASK" | "BUG" | "FEATURE",
        status: t.status,
        estimatedMinutes: effort,
        createdAt: t.createdAt.toISOString(),
        parentKey: t.parent?.key ?? null,
      };
    })
    // On exclut les tickets à 0 minute (pas chiffrés réellement) du listing P1
    .filter((t) => t.estimatedMinutes > 0);

  // 6. Calcul de la capacité hebdomadaire
  const developersWithLeaves: DeveloperLeaves[] = developers.map((d) => ({
    userId: d.id,
    name: d.name,
    leaves: leavesRaw
      .filter((l) => l.userId === d.id)
      .map((l) => ({ startDate: l.startDate, endDate: l.endDate })),
  }));

  const startMonday = startOfWeekUTC(new Date());
  const weeksCapacity = computeCapacityForWeeks(
    startMonday,
    weeksCount,
    developersWithLeaves,
    holidays
  );

  // 7. Plan existant (s'il y en a un, on remonte ses allocations)
  const existingPlan = await prisma.capacityPlan.findUnique({
    where: { projectId: project.id },
    select: {
      id: true,
      generatedAt: true,
      projectedEndDate: true,
      leftoverMinutes: true,
      items: {
        select: {
          ticketId: true,
          weekStart: true,
          allocatedMinutes: true,
          position: true,
          ticket: {
            select: { key: true, title: true, type: true },
          },
        },
      },
    },
  });

  // 8. Construction des semaines avec leurs allocations (si plan existe)
  const allocByWeek = new Map<string, CapacityViewAllocation[]>();
  if (existingPlan) {
    for (const item of existingPlan.items) {
      const wkKey = item.weekStart.toISOString();
      const list = allocByWeek.get(wkKey) ?? [];
      list.push({
        ticketId: item.ticketId,
        ticketKey: item.ticket.key,
        title: item.ticket.title,
        type: item.ticket.type as "TASK" | "BUG" | "FEATURE",
        allocatedMinutes: item.allocatedMinutes,
        position: item.position,
      });
      allocByWeek.set(wkKey, list);
    }
  }

  const weeks: CapacityViewWeek[] = weeksCapacity.map((w) => {
    const allocations = (allocByWeek.get(w.weekStart.toISOString()) ?? []).sort(
      (a, b) => a.position - b.position
    );
    return { ...w, allocations };
  });

  // 9. Calcul de la fraicheur des donnees : on cherche le timestamp le plus
  // recent parmi les ajouts (Holiday.createdAt + UserLeave.createdAt) et les
  // suppressions tracees dans AuditLog (HOLIDAY.DELETED + LEAVE.DELETED).
  // Si planGeneratedAt < lastDataChangeAt, le plan est obsolete.
  const [latestHoliday, latestLeave, latestDeletion] = await Promise.all([
    prisma.holiday.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    devIds.length
      ? prisma.userLeave.findFirst({
          where: { userId: { in: devIds } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
      : Promise.resolve(null),
    prisma.auditLog.findFirst({
      where: { action: { in: ["HOLIDAY.DELETED", "LEAVE.DELETED"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const candidates: Date[] = [];
  if (latestHoliday) candidates.push(latestHoliday.createdAt);
  if (latestLeave) candidates.push(latestLeave.createdAt);
  if (latestDeletion) candidates.push(latestDeletion.createdAt);
  const lastDataChange =
    candidates.length > 0
      ? new Date(Math.max(...candidates.map((d) => d.getTime())))
      : null;

  const isPlanStale =
    !!existingPlan &&
    !!lastDataChange &&
    existingPlan.generatedAt.getTime() < lastDataChange.getTime();

  return {
    ok: true,
    project,
    weeks,
    p1Tickets,
    hasPlan: !!existingPlan,
    planGeneratedAt: existingPlan?.generatedAt.toISOString() ?? null,
    projectedEndDate: existingPlan?.projectedEndDate?.toISOString() ?? null,
    leftoverMinutes: existingPlan?.leftoverMinutes ?? 0,
    lastDataChangeAt: lastDataChange?.toISOString() ?? null,
    isPlanStale,
  };
}

// ─────────────────────────────────────────────────────────────
// autoPlaceP1Action
// Calcule un placement automatique des P1 dans la capacité disponible
// puis persiste le résultat dans CapacityPlan + CapacityPlanItem.
// Écrase tout plan existant pour ce projet.
// ─────────────────────────────────────────────────────────────

const AutoPlaceSchema = z.object({
  projectKey: z.string().min(1),
  weeksCount: z.number().int().min(1).max(52).optional(),
});

export type AutoPlaceP1Result =
  | {
      ok: true;
      planId: string;
      allocationsCount: number;
      projectedEndDate: string | null;
      leftoverMinutes: number;
      unplacedTicketsCount: number;
    }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "RATE_LIMITED"
        | "NO_DEVELOPERS";
    };

export async function autoPlaceP1Action(
  input: z.input<typeof AutoPlaceSchema>
): Promise<AutoPlaceP1Result> {
  const session = await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  const rl = rateLimit(`capacity:autoplace:${session.userId}`, {
    limit: 20,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = AutoPlaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const { projectKey, weeksCount = 12 } = parsed.data;

  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: { id: true, key: true, name: true, parentProjectId: true },
  });
  if (!project) return { ok: false, error: "NOT_FOUND" };

  // Multi-projet : on filtre les devs par membership (heritage RUN <- parent)
  const projectIdForMembers = project.parentProjectId ?? project.id;

  // Charge devs membres du projet + leaves + holidays
  const developers = await prisma.user.findMany({
    where: {
      role: "DEVELOPER",
      deletedAt: null,
      projectMemberships: {
        some: { projectId: projectIdForMembers },
      },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (developers.length === 0) {
    return { ok: false, error: "NO_DEVELOPERS" };
  }

  const devIds = developers.map((d) => d.id);
  const leavesRaw = await prisma.userLeave.findMany({
    where: { userId: { in: devIds } },
    select: { userId: true, startDate: true, endDate: true },
  });
  const holidaysRaw = await prisma.holiday.findMany({
    select: { date: true },
  });
  const holidays = holidaysRaw.map((h) => h.date);

  // Charge les P1 du projet (mêmes critères que getCapacityViewAction)
  const tickets = await prisma.ticket.findMany({
    where: {
      projectId: project.id,
      priority: 1,
      status: { notIn: ["DONE", "BLOCKED"] },
      type: { in: ["TASK", "BUG", "FEATURE"] },
      isEstimated: true,
    },
    select: {
      id: true,
      key: true,
      title: true,
      type: true,
      estimatedMinutes: true,
      createdAt: true,
      parent: { select: { id: true, type: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const rollups = await getProjectRollups(project.id);

  const p1Tickets: P1Ticket[] = tickets
    .filter((t) => {
      // Lot C1 : exclure les Tasks dont le parent est un Bug container
      if (t.type === "TASK" && t.parent?.type === "BUG") {
        const parentRollup = rollups.get(t.parent.id);
        if (parentRollup?.isContainer) return false;
      }
      return true;
    })
    .map((t) => {
      const rollup = rollups.get(t.id);
      let effort: number;
      if (t.type === "FEATURE") {
        effort = rollup?.totalEstimatedMinutes ?? 0;
      } else if (t.type === "BUG" && rollup?.isContainer) {
        effort = rollup.totalEstimatedMinutes;
      } else {
        effort = t.estimatedMinutes ?? 0;
      }
      return {
        id: t.id,
        key: t.key,
        title: t.title,
        type: t.type as "TASK" | "BUG" | "FEATURE",
        estimatedMinutes: effort,
        createdAt: t.createdAt,
      };
    })
    .filter((t) => t.estimatedMinutes > 0);

  // Calcule la capacité
  const developersWithLeaves: DeveloperLeaves[] = developers.map((d) => ({
    userId: d.id,
    name: d.name,
    leaves: leavesRaw
      .filter((l) => l.userId === d.id)
      .map((l) => ({ startDate: l.startDate, endDate: l.endDate })),
  }));

  const startMonday = startOfWeekUTC(new Date());
  const weeksCapacity = computeCapacityForWeeks(
    startMonday,
    weeksCount,
    developersWithLeaves,
    holidays
  );

  // Algorithme de placement
  const result = placeP1Tickets(weeksCapacity, p1Tickets);

  // Persistance : on écrase le plan existant si présent, puis on recrée
  const planId = await prisma.$transaction(async (tx) => {
    // Supprime l'ancien plan (CASCADE supprime les items)
    await tx.capacityPlan.deleteMany({ where: { projectId: project.id } });

    // Crée le nouveau plan
    const plan = await tx.capacityPlan.create({
      data: {
        projectId: project.id,
        generatedById: session.userId,
        projectedEndDate: result.projectedEndDate,
        leftoverMinutes: result.leftoverMinutes,
        weeksCount,
      },
      select: { id: true },
    });

    // Crée tous les items en batch
    if (result.allocations.length > 0) {
      await tx.capacityPlanItem.createMany({
        data: result.allocations.map((a: Allocation) => ({
          planId: plan.id,
          ticketId: a.ticketId,
          weekStart: a.weekStart,
          allocatedMinutes: a.allocatedMinutes,
          position: a.position,
        })),
      });
    }

    // Audit log : tracabilité de qui a generé le plan, quand, sur quel projet
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "CAPACITY.AUTO_PLACED",
        entityType: "CapacityPlan",
        entityId: plan.id,
        metadata: {
          projectId: project.id,
          projectKey: project.key,
          weeksCount,
          allocationsCount: result.allocations.length,
          unplacedTicketsCount: result.unplacedTickets.length,
          leftoverMinutes: result.leftoverMinutes,
          projectedEndDate: result.projectedEndDate?.toISOString() ?? null,
        },
      },
    });

    return plan.id;
  });

  // Revalidation de la page capacity du projet
  revalidatePath(`/projects/${project.key}/capacity`);

  return {
    ok: true,
    planId,
    allocationsCount: result.allocations.length,
    projectedEndDate: result.projectedEndDate?.toISOString() ?? null,
    leftoverMinutes: result.leftoverMinutes,
    unplacedTicketsCount: result.unplacedTickets.length,
  };
}

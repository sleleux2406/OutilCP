"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { TicketStatus, TicketType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, canEditTicket } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { canAttach, ALLOWED_PARENTS } from "@/lib/tickets/hierarchy";
import { nextTicketKey } from "@/lib/tickets/key-generator";
import { buildPath } from "@/lib/tickets/path";

// ─────────────────────────────────────────────────────────────
// RBAC : qui peut créer quel type de ticket
// ─────────────────────────────────────────────────────────────

const TYPE_PERMISSIONS: Record<TicketType, ("ADMIN" | "PRODUCT_OWNER" | "DEVELOPER" | "TESTER")[]> = {
  EPIC: ["ADMIN", "PRODUCT_OWNER"],
  FEATURE: ["ADMIN", "PRODUCT_OWNER"],
  USER_STORY: ["ADMIN", "PRODUCT_OWNER", "DEVELOPER"],
  TASK: ["ADMIN", "PRODUCT_OWNER", "DEVELOPER"],
  BUG: ["ADMIN", "PRODUCT_OWNER", "DEVELOPER", "TESTER"],
};

// ─────────────────────────────────────────────────────────────
// Liste des parents possibles selon le type d'enfant
// ─────────────────────────────────────────────────────────────

const ListParentsSchema = z.object({
  projectId: z.string().cuid(),
  childType: z.nativeEnum(TicketType),
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
 * Liste les parents possibles pour un type de ticket enfant donné.
 *
 * Sécurité :
 *   - requireAuth() [A01]
 *   - Limite 50 résultats (anti-DoS) [A05]
 *   - Filtrage strict par type de parent autorisé [A04]
 */
export async function listPotentialParentsAction(
  input: z.input<typeof ListParentsSchema>
): Promise<ListParentsResult> {
  await requireAuth();
  const parsed = ListParentsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const { projectId, childType, q } = parsed.data;
  const allowedParentTypes = ALLOWED_PARENTS[childType];

  // Si le type n'admet pas de parent (ex: EPIC), on retourne liste vide
  if (allowedParentTypes.length === 0) {
    return { ok: true, parents: [] };
  }

  const hasQuery = !!q && q.length > 0;

  const parents = await prisma.ticket.findMany({
    where: {
      projectId,
      type: { in: allowedParentTypes },
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
// Création d'un ticket (Epic, Feature, User Story, Task)
// ─────────────────────────────────────────────────────────────

const CreateTicketSchema = z
  .object({
    projectId: z.string().cuid(),
    type: z.enum(["EPIC", "FEATURE", "USER_STORY", "TASK"]),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(10_000).optional(),
    parentId: z.string().cuid().nullable().optional(),
    priority: z.number().int().min(1).max(5).default(3),
    estimatedMinutes: z.number().int().min(0).max(60 * 24 * 30).default(0),
    assigneeId: z.string().cuid().nullable().optional(),
  })
  // Validation : EPIC ne doit pas avoir de parentId, les autres types doivent en avoir un
  .refine(
    (data) => {
      if (data.type === "EPIC") return !data.parentId;
      return !!data.parentId;
    },
    { message: "Le parent est obligatoire sauf pour les Epics" }
  );

export type CreateTicketResult =
  | { ok: true; ticketKey: string; ticketId: string }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "PARENT_NOT_FOUND"
        | "INVALID_PARENT"
        | "CROSS_PROJECT"
        | "RATE_LIMITED";
    };

/**
 * Crée un ticket (Epic, Feature, User Story, ou Task) avec validation complète.
 *
 * Sécurité :
 *   - requireAuth() [A01]
 *   - RBAC par type de ticket (TYPE_PERMISSIONS) [A01]
 *   - Rate-limit 20/5min [A07]
 *   - Zod stricte + refine règle métier [A03/A04]
 *   - canAttach() pour la hiérarchie [A04]
 *   - Cross-project check pour empêcher rattachement externe [A01]
 *   - Transaction atomique + audit [A08/A09]
 */
export async function createTicketAction(
  input: z.input<typeof CreateTicketSchema>
): Promise<CreateTicketResult> {
  const session = await requireAuth();

  // Rate-limit anti-spam
  const rl = rateLimit(`ticket:create:${session.userId}`, {
    limit: 20,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  // Validation Zod
  const parsed = CreateTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  // RBAC par type
  const allowedRoles = TYPE_PERMISSIONS[data.type];
  if (!allowedRoles.includes(session.role)) {
    return { ok: false, error: "FORBIDDEN" };
  }

  // Vérification du parent si applicable
  let parent: {
    id: string;
    type: TicketType;
    projectId: string;
    path: string;
    key: string;
  } | null = null;

  if (data.parentId) {
    parent = await prisma.ticket.findUnique({
      where: { id: data.parentId },
      select: { id: true, type: true, projectId: true, path: true, key: true },
    });
    if (!parent) return { ok: false, error: "PARENT_NOT_FOUND" };
    if (parent.projectId !== data.projectId) {
      return { ok: false, error: "CROSS_PROJECT" };
    }
    if (!canAttach(parent.type, data.type as TicketType)) {
      return { ok: false, error: "INVALID_PARENT" };
    }
  }

  // Vérification que l'assignee appartient au même projet (ou du moins existe)
  if (data.assigneeId) {
    const assignee = await prisma.user.findUnique({
      where: { id: data.assigneeId },
      select: { id: true },
    });
    if (!assignee) return { ok: false, error: "VALIDATION" };
  }

  // Création transactionnelle
  const ticket = await prisma.$transaction(async (tx) => {
    const key = await nextTicketKey(tx, data.projectId);
    const created = await tx.ticket.create({
      data: {
        key,
        projectId: data.projectId,
        type: data.type as TicketType,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        estimatedMinutes: data.estimatedMinutes,
        status: TicketStatus.BACKLOG,
        parentId: parent?.id ?? null,
        path: parent ? buildPath(parent.path, parent.id) : "/",
        creatorId: session.userId,
        assigneeId: data.assigneeId ?? null,
      },
      select: { id: true, key: true },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "TICKET.CREATED",
        entityType: "Ticket",
        entityId: created.id,
        metadata: {
          type: data.type,
          parentId: parent?.id ?? null,
          parentKey: parent?.key ?? null,
        },
      },
    });

    return created;
  });

  revalidatePath(`/projects/[key]/board`, "page");
  revalidatePath(`/projects/[key]/overview`, "page");

  return { ok: true, ticketKey: ticket.key, ticketId: ticket.id };
}

// ─────────────────────────────────────────────────────────────
// Liste des utilisateurs assignables
// ─────────────────────────────────────────────────────────────

export async function listAssignableUsersAction(): Promise<{
  ok: true;
  users: { id: string; name: string; role: string }[];
}> {
  await requireAuth();
  const users = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "PRODUCT_OWNER", "DEVELOPER"] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  return { ok: true, users };
}

// ─────────────────────────────────────────────────────────────
// Changer le statut d'un ticket
// ─────────────────────────────────────────────────────────────

const UpdateStatusSchema = z.object({
  ticketId: z.string().cuid(),
  status: z.nativeEnum(TicketStatus),
});

export type UpdateStatusResult =
  | { ok: true; newStatus: TicketStatus }
  | { ok: false; error: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" };

/**
 * Modifie le statut d'un ticket depuis sa page détail.
 * Sécurité :
 *   - requireAuth + canEditTicket (ADMIN/PO toujours, DEV uniquement si assigné ou créateur)
 *   - Zod enum TicketStatus
 *   - Transaction + audit
 */
export async function updateTicketStatusAction(
  input: z.input<typeof UpdateStatusSchema>
): Promise<UpdateStatusResult> {
  const session = await requireAuth();

  const parsed = UpdateStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const ticket = await prisma.ticket.findUnique({
    where: { id: data.ticketId },
    select: {
      id: true,
      key: true,
      status: true,
      projectId: true,
      assigneeId: true,
      creatorId: true,
    },
  });
  if (!ticket) return { ok: false, error: "NOT_FOUND" };
  if (!(await canEditTicket(session, ticket))) {
    return { ok: false, error: "FORBIDDEN" };
  }

  // No-op si même statut
  if (ticket.status === data.status) {
    return { ok: true, newStatus: data.status };
  }

  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: data.ticketId },
      data: { status: data.status },
    });
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "TICKET.STATUS_CHANGED",
        entityType: "Ticket",
        entityId: data.ticketId,
        metadata: { from: ticket.status, to: data.status },
      },
    });
  });

  revalidatePath(`/tickets/${ticket.key}`);
  revalidatePath(`/projects/[key]/board`, "page");
  revalidatePath(`/projects/[key]/overview`, "page");

  return { ok: true, newStatus: data.status };
}

// ─────────────────────────────────────────────────────────────
// Supprimer un ticket
// ─────────────────────────────────────────────────────────────

const DeleteTicketSchema = z.object({
  ticketId: z.string().cuid(),
});

export type DeleteTicketResult =
  | { ok: true; projectKey: string }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "HAS_CHILDREN"
        | "HAS_EXECUTIONS";
    };

/**
 * Supprime un ticket.
 *
 * Sécurité :
 *   - requireAuth + RBAC (ADMIN et PRODUCT_OWNER uniquement) [A01]
 *   - Refuse si le ticket a des enfants (HAS_CHILDREN) : l'utilisateur doit
 *     supprimer les enfants d'abord pour éviter les cascades accidentelles [A04]
 *   - Refuse si le ticket a des TestExecutions (HAS_EXECUTIONS) : préserve
 *     l'historique d'audit des tests [A09]
 *   - Transaction + audit log conservé malgré la suppression
 *
 * Cascade :
 *   - TimeEntry, TestCase, Attachment sont supprimés en cascade via schema.prisma
 *     (onDelete: Cascade). Attention : les TestRun aussi (car référencent le ticket).
 */
export async function deleteTicketAction(
  input: z.input<typeof DeleteTicketSchema>
): Promise<DeleteTicketResult> {
  const session = await requireAuth();

  // RBAC strict : seuls ADMIN et PO peuvent supprimer
  if (session.role !== "ADMIN" && session.role !== "PRODUCT_OWNER") {
    return { ok: false, error: "FORBIDDEN" };
  }

  const parsed = DeleteTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const ticket = await prisma.ticket.findUnique({
    where: { id: data.ticketId },
    select: {
      id: true,
      key: true,
      title: true,
      type: true,
      project: { select: { key: true } },
      _count: {
        select: {
          children: true,
          testCases: true,
        },
      },
    },
  });
  if (!ticket) return { ok: false, error: "NOT_FOUND" };

  // Refuser si enfants : oblige à supprimer manuellement les sous-tickets
  if (ticket._count.children > 0) {
    return { ok: false, error: "HAS_CHILDREN" };
  }

  // Refuser si des TestExecutions existent sur ses TestCases (historique à préserver)
  if (ticket._count.testCases > 0) {
    const execsCount = await prisma.testExecution.count({
      where: { testCase: { ticketId: data.ticketId } },
    });
    if (execsCount > 0) {
      return { ok: false, error: "HAS_EXECUTIONS" };
    }
  }

  // On ne supprime PAS l'audit log pour traçabilité, on le garde
  // (AuditLog n'a pas de FK cascade vers Ticket, seulement un entityId string)
  await prisma.$transaction(async (tx) => {
    // Audit AVANT suppression (entityId deviendra orphelin mais c'est voulu)
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "TICKET.DELETED",
        entityType: "Ticket",
        entityId: ticket.id,
        metadata: {
          key: ticket.key,
          title: ticket.title,
          type: ticket.type,
        },
      },
    });
    await tx.ticket.delete({ where: { id: data.ticketId } });
  });

  revalidatePath(`/projects/${ticket.project.key}/board`);
  revalidatePath(`/projects/${ticket.project.key}/overview`);

  return { ok: true, projectKey: ticket.project.key };
}

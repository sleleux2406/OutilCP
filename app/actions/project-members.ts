"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, getSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────
// Server Actions multi-projet : gestion des membres d'un projet.
//
// L'ADMIN voit tous les projets par defaut (bypass ProjectMember).
// Les autres roles ne voient et n'agissent que sur les projets ou ils sont
// membres explicitement.
//
// RBAC : seuls les ADMIN et PRODUCT_OWNER peuvent gerer les membres
// (ajouter/supprimer). Le PO ne peut gerer que les membres de SES projets.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Listing : liste des membres d'un projet
// ─────────────────────────────────────────────────────────────

export interface ProjectMemberItem {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: Role;
  addedAt: string; // ISO
  addedByName: string | null;
}

export type ListProjectMembersResult =
  | {
      ok: true;
      project: { id: string; key: string; name: string };
      members: ProjectMemberItem[];
      /** Liste des users non-encore membres, eligibles pour ajout */
      availableUsers: Array<{
        id: string;
        email: string;
        name: string;
        role: Role;
      }>;
    }
  | { ok: false; error: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" };

const ListSchema = z.object({
  projectKey: z.string().min(1),
});

export async function listProjectMembersAction(
  input: z.input<typeof ListSchema>
): Promise<ListProjectMembersResult> {
  // ADMIN ou PO peuvent voir les membres
  await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  const parsed = ListSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const { projectKey } = parsed.data;

  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      key: true,
      name: true,
    },
  });
  if (!project) return { ok: false, error: "NOT_FOUND" };

  // Charge les membres avec leurs infos user
  const memberships = await prisma.projectMember.findMany({
    where: { projectId: project.id },
    select: {
      id: true,
      addedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          deletedAt: true,
        },
      },
      addedById: true,
    },
    orderBy: { addedAt: "asc" },
  });

  // Charge les noms des users qui ont fait les ajouts (best-effort)
  const adderIds = memberships
    .map((m) => m.addedById)
    .filter((id): id is string => !!id);
  const adders =
    adderIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: adderIds } },
          select: { id: true, name: true },
        })
      : [];
  const adderById = new Map(adders.map((a) => [a.id, a.name]));

  // Members visibles : on filtre les users soft-deleted (visibles mais marques)
  const members: ProjectMemberItem[] = memberships
    .filter((m) => !m.user.deletedAt)
    .map((m) => ({
      id: m.id,
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.user.role,
      addedAt: m.addedAt.toISOString(),
      addedByName: m.addedById ? adderById.get(m.addedById) ?? null : null,
    }));

  // Users disponibles (pas encore membres, non-supprimes)
  const memberUserIds = new Set(memberships.map((m) => m.user.id));
  const allUsers = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, email: true, name: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  const availableUsers = allUsers.filter((u) => !memberUserIds.has(u.id));

  return {
    ok: true,
    project,
    members,
    availableUsers,
  };
}

// ─────────────────────────────────────────────────────────────
// Ajout d'un membre
// ─────────────────────────────────────────────────────────────

const AddMemberSchema = z.object({
  projectId: z.string().cuid(),
  userId: z.string().cuid(),
});

export type AddMemberResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "PROJECT_NOT_FOUND"
        | "USER_NOT_FOUND"
        | "ALREADY_MEMBER"
        | "RATE_LIMITED";
    };

export async function addProjectMemberAction(
  input: z.input<typeof AddMemberSchema>
): Promise<AddMemberResult> {
  const session = await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  const rl = rateLimit(`project:add-member:${session.userId}`, {
    limit: 60,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = AddMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { id: true, key: true, name: true },
  });
  if (!project) return { ok: false, error: "PROJECT_NOT_FOUND" };

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { id: true, email: true, name: true, role: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return { ok: false, error: "USER_NOT_FOUND" };

  // Si PO : verifier qu'il est lui-meme membre du projet (les ADMIN bypass)
  if (session.role === "PRODUCT_OWNER") {
    const isPoMember = await prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: session.userId },
      select: { id: true },
    });
    if (!isPoMember) return { ok: false, error: "FORBIDDEN" };
  }

  // Verifie unicite
  const existing = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId: project.id, userId: user.id },
    },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "ALREADY_MEMBER" };

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.create({
      data: {
        projectId: project.id,
        userId: user.id,
        addedById: session.userId,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "PROJECT.MEMBER_ADDED",
        entityType: "Project",
        entityId: project.id,
        metadata: {
          projectKey: project.key,
          userEmail: user.email,
          userRole: user.role,
        },
      },
    });
  });

  revalidatePath(`/projects/${project.key}/members`);
  revalidatePath("/");

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Suppression d'un membre
// ─────────────────────────────────────────────────────────────

const RemoveMemberSchema = z.object({
  projectId: z.string().cuid(),
  userId: z.string().cuid(),
});

export type RemoveMemberResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "PROJECT_NOT_FOUND"
        | "NOT_MEMBER"
        | "RATE_LIMITED";
    };

export async function removeProjectMemberAction(
  input: z.input<typeof RemoveMemberSchema>
): Promise<RemoveMemberResult> {
  const session = await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  const rl = rateLimit(`project:remove-member:${session.userId}`, {
    limit: 60,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = RemoveMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { id: true, key: true },
  });
  if (!project) return { ok: false, error: "PROJECT_NOT_FOUND" };

  if (session.role === "PRODUCT_OWNER") {
    const isPoMember = await prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: session.userId },
      select: { id: true },
    });
    if (!isPoMember) return { ok: false, error: "FORBIDDEN" };
  }

  const membership = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId: project.id, userId: data.userId },
    },
    select: { id: true, user: { select: { email: true, role: true } } },
  });
  if (!membership) return { ok: false, error: "NOT_MEMBER" };

  // Garde-fou : on empeche un PO de se retirer lui-meme du projet
  // (sinon il perdrait l'acces et ne pourrait plus rien faire)
  if (
    session.role === "PRODUCT_OWNER" &&
    data.userId === session.userId
  ) {
    return { ok: false, error: "FORBIDDEN" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.delete({
      where: { id: membership.id },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "PROJECT.MEMBER_REMOVED",
        entityType: "Project",
        entityId: project.id,
        metadata: {
          projectKey: project.key,
          userEmail: membership.user.email,
          userRole: membership.user.role,
        },
      },
    });
  });

  revalidatePath(`/projects/${project.key}/members`);
  revalidatePath("/");

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Helper : liste les projets visibles par un user
// (ADMIN voit tout, autres roles voient seulement leurs projets affectes)
// ─────────────────────────────────────────────────────────────

export async function listVisibleProjectIdsForUser(
  userId: string,
  role: Role
): Promise<string[] | "all"> {
  if (role === "ADMIN") return "all";

  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  });
  return memberships.map((m) => m.projectId);
}

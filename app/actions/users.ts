"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, hashPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────
// Server Actions admin pour gerer les utilisateurs
// Toutes ces actions requierent le role ADMIN.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Listing
// ─────────────────────────────────────────────────────────────

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  role: Role;
  hourlyRateCents: number;
  deletedAt: string | null; // ISO
  createdAt: string; // ISO
  updatedAt: string; // ISO
  // Compteurs informatifs
  ticketsCreatedCount: number;
  ticketsAssignedCount: number;
}

export type ListUsersResult =
  | { ok: true; users: UserListItem[] }
  | { ok: false; error: "FORBIDDEN" };

export async function listUsersAction(): Promise<ListUsersResult> {
  await requireRole(["ADMIN"]);

  const rows = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      hourlyRateCents: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          createdTickets: true,
          assignedTickets: true,
        },
      },
    },
    orderBy: [{ deletedAt: "asc" }, { createdAt: "desc" }],
  });

  return {
    ok: true,
    users: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      hourlyRateCents: r.hourlyRateCents,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      ticketsCreatedCount: r._count.createdTickets,
      ticketsAssignedCount: r._count.assignedTickets,
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// Creation
// ─────────────────────────────────────────────────────────────

const CreateUserSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(2).max(100),
  role: z.nativeEnum(Role),
  password: z.string().min(8).max(200),
});

export type CreateUserResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      error: "VALIDATION" | "FORBIDDEN" | "DUPLICATE_EMAIL" | "RATE_LIMITED";
    };

export async function createUserAction(
  input: z.input<typeof CreateUserSchema>
): Promise<CreateUserResult> {
  const session = await requireRole(["ADMIN"]);

  const rl = rateLimit(`user:create:${session.userId}`, {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = CreateUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  // Verifie unicite
  const existing = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "DUPLICATE_EMAIL" };

  const hashedPassword = await hashPassword(data.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name,
        role: data.role,
        hashedPassword,
        hourlyRateCents: 0,
      },
      select: { id: true, email: true, name: true, role: true },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "USER.CREATED_BY_ADMIN",
        entityType: "User",
        entityId: created.id,
        metadata: {
          email: created.email,
          name: created.name,
          role: created.role,
        },
      },
    });

    return created;
  });

  revalidatePath("/admin/users");

  return { ok: true, userId: user.id };
}

// ─────────────────────────────────────────────────────────────
// Mise a jour (nom + role)
// Pas de modification de l'email (cle d'identification).
// Pas de modification du mot de passe ici (action dediee resetPassword).
// ─────────────────────────────────────────────────────────────

const UpdateUserSchema = z.object({
  userId: z.string().cuid(),
  name: z.string().trim().min(2).max(100).optional(),
  role: z.nativeEnum(Role).optional(),
});

export type UpdateUserResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "USER_NOT_FOUND"
        | "CANNOT_DEMOTE_LAST_ADMIN"
        | "RATE_LIMITED";
    };

export async function updateUserAction(
  input: z.input<typeof UpdateUserSchema>
): Promise<UpdateUserResult> {
  const session = await requireRole(["ADMIN"]);

  const rl = rateLimit(`user:update:${session.userId}`, {
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = UpdateUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { id: true, email: true, name: true, role: true, deletedAt: true },
  });
  if (!target) return { ok: false, error: "USER_NOT_FOUND" };

  // Empeche de retirer le dernier ADMIN actif (verrou de securite)
  if (
    target.role === Role.ADMIN &&
    data.role !== undefined &&
    data.role !== Role.ADMIN
  ) {
    const otherActiveAdmins = await prisma.user.count({
      where: {
        role: Role.ADMIN,
        deletedAt: null,
        NOT: { id: target.id },
      },
    });
    if (otherActiveAdmins === 0) {
      return { ok: false, error: "CANNOT_DEMOTE_LAST_ADMIN" };
    }
  }

  const updateData: { name?: string; role?: Role } = {};
  if (data.name !== undefined && data.name !== target.name)
    updateData.name = data.name;
  if (data.role !== undefined && data.role !== target.role)
    updateData.role = data.role;

  if (Object.keys(updateData).length === 0) {
    // Rien a modifier
    return { ok: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: updateData,
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "USER.UPDATED_BY_ADMIN",
        entityType: "User",
        entityId: target.id,
        metadata: {
          changed: updateData,
          previousRole: target.role,
          previousName: target.name,
        },
      },
    });
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Reinitialisation de mot de passe (saisie directe par l'admin)
// ─────────────────────────────────────────────────────────────

const ResetPasswordSchema = z.object({
  userId: z.string().cuid(),
  newPassword: z.string().min(8).max(200),
});

export type ResetPasswordResult =
  | { ok: true }
  | {
      ok: false;
      error: "VALIDATION" | "FORBIDDEN" | "USER_NOT_FOUND" | "RATE_LIMITED";
    };

export async function resetUserPasswordAction(
  input: z.input<typeof ResetPasswordSchema>
): Promise<ResetPasswordResult> {
  const session = await requireRole(["ADMIN"]);

  const rl = rateLimit(`user:resetpw:${session.userId}`, {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = ResetPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { id: true, email: true },
  });
  if (!target) return { ok: false, error: "USER_NOT_FOUND" };

  const hashedPassword = await hashPassword(data.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { hashedPassword },
    });

    // Revoque toutes les sessions actives de cet user (force la reconnexion)
    await tx.session.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "USER.PASSWORD_RESET_BY_ADMIN",
        entityType: "User",
        entityId: target.id,
        metadata: {
          email: target.email,
        },
      },
    });
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Soft delete (desactivation)
// Marque deletedAt non-null, revoque toutes les sessions.
// ─────────────────────────────────────────────────────────────

const SoftDeleteUserSchema = z.object({
  userId: z.string().cuid(),
});

export type SoftDeleteUserResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "USER_NOT_FOUND"
        | "CANNOT_DELETE_SELF"
        | "CANNOT_DELETE_LAST_ADMIN"
        | "ALREADY_DELETED"
        | "RATE_LIMITED";
    };

export async function softDeleteUserAction(
  input: z.input<typeof SoftDeleteUserSchema>
): Promise<SoftDeleteUserResult> {
  const session = await requireRole(["ADMIN"]);

  const rl = rateLimit(`user:delete:${session.userId}`, {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = SoftDeleteUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  // Empeche un admin de se supprimer lui-meme (eviter le verrouillage)
  if (data.userId === session.userId) {
    return { ok: false, error: "CANNOT_DELETE_SELF" };
  }

  const target = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { id: true, email: true, role: true, deletedAt: true },
  });
  if (!target) return { ok: false, error: "USER_NOT_FOUND" };
  if (target.deletedAt) return { ok: false, error: "ALREADY_DELETED" };

  // Empeche de supprimer le dernier ADMIN actif
  if (target.role === Role.ADMIN) {
    const otherActiveAdmins = await prisma.user.count({
      where: {
        role: Role.ADMIN,
        deletedAt: null,
        NOT: { id: target.id },
      },
    });
    if (otherActiveAdmins === 0) {
      return { ok: false, error: "CANNOT_DELETE_LAST_ADMIN" };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { deletedAt: new Date() },
    });

    // Revoque toutes les sessions de cet user
    await tx.session.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "USER.DEACTIVATED_BY_ADMIN",
        entityType: "User",
        entityId: target.id,
        metadata: {
          email: target.email,
          role: target.role,
        },
      },
    });
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Reactivation (annule un soft delete)
// ─────────────────────────────────────────────────────────────

export type ReactivateUserResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "USER_NOT_FOUND"
        | "NOT_DELETED"
        | "RATE_LIMITED";
    };

export async function reactivateUserAction(
  input: z.input<typeof SoftDeleteUserSchema>
): Promise<ReactivateUserResult> {
  const session = await requireRole(["ADMIN"]);

  const rl = rateLimit(`user:reactivate:${session.userId}`, {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = SoftDeleteUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { id: true, email: true, deletedAt: true },
  });
  if (!target) return { ok: false, error: "USER_NOT_FOUND" };
  if (!target.deletedAt) return { ok: false, error: "NOT_DELETED" };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { deletedAt: null },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "USER.REACTIVATED_BY_ADMIN",
        entityType: "User",
        entityId: target.id,
        metadata: { email: target.email },
      },
    });
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

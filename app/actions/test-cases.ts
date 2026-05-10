"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { isTestable } from "@/lib/tickets/hierarchy";

// Rôles autorisés à gérer les cas de test
const MANAGE_ROLES = ["ADMIN", "PRODUCT_OWNER", "TESTER"] as const;

// ─────────────────────────────────────────────────────────────
// Schémas Zod
// ─────────────────────────────────────────────────────────────

const TITLE_MIN = 3;
const TITLE_MAX = 200;
const TEXT_MAX = 5000;

const CreateSchema = z.object({
  ticketId: z.string().cuid(),
  title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX),
  preconditions: z.string().trim().max(TEXT_MAX).optional(),
  steps: z.string().trim().min(1).max(TEXT_MAX),
  expected: z.string().trim().min(1).max(TEXT_MAX),
});

const UpdateSchema = z.object({
  testCaseId: z.string().cuid(),
  title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX),
  preconditions: z.string().trim().max(TEXT_MAX).optional(),
  steps: z.string().trim().min(1).max(TEXT_MAX),
  expected: z.string().trim().min(1).max(TEXT_MAX),
});

const DeleteSchema = z.object({
  testCaseId: z.string().cuid(),
});

const ReorderSchema = z.object({
  ticketId: z.string().cuid(),
  // Liste des IDs dans le nouvel ordre
  orderedIds: z.array(z.string().cuid()).min(1).max(200),
});

// ─────────────────────────────────────────────────────────────
// Résultats typés
// ─────────────────────────────────────────────────────────────

export type CreateTestCaseResult =
  | { ok: true; testCaseId: string }
  | {
      ok: false;
      error: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "NOT_TESTABLE" | "RATE_LIMITED";
    };

export type UpdateTestCaseResult =
  | { ok: true }
  | { ok: false; error: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" };

export type DeleteTestCaseResult =
  | { ok: true }
  | {
      ok: false;
      error: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "HAS_EXECUTIONS";
    };

export type ReorderResult =
  | { ok: true }
  | { ok: false; error: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "MISMATCH" };

// ─────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────

export async function createTestCaseAction(
  input: z.input<typeof CreateSchema>
): Promise<CreateTestCaseResult> {
  const session = await requireRole([...MANAGE_ROLES]);

  // Rate-limit anti-spam
  const rl = rateLimit(`testcase:create:${session.userId}`, {
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  // Vérifier que le ticket existe ET qu'il est testable (Feature ou US)
  const ticket = await prisma.ticket.findUnique({
    where: { id: data.ticketId },
    select: { id: true, key: true, type: true },
  });
  if (!ticket) return { ok: false, error: "NOT_FOUND" };
  if (!isTestable(ticket.type)) return { ok: false, error: "NOT_TESTABLE" };

  // Calculer le prochain order (max + 1)
  const last = await prisma.testCase.findFirst({
    where: { ticketId: data.ticketId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const nextOrder = (last?.order ?? 0) + 1;

  const created = await prisma.$transaction(async (tx) => {
    const tc = await tx.testCase.create({
      data: {
        ticketId: data.ticketId,
        order: nextOrder,
        title: data.title,
        preconditions: data.preconditions ?? null,
        steps: data.steps,
        expected: data.expected,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "TEST_CASE.CREATED",
        entityType: "TestCase",
        entityId: tc.id,
        metadata: { ticketId: data.ticketId, ticketKey: ticket.key },
      },
    });
    return tc;
  });

  revalidatePath(`/tickets/${ticket.key}`);
  return { ok: true, testCaseId: created.id };
}

// ─────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────

export async function updateTestCaseAction(
  input: z.input<typeof UpdateSchema>
): Promise<UpdateTestCaseResult> {
  const session = await requireRole([...MANAGE_ROLES]);

  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const tc = await prisma.testCase.findUnique({
    where: { id: data.testCaseId },
    select: { id: true, ticket: { select: { key: true } } },
  });
  if (!tc) return { ok: false, error: "NOT_FOUND" };

  await prisma.$transaction(async (tx) => {
    await tx.testCase.update({
      where: { id: data.testCaseId },
      data: {
        title: data.title,
        preconditions: data.preconditions ?? null,
        steps: data.steps,
        expected: data.expected,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "TEST_CASE.UPDATED",
        entityType: "TestCase",
        entityId: data.testCaseId,
        metadata: {},
      },
    });
  });

  revalidatePath(`/tickets/${tc.ticket.key}`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────

export async function deleteTestCaseAction(
  input: z.input<typeof DeleteSchema>
): Promise<DeleteTestCaseResult> {
  const session = await requireRole([...MANAGE_ROLES]);

  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const tc = await prisma.testCase.findUnique({
    where: { id: data.testCaseId },
    select: {
      id: true,
      ticket: { select: { key: true } },
      _count: { select: { executions: true } },
    },
  });
  if (!tc) return { ok: false, error: "NOT_FOUND" };

  // On refuse la suppression si le cas a déjà été exécuté (préserve l'historique).
  // Dans ce cas, l'utilisateur doit désactiver autrement (à ajouter plus tard).
  if (tc._count.executions > 0) {
    return { ok: false, error: "HAS_EXECUTIONS" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.testCase.delete({ where: { id: data.testCaseId } });
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "TEST_CASE.DELETED",
        entityType: "TestCase",
        entityId: data.testCaseId,
        metadata: {},
      },
    });
  });

  revalidatePath(`/tickets/${tc.ticket.key}`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// REORDER
// ─────────────────────────────────────────────────────────────

export async function reorderTestCasesAction(
  input: z.input<typeof ReorderSchema>
): Promise<ReorderResult> {
  const session = await requireRole([...MANAGE_ROLES]);

  const parsed = ReorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  // Vérifier que le ticket existe + récupérer tous ses cas
  const ticket = await prisma.ticket.findUnique({
    where: { id: data.ticketId },
    select: {
      id: true,
      key: true,
      testCases: { select: { id: true } },
    },
  });
  if (!ticket) return { ok: false, error: "NOT_FOUND" };

  // Vérifier que la liste fournie correspond EXACTEMENT aux cas du ticket
  // (pas de cas manquant, pas de cas étranger, même cardinalité)
  const existingIds = new Set(ticket.testCases.map((tc) => tc.id));
  const providedIds = new Set(data.orderedIds);
  if (existingIds.size !== providedIds.size) {
    return { ok: false, error: "MISMATCH" };
  }
  for (const id of data.orderedIds) {
    if (!existingIds.has(id)) return { ok: false, error: "MISMATCH" };
  }

  // Mise à jour en transaction
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < data.orderedIds.length; i++) {
      await tx.testCase.update({
        where: { id: data.orderedIds[i] },
        data: { order: i + 1 },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "TEST_CASE.REORDERED",
        entityType: "Ticket",
        entityId: data.ticketId,
        metadata: { count: data.orderedIds.length },
      },
    });
  });

  revalidatePath(`/tickets/${ticket.key}`);
  return { ok: true };
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { createBugFromKo, type CreatedBugInfo } from "@/lib/bugs/create-from-ko";

// ─────────────────────────────────────────────────────────────
// Start Test Run
// ─────────────────────────────────────────────────────────────

const StartRunSchema = z.object({
  ticketId: z.string().cuid(),
});

export type StartRunResult =
  | {
      ok: true;
      testRunId: string;
      cases: Array<{
        id: string;
        order: number;
        title: string;
        preconditions: string | null;
        steps: string;
        expected: string;
      }>;
      ticketKey: string;
    }
  | { ok: false; error: "NO_CASES" | "NOT_FOUND" | "VALIDATION" | "FORBIDDEN" };

/**
 * Démarre une session de test sur un ticket (US ou Feature) pour le testeur connecté.
 * Crée un TestRun en BDD et retourne les cas de test à parcourir.
 */
export async function startTestRunAction(
  input: z.input<typeof StartRunSchema>
): Promise<StartRunResult> {
  const session = await requireRole(["TESTER", "ADMIN"]);

  const parsed = StartRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const ticket = await prisma.ticket.findUnique({
    where: { id: parsed.data.ticketId },
    select: { id: true, key: true, type: true },
  });
  if (!ticket) return { ok: false, error: "NOT_FOUND" };
  if (ticket.type !== "USER_STORY" && ticket.type !== "FEATURE") {
    return { ok: false, error: "FORBIDDEN" };
  }

  const cases = await prisma.testCase.findMany({
    where: { ticketId: ticket.id },
    orderBy: { order: "asc" },
    select: {
      id: true,
      order: true,
      title: true,
      preconditions: true,
      steps: true,
      expected: true,
    },
  });
  if (cases.length === 0) return { ok: false, error: "NO_CASES" };

  const run = await prisma.testRun.create({
    data: { ticketId: ticket.id, testerId: session.userId },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: session.userId,
      action: "TEST_RUN.STARTED",
      entityType: "Ticket",
      entityId: ticket.id,
      metadata: { testRunId: run.id, casesCount: cases.length },
    },
  });

  return { ok: true, testRunId: run.id, cases, ticketKey: ticket.key };
}

// ─────────────────────────────────────────────────────────────
// Record Test Execution (OK / KO / SKIPPED)
// ─────────────────────────────────────────────────────────────

const RecordExecutionSchema = z
  .object({
    testRunId: z.string().cuid(),
    testCaseId: z.string().cuid(),
    result: z.enum(["OK", "KO", "SKIPPED"]),
    comment: z.string().trim().max(2000).optional(),
    /** URL signée retournée par l'endpoint d'upload (domaine whitelist côté next.config) */
    screenshotUrl: z.string().url().startsWith("https://").max(2048).optional(),
  })
  .refine((v) => v.result !== "KO" || (v.comment && v.comment.length > 0), {
    message: "Un commentaire est obligatoire en cas de KO",
    path: ["comment"],
  });

export type RecordExecutionResult =
  | {
      ok: true;
      executionId: string;
      createdBug?: CreatedBugInfo & { forTestCase: string };
    }
  | { ok: false; error: "VALIDATION" | "NOT_FOUND" | "FORBIDDEN" | "RATE_LIMITED" };

/**
 * Enregistre le résultat d'un cas de test.
 * Si KO : crée automatiquement un bug ET passe le ticket source en BLOCKED.
 *
 * Sécurité :
 *   - requireRole(TESTER/ADMIN) [A01]
 *   - Zod + refine "KO ⇒ comment" [A04]
 *   - screenshotUrl vérifiée https + domaine whitelist (next.config images.remotePatterns)
 *   - Transaction atomique pour KO : exécution + bug + blocage + audit [A08]
 */
export async function recordTestExecutionAction(
  input: z.input<typeof RecordExecutionSchema>
): Promise<RecordExecutionResult> {
  const session = await requireRole(["TESTER", "ADMIN"]);

  // Rate-limit : 120 exécutions / minute par testeur (détection d'anomalie) [A07]
  const rl = rateLimit(`test-exec:${session.userId}`, {
    limit: 120,
    windowMs: 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = RecordExecutionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  // Vérifier que le TestRun appartient bien au testeur connecté (sauf ADMIN)
  const run = await prisma.testRun.findUnique({
    where: { id: data.testRunId },
    select: {
      id: true,
      testerId: true,
      ticket: { select: { id: true, key: true } },
    },
  });
  if (!run) return { ok: false, error: "NOT_FOUND" };
  if (run.testerId !== session.userId && session.role !== "ADMIN") {
    return { ok: false, error: "FORBIDDEN" };
  }

  // Vérifier que le testCase appartient bien au même ticket
  const testCase = await prisma.testCase.findUnique({
    where: { id: data.testCaseId },
    select: { id: true, title: true, ticketId: true },
  });
  if (!testCase || testCase.ticketId !== run.ticket.id) {
    return { ok: false, error: "NOT_FOUND" };
  }

  // URL screenshot : validation domaine
  if (data.screenshotUrl && !isAllowedUploadHost(data.screenshotUrl)) {
    return { ok: false, error: "VALIDATION" };
  }

  const transactionResult = await prisma.$transaction(async (tx) => {
    const execution = await tx.testExecution.create({
      data: {
        testRunId: data.testRunId,
        testCaseId: data.testCaseId,
        result: data.result,
        comment: data.comment,
        screenshotUrl: data.screenshotUrl,
        testerId: session.userId,
      },
      select: { id: true, executedAt: true },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: `TEST_EXECUTION.${data.result}`,
        entityType: "TestCase",
        entityId: data.testCaseId,
        metadata: { testRunId: data.testRunId, executionId: execution.id },
      },
    });

    let createdBug: CreatedBugInfo | null = null;
    if (data.result === "KO") {
      createdBug = await createBugFromKo(tx, {
        sourceTicketId: testCase.ticketId,
        testExecutionId: execution.id,
        testCaseTitle: testCase.title,
        comment: data.comment!,
        screenshotUrl: data.screenshotUrl ?? null,
        executedAt: execution.executedAt,
        testerId: session.userId,
        testerName: session.userName,
      });
    }

    return { execution, createdBug };
  });

  revalidatePath(`/tickets/${run.ticket.key}`);
  revalidatePath(`/projects/[key]/board`, "page");

  return {
    ok: true,
    executionId: transactionResult.execution.id,
    createdBug: transactionResult.createdBug
      ? { ...transactionResult.createdBug, forTestCase: testCase.title }
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// Finish Test Run
// ─────────────────────────────────────────────────────────────

const FinishRunSchema = z.object({
  testRunId: z.string().cuid(),
  summary: z.string().trim().max(500).optional(),
});

export async function finishTestRunAction(input: z.input<typeof FinishRunSchema>) {
  const session = await requireRole(["TESTER", "ADMIN"]);
  const parsed = FinishRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const };

  await prisma.testRun.updateMany({
    where: {
      id: parsed.data.testRunId,
      testerId: session.role === "ADMIN" ? undefined : session.userId,
    },
    data: {
      finishedAt: new Date(),
      summary: parsed.data.summary,
    },
  });

  return { ok: true as const };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Whitelist stricte des hosts acceptés pour les screenshots.
 * Doit rester synchronisée avec next.config.ts > images.remotePatterns.
 */
function isAllowedUploadHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const allowed = [
      /\.r2\.cloudflarestorage\.com$/i,
      /\.s3\.amazonaws\.com$/i,
    ];
    return allowed.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

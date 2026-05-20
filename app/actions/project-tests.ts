"use server";

import { z } from "zod";
import { TestResult, TicketType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────
// Server Actions pour la page "Cahier de tests" d'un projet
// (F04.2 + F04.3 - EPIC E04)
//
// Liste tous les TestCase d'un projet groupes par Feature/User Story
// avec leur derniere execution (statut + horodatage + testeur + commentaire).
// ─────────────────────────────────────────────────────────────

export interface ProjectTestCase {
  id: string;
  title: string;
  preconditions: string | null;
  steps: string;
  expected: string;
  order: number;
  /** Derniere execution du test, null si jamais execute */
  lastExecution: {
    id: string;
    result: TestResult;
    executedAt: string; // ISO
    testerName: string;
    comment: string | null;
    screenshotUrl: string | null;
    /** Si KO, cle du bug auto-cree (null sinon) */
    generatedBugKey: string | null;
    generatedBugId: string | null;
  } | null;
  /** Nombre total d'executions historiques */
  executionsCount: number;
}

export interface ProjectTestParent {
  id: string;
  key: string;
  title: string;
  type: "FEATURE" | "USER_STORY";
  status: string;
  testCases: ProjectTestCase[];
  /** Stats agregees pour ce parent */
  stats: {
    total: number;
    notExecuted: number;
    ok: number;
    ko: number;
    skipped: number;
  };
}

export type ListProjectTestsResult =
  | {
      ok: true;
      project: {
        id: string;
        key: string;
        name: string;
        isRun: boolean;
        parentProject: { key: string; name: string } | null;
      };
      parents: ProjectTestParent[];
      /** Stats agregees pour tout le projet */
      stats: {
        totalCases: number;
        notExecuted: number;
        ok: number;
        ko: number;
        skipped: number;
      };
    }
  | { ok: false; error: "VALIDATION" | "NOT_FOUND" | "FORBIDDEN" };

const ListSchema = z.object({
  projectKey: z.string().min(1),
  /** Filtre 'true' = uniquement technique, 'false' = uniquement fonctionnel, undefined = tous */
  technical: z.boolean().optional(),
});

export async function listProjectTestsAction(
  input: z.input<typeof ListSchema>
): Promise<ListProjectTestsResult> {
  await requireAuth();

  const parsed = ListSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const { projectKey } = parsed.data;

  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      key: true,
      name: true,
      parentProjectId: true,
      parentProject: { select: { key: true, name: true } },
    },
  });
  if (!project) return { ok: false, error: "NOT_FOUND" };

  // Charge tous les tickets testables du projet (FEATURE + USER_STORY) avec leurs TestCases
  const technicalFilter = parsed.data.technical;
  const parents = await prisma.ticket.findMany({
    where: {
      projectId: project.id,
      type: { in: [TicketType.FEATURE, TicketType.USER_STORY] },
      testCases: { some: {} }, // au moins un test case
      // Filtre Technique / Fonctionnel : applique uniquement aux Features
      // (les User Stories ne sont jamais marquees comme techniques)
      ...(technicalFilter !== undefined && technicalFilter !== null
        ? { isTechnical: technicalFilter }
        : {}),
    },
    select: {
      id: true,
      key: true,
      title: true,
      type: true,
      status: true,
      testCases: {
        select: {
          id: true,
          title: true,
          preconditions: true,
          steps: true,
          expected: true,
          order: true,
          executions: {
            select: {
              id: true,
              result: true,
              executedAt: true,
              comment: true,
              screenshotUrl: true,
              tester: { select: { name: true } },
              generatedBug: { select: { id: true, key: true } },
            },
            orderBy: { executedAt: "desc" },
            take: 1, // derniere execution uniquement
          },
          _count: { select: { executions: true } },
        },
        orderBy: { order: "asc" },
      },
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });

  // Transforme et calcule les stats
  const parentsResult: ProjectTestParent[] = parents.map((p) => {
    const testCases: ProjectTestCase[] = p.testCases.map((tc) => {
      const last = tc.executions[0];
      return {
        id: tc.id,
        title: tc.title,
        preconditions: tc.preconditions,
        steps: tc.steps,
        expected: tc.expected,
        order: tc.order,
        lastExecution: last
          ? {
              id: last.id,
              result: last.result,
              executedAt: last.executedAt.toISOString(),
              testerName: last.tester.name,
              comment: last.comment,
              screenshotUrl: last.screenshotUrl,
              generatedBugKey: last.generatedBug?.key ?? null,
              generatedBugId: last.generatedBug?.id ?? null,
            }
          : null,
        executionsCount: tc._count.executions,
      };
    });

    const stats = testCases.reduce(
      (acc, tc) => {
        acc.total++;
        if (!tc.lastExecution) acc.notExecuted++;
        else if (tc.lastExecution.result === "OK") acc.ok++;
        else if (tc.lastExecution.result === "KO") acc.ko++;
        else acc.skipped++;
        return acc;
      },
      { total: 0, notExecuted: 0, ok: 0, ko: 0, skipped: 0 }
    );

    return {
      id: p.id,
      key: p.key,
      title: p.title,
      type: p.type as "FEATURE" | "USER_STORY",
      status: p.status,
      testCases,
      stats,
    };
  });

  // Stats globales projet
  const globalStats = parentsResult.reduce(
    (acc, p) => {
      acc.totalCases += p.stats.total;
      acc.notExecuted += p.stats.notExecuted;
      acc.ok += p.stats.ok;
      acc.ko += p.stats.ko;
      acc.skipped += p.stats.skipped;
      return acc;
    },
    { totalCases: 0, notExecuted: 0, ok: 0, ko: 0, skipped: 0 }
  );

  return {
    ok: true,
    project: {
      id: project.id,
      key: project.key,
      name: project.name,
      isRun: project.parentProjectId !== null,
      parentProject: project.parentProject,
    },
    parents: parentsResult,
    stats: globalStats,
  };
}

import { NextRequest, NextResponse } from "next/server";
import { TicketType } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  exportTestsAsMarkdown,
  exportTestsAsCsv,
  type ExportContext,
} from "@/lib/tests/export";

/**
 * GET /api/projects/[key]/tests/export?format=md|csv
 *
 * Exporte le cahier de tests d'un projet (Feature 04.3).
 *
 * Securite :
 *   - RBAC : ADMIN, PRODUCT_OWNER, TESTER (DEVELOPER exclu pour eviter
 *     l'auto-export par les devs cibles par les tests)
 *   - Audit log TESTS.EXPORTED
 *   - format limite a md ou csv (Zod-like validation)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ key: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await requireRole(["ADMIN", "PRODUCT_OWNER", "TESTER"]);

  const { key: projectKey } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "md";

  if (format !== "md" && format !== "csv") {
    return NextResponse.json(
      { error: "Format invalide. Utilisez ?format=md ou ?format=csv" },
      { status: 400 }
    );
  }

  // Charge le projet
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
  if (!project) {
    return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  }

  // Charge tous les tickets testables avec leurs TestCases + derniere execution
  const parents = await prisma.ticket.findMany({
    where: {
      projectId: project.id,
      type: { in: [TicketType.FEATURE, TicketType.USER_STORY] },
      testCases: { some: {} },
    },
    select: {
      key: true,
      title: true,
      type: true,
      status: true,
      testCases: {
        select: {
          title: true,
          preconditions: true,
          steps: true,
          expected: true,
          order: true,
          executions: {
            select: {
              result: true,
              executedAt: true,
              comment: true,
              tester: { select: { name: true } },
              generatedBug: { select: { key: true } },
            },
            orderBy: { executedAt: "desc" },
            take: 1,
          },
          _count: { select: { executions: true } },
        },
        orderBy: { order: "asc" },
      },
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });

  // Charge l'utilisateur exportant pour metadonnees
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { name: true, email: true },
  });

  const ctx: ExportContext = {
    projectKey: project.key,
    projectName: project.name,
    isRun: project.parentProjectId !== null,
    parentProjectKey: project.parentProject?.key ?? null,
    parentProjectName: project.parentProject?.name ?? null,
    generatedAt: new Date(),
    generatedByName: me?.name ?? "Utilisateur inconnu",
    generatedByEmail: me?.email ?? "",
    parents: parents.map((p) => ({
      key: p.key,
      title: p.title,
      type: p.type as "FEATURE" | "USER_STORY",
      status: p.status,
      testCases: p.testCases.map((tc, idx) => {
        const last = tc.executions[0];
        return {
          id: `${idx}`,
          title: tc.title,
          preconditions: tc.preconditions,
          steps: tc.steps,
          expected: tc.expected,
          order: tc.order,
          executionsCount: tc._count.executions,
          lastExecution: last
            ? {
                result: last.result,
                executedAt: last.executedAt.toISOString(),
                testerName: last.tester.name,
                comment: last.comment,
                generatedBugKey: last.generatedBug?.key ?? null,
              }
            : null,
        };
      }),
    })),
  };

  // Audit log (best-effort, pas bloquant)
  await prisma.auditLog
    .create({
      data: {
        userId: session.userId,
        action: "TESTS.EXPORTED",
        entityType: "Project",
        entityId: project.id,
        metadata: {
          projectKey: project.key,
          format,
          totalCases: ctx.parents.reduce((s, p) => s + p.testCases.length, 0),
        },
      },
    })
    .catch(() => {});

  // Module 1.3 : marque toutes les Features du projet comme "exportees a leur version courante"
  // Cela retire ces Features du compteur "en retard d'export" (badge dans le header).
  await prisma.ticket
    .updateMany({
      where: {
        projectId: project.id,
        type: "FEATURE",
        // On ne marque que les Features qui ont une versionSpecsCourante definie
        versionSpecsCourante: { not: null },
      },
      data: {
        lastExportedAt: new Date(),
        // Aligne lastExportedAtVersion sur versionSpecsCourante via raw update
        // Note : Prisma updateMany ne supporte pas la copie d'un champ a un autre,
        // donc on fait un raw update pour aligner les deux colonnes.
      },
    })
    .catch(() => {});

  // Aligne lastExportedAtVersion = versionSpecsCourante via SQL raw
  await prisma.$executeRaw`
    UPDATE "Ticket"
    SET "lastExportedAtVersion" = "versionSpecsCourante"
    WHERE "projectId" = ${project.id}
      AND "type" = 'FEATURE'
      AND "versionSpecsCourante" IS NOT NULL
  `.catch(() => {});

  // Genere le contenu selon le format
  const dateStr = new Date().toISOString().slice(0, 10);
  const filenameBase = `cahier-tests-${project.key}-${dateStr}`;

  if (format === "csv") {
    const csv = exportTestsAsCsv(ctx);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // format === "md"
  const md = exportTestsAsMarkdown(ctx);
  return new NextResponse(md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.md"`,
      "Cache-Control": "no-store",
    },
  });
}

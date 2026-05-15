import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, LayoutDashboard } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getProjectRollups } from "@/lib/time-rollup";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { CreateBugButton } from "@/components/bugs/CreateBugButton";
import { CreateTicketButton } from "@/components/tickets/CreateTicketButton";
import { CreateRunButton } from "@/components/runs/CreateRunButton";
import { SubProjectsList } from "@/components/runs/SubProjectsList";
import { KANBAN_VISIBLE_TYPES_BY_ROLE, isFeatureNeedingEstimation } from "@/lib/tickets/hierarchy";
import type { KanbanTicket } from "@/lib/tickets/types";

interface PageProps {
  params: Promise<{ key: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: `Kanban ${key}` };
}

export default async function BoardPage({ params }: PageProps) {
  const session = await requireAuth();
  const { key } = await params;

  const project = await prisma.project.findUnique({
    where: { key },
    select: {
      id: true,
      key: true,
      name: true,
      parentProjectId: true,
      parentProject: { select: { key: true, name: true } },
    },
  });
  if (!project) notFound();

  // Filtrage Kanban selon le rôle :
  //   - DEVELOPER : voit Tasks + Bugs (niveau exécution)
  //   - ADMIN / PRODUCT_OWNER / TESTER : voient Epics + Features (niveau pilotage)
  const visibleTypes = KANBAN_VISIBLE_TYPES_BY_ROLE[session.role];

  // F05.3 : Escalade des bugs RUN → board parent.
  // Si on est sur un projet racine et que le rôle voit les Bugs, on remonte
  // aussi les bugs des sous-projets RUN enfants (visibilité pour les DEV).
  const isRootProject = project.parentProjectId === null;
  const includesBugs = visibleTypes.includes("BUG");
  const whereClause =
    isRootProject && includesBugs
      ? {
          OR: [
            {
              projectId: project.id,
              type: { in: visibleTypes },
            },
            {
              // Bugs des RUNs enfants, uniquement si le rôle voit les Bugs
              project: { parentProjectId: project.id },
              type: "BUG" as const,
            },
          ],
        }
      : {
          projectId: project.id,
          type: { in: visibleTypes },
        };

  const [rawTickets, rollups, testExecStats] = await Promise.all([
    prisma.ticket.findMany({
      where: whereClause,
      select: {
        id: true,
        key: true,
        title: true,
        type: true,
        status: true,
        priority: true,
        boardOrder: true,
        estimatedMinutes: true,
        loggedMinutes: true,
        remainingMinutes: true,
        endDate: true,
        isEstimated: true,
        projectId: true,
        assignee: { select: { id: true, name: true } },
        parent: { select: { key: true, title: true } },
        // F05.3 : pour un bug qui vient d'un RUN enfant, on récupère la clé
        // du RUN pour l'afficher sur la carte
        project: { select: { key: true, parentProjectId: true } },
        // Pour déduire l'état "à estimer" d'une Feature côté UI
        children: { select: { type: true } },
      },
      orderBy: [{ status: "asc" }, { boardOrder: "asc" }],
    }),
    getProjectRollups(project.id),
    // Statistiques de tests par ticket (dernière exécution par cas de test)
    prisma.testCase.groupBy({
      by: ["ticketId"],
      where: { ticket: { projectId: project.id } },
      _count: { _all: true },
    }),
  ]);

  // Construire les stats OK/KO par ticket via une requête groupée
  const testsByTicket = new Map<string, { total: number; passed: number; failed: number }>();
  for (const row of testExecStats) {
    testsByTicket.set(row.ticketId, { total: row._count._all, passed: 0, failed: 0 });
  }

  const executions = await prisma.testExecution.findMany({
    where: { testCase: { ticket: { projectId: project.id } } },
    select: {
      testCaseId: true,
      result: true,
      executedAt: true,
      testCase: { select: { ticketId: true } },
    },
    orderBy: { executedAt: "desc" },
  });

  // Dernière exécution par cas de test
  const latestByCase = new Map<string, "OK" | "KO" | "SKIPPED">();
  for (const e of executions) {
    if (!latestByCase.has(e.testCaseId)) {
      latestByCase.set(e.testCaseId, e.result);
    }
  }
  // Ré-agréger par ticket
  const casesByTicket = new Map<string, string[]>();
  const allCases = await prisma.testCase.findMany({
    where: { ticket: { projectId: project.id } },
    select: { id: true, ticketId: true },
  });
  for (const c of allCases) {
    const list = casesByTicket.get(c.ticketId) ?? [];
    list.push(c.id);
    casesByTicket.set(c.ticketId, list);
  }
  for (const [ticketId, caseIds] of casesByTicket) {
    let passed = 0, failed = 0;
    for (const cid of caseIds) {
      const r = latestByCase.get(cid);
      if (r === "OK") passed++;
      else if (r === "KO") failed++;
    }
    testsByTicket.set(ticketId, { total: caseIds.length, passed, failed });
  }

  const tickets: KanbanTicket[] = rawTickets.map((t) => {
    const rollup = rollups.get(t.id);
    return {
      id: t.id,
      key: t.key,
      title: t.title,
      type: t.type,
      status: t.status,
      priority: t.priority,
      boardOrder: t.boardOrder,
      estimatedMinutes: t.estimatedMinutes,
      loggedMinutes: t.loggedMinutes,
      remainingMinutes: t.remainingMinutes,
      endDate: t.endDate ? t.endDate.toISOString() : null,
      assignee: t.assignee,
      parentKey: t.parent?.key ?? null,
      parentTitle: t.parent?.title ?? null,
      // F05.3 : si le bug appartient à un sous-projet RUN (projet avec parentProjectId),
      // on expose la clé du RUN pour l'afficher sur la carte du board parent.
      sourceRunKey:
        t.project.parentProjectId && t.projectId !== project.id
          ? t.project.key
          : null,
      needsEstimation: isFeatureNeedingEstimation(
        t.type,
        t.children.map((c) => c.type),
        t.estimatedMinutes
      ),
      isEstimated: t.isEstimated,
      testStats: testsByTicket.get(t.id),
      rollup: rollup
        ? {
            totalEstimatedMinutes: rollup.totalEstimatedMinutes,
            totalLoggedMinutes: rollup.totalLoggedMinutes,
            totalRemainingMinutes: rollup.totalRemainingMinutes,
            totalRemainingSelfMinutes: rollup.totalRemainingSelfMinutes,
            totalRemainingChildrenMinutes: rollup.totalRemainingChildrenMinutes,
            totalProjectedMinutes: rollup.totalProjectedMinutes,
            varianceMinutes: rollup.varianceMinutes,
            progressPercent: rollup.progressPercent,
          }
        : null,
    };
  });

  const canPilot = session.role === "ADMIN" || session.role === "PRODUCT_OWNER";
  const isSubProject = project.parentProjectId !== null;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b bg-background">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Projets
        </Link>
        {/* Breadcrumb intermédiaire si sous-projet : lien vers le parent */}
        {isSubProject && project.parentProject && (
          <>
            <span className="text-muted-foreground/40">/</span>
            <Link
              href={`/projects/${project.parentProject.key}/board`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {project.parentProject.name}
            </Link>
          </>
        )}
        <span className="text-muted-foreground/40">/</span>
        <h1 className="text-lg font-semibold">{project.name}</h1>
        <span className="font-mono text-xs text-muted-foreground">{project.key}</span>
        {isSubProject && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300"
            title="Sous-projet RUN généré depuis une rétro-spécification"
          >
            RUN
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <CreateTicketButton projectId={project.id} userRole={session.role} />
          <CreateBugButton projectId={project.id} />
          <CreateRunButton
            parentProjectId={project.id}
            parentProjectKey={project.key}
            userRole={session.role}
            isSubProject={isSubProject}
          />
          {canPilot && (
            <Link
              href={`/projects/${project.key}/overview`}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border hover:bg-accent"
            >
              <LayoutDashboard className="h-4 w-4" />
              Vue Pilotage
            </Link>
          )}
        </div>
      </header>

      {/* Bandeau des sous-projets RUN : uniquement sur un projet racine */}
      {!isSubProject && <SubProjectsList parentProjectId={project.id} />}

      <KanbanBoard
        projectId={project.id}
        initialTickets={tickets}
        currentUserId={session.userId}
      />
    </div>
  );
}

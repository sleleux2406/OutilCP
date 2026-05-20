import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, KanbanSquare, CalendarDays } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { getProjectRollups } from "@/lib/time-rollup";
import { PmDashboard } from "@/components/pm/PmDashboard";
import type { EpicForDashboard, PmKpis } from "@/components/pm/PmDashboard";
import {
  detectAssigneeLeaveOverlap,
  buildLeavesByUserMap,
} from "@/lib/leaves/leave-overlap";

interface PageProps {
  params: Promise<{ key: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: `Pilotage ${key}` };
}

export default async function ProjectOverviewPage({ params }: PageProps) {
  // [A01] Page réservée aux rôles de pilotage
  await requireRole(["ADMIN", "PRODUCT_OWNER"]);
  const { key } = await params;

  const project = await prisma.project.findUnique({
    where: { key },
    select: { id: true, key: true, name: true },
  });
  if (!project) notFound();

  // Phase 4 : Epics + Features + sous-tickets (US/Task/Bug) avec dates et assignee
  const epicsRaw = await prisma.ticket.findMany({
    where: { projectId: project.id, type: "EPIC" },
    select: {
      id: true,
      key: true,
      title: true,
      status: true,
      priority: true,
      children: {
        where: { type: "FEATURE" },
        select: {
          id: true,
          key: true,
          title: true,
          status: true,
          children: {
            select: {
              id: true,
              key: true,
              title: true,
              type: true,
              status: true,
              estimatedMinutes: true,
              loggedMinutes: true,
              startDate: true,
              endDate: true,
              assigneeId: true,
              assignee: { select: { name: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  // Phase 3/4 : conges des assignees pour calculer les alertes
  const assigneeIds = Array.from(
    new Set(
      epicsRaw.flatMap((e) =>
        e.children.flatMap((f) =>
          f.children
            .filter((c) => c.assigneeId && (c.startDate || c.endDate))
            .map((c) => c.assigneeId as string)
        )
      )
    )
  );
  const leavesByUser = await buildLeavesByUserMap(prisma, {
    userIds: assigneeIds,
  });

  const epics: EpicForDashboard[] = epicsRaw.map((e) => ({
    id: e.id,
    key: e.key,
    title: e.title,
    status: e.status,
    priority: e.priority,
    features: e.children.map((f) => ({
      id: f.id,
      key: f.key,
      title: f.title,
      status: f.status,
      children: f.children.map((c) => {
        const leaveAlert = detectAssigneeLeaveOverlap(
          {
            startDate: c.startDate,
            endDate: c.endDate,
            assigneeId: c.assigneeId,
          },
          leavesByUser
        );
        return {
          id: c.id,
          key: c.key,
          title: c.title,
          type: c.type as "FEATURE" | "BUG" | "USER_STORY" | "TASK" | "EPIC",
          status: c.status,
          estimatedMinutes: c.estimatedMinutes,
          loggedMinutes: c.loggedMinutes,
          assigneeName: c.assignee?.name ?? null,
          leaveAlert: leaveAlert
            ? {
                severity: leaveAlert.severity,
                overlapDays: leaveAlert.overlapDays,
              }
            : null,
        };
      }),
    })),
  }));

  const rollups = await getProjectRollups(project.id);

  // KPIs globaux
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [bugsOpen, bugsResolved, blockedTickets, koLast7Days] = await Promise.all([
    prisma.ticket.count({
      where: { projectId: project.id, type: "BUG", status: { not: "DONE" } },
    }),
    prisma.ticket.count({
      where: { projectId: project.id, type: "BUG", status: "DONE" },
    }),
    prisma.ticket.count({
      where: { projectId: project.id, status: "BLOCKED" },
    }),
    prisma.testExecution.count({
      where: {
        result: "KO",
        executedAt: { gte: sevenDaysAgo },
        testCase: { ticket: { projectId: project.id } },
      },
    }),
  ]);

  const kpis: PmKpis = { bugsOpen, bugsResolved, blockedTickets, koLast7Days };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b bg-background">
        <Link
          href="/pilotage"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Pilotage
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <h1 className="text-lg font-semibold">{project.name}</h1>
        <span className="font-mono text-xs text-muted-foreground">{project.key}</span>
        <Link
          href={`/projects/${project.key}/board`}
          className="ml-auto inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border hover:bg-accent"
        >
          <KanbanSquare className="h-4 w-4" />
          Vue Kanban
        </Link>
        <Link
          href={`/projects/${project.key}/capacity`}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border hover:bg-accent"
        >
          <CalendarDays className="h-4 w-4" />
          Capacité
        </Link>
      </header>

      <PmDashboard project={project} epics={epics} rollups={rollups} kpis={kpis} />
    </div>
  );
}

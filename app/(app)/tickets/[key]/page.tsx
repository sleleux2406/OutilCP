import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Calendar, Clock, User } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAuth, canEditTicket } from "@/lib/auth";
import { getTicketRollup } from "@/lib/time-rollup";
import {
  TICKET_TYPE_META,
  getPriorityMeta,
} from "@/lib/tickets/metadata";
import { isTestable } from "@/lib/tickets/hierarchy";
import { formatDate, formatDays, formatDateTime, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TestRunnerLauncher } from "@/components/test-runner/TestRunnerLauncher";
import { TimeLogForm } from "@/components/time/TimeLogForm";
import { CreateBugButton } from "@/components/bugs/CreateBugButton";
import { TestCaseList } from "@/components/test-cases/TestCaseList";
import { TicketStatusPicker } from "@/components/tickets/TicketStatusPicker";
import { TicketChildren } from "@/components/tickets/TicketChildren";
import { TicketActionsMenu } from "@/components/tickets/TicketActionsMenu";
import { TicketEditor } from "@/components/tickets/TicketEditor";
import { isOverBudget } from "@/lib/tickets/types";

interface PageProps {
  params: Promise<{ key: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params;
  return { title: key };
}

export default async function TicketPage({ params }: PageProps) {
  const session = await requireAuth();
  const { key } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { key },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      creator: { select: { name: true } },
      parent: { select: { key: true, title: true, type: true } },
      project: { select: { key: true, name: true } },
      children: {
        orderBy: [{ type: "asc" }, { priority: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          key: true,
          title: true,
          type: true,
          status: true,
          priority: true,
          assignee: { select: { id: true, name: true } },
        },
      },
      testCases: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          title: true,
          preconditions: true,
          steps: true,
          expected: true,
          _count: { select: { executions: true } },
        },
      },
      attachments: {
        orderBy: { uploadedAt: "desc" },
        select: { id: true, url: true, mimeType: true, uploadedAt: true },
      },
    },
  });
  if (!ticket) notFound();

  const rollup = await getTicketRollup(ticket.id);
  const typeMeta = TICKET_TYPE_META[ticket.type];
  const priorityMeta = getPriorityMeta(ticket.priority);
  const TypeIcon = typeMeta.icon;
  const overBudget = isOverBudget(rollup);

  const canTest = session.role === "TESTER" || session.role === "ADMIN";
  const testable = isTestable(ticket.type);
  const canEditStatus = await canEditTicket(session, {
    assigneeId: ticket.assigneeId,
    creatorId: ticket.creatorId,
    projectId: ticket.projectId,
  });

  return (
    <main className="container py-6 max-w-5xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Projets
        </Link>
        <span>/</span>
        <Link
          href={`/projects/${ticket.project.key}/board`}
          className="hover:text-foreground"
        >
          {ticket.project.name}
        </Link>
        <span>/</span>
        <span className="font-mono text-foreground">{ticket.key}</span>
      </div>

      {/* Header */}
      <header className="space-y-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "inline-flex items-center justify-center w-10 h-10 rounded-md shrink-0",
              typeMeta.bgColor
            )}
          >
            <TypeIcon className={cn("h-5 w-5", typeMeta.iconColor)} aria-hidden />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <span>{typeMeta.label}</span>
              <span className="font-mono">{ticket.key}</span>
            </div>
            <h1 className="text-2xl font-bold">{ticket.title}</h1>
            {ticket.parent && (
              <Link
                href={`/tickets/${ticket.parent.key}`}
                className="text-xs text-muted-foreground hover:text-foreground mt-1 inline-block"
              >
                {`\u2196 ${ticket.parent.key} - ${ticket.parent.title}`}
              </Link>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <TicketStatusPicker
              ticketId={ticket.id}
              currentStatus={ticket.status}
              canEdit={canEditStatus}
            />
            <Badge variant={priorityMeta.variant}>{priorityMeta.shortLabel}</Badge>
            <TicketActionsMenu
              ticketId={ticket.id}
              ticketKey={ticket.key}
              ticketTitle={ticket.title}
              userRole={session.role}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {ticket.assignee ? (
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5" aria-hidden /> {ticket.assignee.name}
            </span>
          ) : (
            <span>Non assigne</span>
          )}
          <span>-</span>
          <span>Cree par {ticket.creator.name}</span>
          <span>-</span>
          <span>{formatDateTime(ticket.createdAt)}</span>
        </div>

        <div className="pt-2 flex items-center gap-2 flex-wrap">
          <TicketEditor
            ticket={{
              id: ticket.id,
              title: ticket.title,
              description: ticket.description,
              priority: ticket.priority,
              estimatedMinutes: ticket.estimatedMinutes,
              remainingMinutes: ticket.remainingMinutes,
              loggedMinutes: ticket.loggedMinutes,
              status: ticket.status,
              hasChildren: ticket.children.length > 0,
              assigneeId: ticket.assigneeId,
              startDate: ticket.startDate,
            }}
            canEdit={canEditStatus}
          />
          {testable && (
            <>
              <TestRunnerLauncher
                ticketId={ticket.id}
                ticketKey={ticket.key}
                canTest={canTest}
                hasCases={ticket.testCases.length > 0}
              />
              <CreateBugButton
                projectId={ticket.projectId}
                defaultParentId={ticket.id}
                label="Signaler un bug"
              />
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="border rounded-lg p-5 bg-card">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">
              Description
            </h2>
            {ticket.description ? (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                  {ticket.description}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune description.</p>
            )}
          </section>

          {/* Enfants + bugs liés (pour Epic, Feature, US) */}
          {ticket.children.length > 0 && (
            <TicketChildren children={ticket.children} />
          )}

          {testable && (
            <section className="border rounded-lg p-5 bg-card">
              <TestCaseList
                ticketId={ticket.id}
                userRole={session.role}
                initialCases={ticket.testCases.map((c) => ({
                  id: c.id,
                  order: c.order,
                  title: c.title,
                  preconditions: c.preconditions,
                  steps: c.steps,
                  expected: c.expected,
                  executionsCount: c._count.executions,
                }))}
              />
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <section className="border rounded-lg p-4 bg-card">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-3 inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" aria-hidden /> Planification
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Début</span>
                <span className="font-semibold">{formatDate(ticket.startDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fin prévue</span>
                <span className="font-semibold">{formatDate(ticket.endDate)}</span>
              </div>
              {ticket.startDate && ticket.endDate && (
                <p className="text-[10px] text-muted-foreground pt-1 border-t">
                  {ticket.children.length > 0
                    ? "Min début / max fin des User Stories (parallélisation)."
                    : "Calcul en jours ouvrés : début + reste à faire."}
                </p>
              )}
              {!ticket.startDate && !ticket.children.length && (
                <p className="text-[10px] text-muted-foreground italic">
                  Aucune planification. Cliquez sur Modifier pour définir une date de début.
                </p>
              )}
            </div>
          </section>

          <section className="border rounded-lg p-4 bg-card">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-3">
              Temps (avec descendants)
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">Estimé initial</span>
                <span className="font-semibold">
                  {formatDays(rollup.totalEstimatedMinutes)}
                </span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">Loggé</span>
                <span className="font-semibold">
                  {formatDays(rollup.totalLoggedMinutes)}
                </span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">Reste à faire</span>
                <span className="font-semibold">
                  {formatDays(rollup.totalRemainingMinutes)}
                </span>
              </div>

              {/* Barre de progression loggé / estimé */}
              <Progress
                value={rollup.progressPercent}
                tone={overBudget ? "danger" : "default"}
                className="mt-3"
              />
              <p className="text-xs text-muted-foreground text-right tabular-nums">
                {rollup.progressPercent}% loggé
              </p>

              {/* Bloc dépassement : seulement si projection > estimé */}
              {rollup.totalEstimatedMinutes > 0 && (
                <div
                  className={cn(
                    "mt-3 rounded-md border px-3 py-2",
                    overBudget
                      ? "border-destructive/40 bg-destructive/10"
                      : "border-green-500/30 bg-green-500/5"
                  )}
                >
                  <div className="flex justify-between items-baseline tabular-nums">
                    <span className="text-xs text-muted-foreground">Projection totale</span>
                    <span
                      className={cn(
                        "font-semibold text-sm",
                        overBudget
                          ? "text-destructive"
                          : "text-green-700 dark:text-green-400"
                      )}
                    >
                      {formatDays(rollup.totalProjectedMinutes)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline tabular-nums mt-1">
                    <span className="text-xs text-muted-foreground">
                      {rollup.varianceMinutes > 0
                        ? "Dépassement prévu"
                        : rollup.varianceMinutes < 0
                        ? "Marge"
                        : "Aligné"}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        overBudget
                          ? "text-destructive"
                          : "text-green-700 dark:text-green-400"
                      )}
                    >
                      {rollup.varianceMinutes > 0 && "+"}
                      {formatDays(Math.abs(rollup.varianceMinutes))}
                      {rollup.varianceMinutes !== 0 && (
                        <>
                          {" · "}
                          {rollup.varianceMinutes > 0 && "+"}
                          {Math.round(
                            (rollup.varianceMinutes / rollup.totalEstimatedMinutes) * 1000
                          ) / 10}
                          %
                        </>
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="border rounded-lg p-4 bg-card">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-3 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden /> Logger du temps
            </h3>
            <TimeLogForm ticketId={ticket.id} />
          </section>
        </aside>
      </div>
    </main>
  );
}

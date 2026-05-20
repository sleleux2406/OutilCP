"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Mountain,
  Users,
  Bug as BugIcon,
  AlertTriangle,
} from "lucide-react";
import type { TicketStatus } from "@prisma/client";
import { cn, formatDays } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { TICKET_STATUS_META } from "@/lib/tickets/metadata";
import { isOverBudget } from "@/lib/tickets/types";
import type { RollupRow } from "@/lib/tickets/types";

export interface EpicFeatureChild {
  id: string;
  key: string;
  title: string;
  type: "FEATURE" | "BUG" | "USER_STORY" | "TASK" | "EPIC";
  status: TicketStatus;
  estimatedMinutes: number;
  loggedMinutes: number;
  /** Phase 3/4 : alerte si l'assignee a un conge pendant la periode du ticket */
  leaveAlert?: {
    severity: "full" | "partial";
    overlapDays: number;
  } | null;
  /** Nom de l'assignee pour affichage rapide */
  assigneeName?: string | null;
}

export interface EpicFeatureSummary {
  id: string;
  key: string;
  title: string;
  status: TicketStatus;
  children: EpicFeatureChild[];
}

export interface EpicForDashboard {
  id: string;
  key: string;
  title: string;
  status: TicketStatus;
  priority: number;
  features: EpicFeatureSummary[];
}

interface Props {
  epic: EpicForDashboard;
  rollup: RollupRow | undefined;
  featureRollups: Map<string, RollupRow>;
}

export function EpicRow({ epic, rollup, featureRollups }: Props) {
  const [expanded, setExpanded] = useState(false);
  // Phase 4 : Map des Features dont le sous-arbre est deplie pour voir les
  // US/Task/Bug enfants avec leurs alertes
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(
    new Set()
  );

  const toggleFeature = (featureId: string) => {
    setExpandedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  };

  const progress = rollup?.progressPercent ?? 0;
  const overBudget = isOverBudget(rollup);
  const statusMeta = TICKET_STATUS_META[epic.status];

  // Phase 4 : compteur d'alertes conge dans tout le sous-arbre de l'Epic
  const leaveAlertsInEpic = epic.features.reduce(
    (sum, f) =>
      sum + f.children.filter((c) => c.leaveAlert != null).length,
    0
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
      >
        <ChevronRight
          className={cn("w-4 h-4 shrink-0 transition-transform", expanded && "rotate-90")}
          aria-hidden
        />
        <Mountain className="w-4 h-4 text-purple-500 shrink-0" aria-hidden />
        <Link
          href={`/tickets/${epic.key}`}
          className="text-xs font-mono text-muted-foreground hover:text-foreground hover:underline shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {epic.key}
        </Link>
        <h3 className="font-medium flex-1 truncate">{epic.title}</h3>

        {/* Phase 4 : badge global d'alerte conge sur l'Epic */}
        {leaveAlertsInEpic > 0 && (
          <span
            className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-300"
            title={`${leaveAlertsInEpic} ticket(s) avec un assignee en conge sur la periode prevue`}
          >
            <AlertTriangle className="w-3 h-3" />
            {leaveAlertsInEpic} conge(s)
          </span>
        )}

        <Badge variant={statusMeta.badgeVariant} className="hidden md:inline-flex">
          {statusMeta.label}
        </Badge>

        <div className="hidden sm:flex items-center gap-6 text-sm tabular-nums shrink-0">
          <Metric
            label="Loggé / estimé"
            value={`${formatDays(rollup?.totalLoggedMinutes ?? 0)} / ${formatDays(
              rollup?.totalEstimatedMinutes ?? 0
            )}`}
          />
          <Metric
            label="Projection"
            value={formatDays(rollup?.totalProjectedMinutes ?? 0)}
            tone={overBudget ? "danger" : "default"}
          />
          {rollup && rollup.totalEstimatedMinutes > 0 && rollup.varianceMinutes !== 0 && (
            <Metric
              label="Dérive"
              value={`${rollup.varianceMinutes > 0 ? "+" : ""}${formatDays(
                Math.abs(rollup.varianceMinutes)
              )}`}
              tone={overBudget ? "danger" : "default"}
            />
          )}
          <div className="w-32">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Avancement</span>
              <span className="font-semibold">{progress}%</span>
            </div>
            <Progress value={progress} tone={overBudget ? "danger" : "default"} className="h-1.5" />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="bg-muted/20 border-t">
          {epic.features.length === 0 ? (
            <p className="text-xs text-muted-foreground px-12 py-3">Aucune Feature</p>
          ) : (
            epic.features.map((feature) => {
              const fr = featureRollups.get(feature.id);
              const fOver = isOverBudget(fr);
              const fStatusMeta = TICKET_STATUS_META[feature.status];
              const bugs = feature.children.filter((c) => c.type === "BUG").length;
              const userStories = feature.children.filter(
                (c) => c.type === "USER_STORY"
              ).length;
              const featureExpanded = expandedFeatures.has(feature.id);
              const hasChildren = feature.children.length > 0;
              // Compteur d'alertes conge sur les enfants de cette Feature
              const featureLeaveAlerts = feature.children.filter(
                (c) => c.leaveAlert != null
              ).length;

              return (
                <div key={feature.id} className="border-t">
                  <div className="flex items-center gap-3 pl-12 pr-4 py-2 text-sm hover:bg-muted/30">
                    {/* Toggle expand pour le 3eme niveau (US/Task/Bug) */}
                    {hasChildren ? (
                      <button
                        type="button"
                        onClick={() => toggleFeature(feature.id)}
                        aria-expanded={featureExpanded}
                        className="shrink-0 hover:bg-muted/50 rounded p-0.5 -ml-6 mr-1"
                      >
                        <ChevronRight
                          className={cn(
                            "w-3 h-3 transition-transform",
                            featureExpanded && "rotate-90"
                          )}
                          aria-hidden
                        />
                      </button>
                    ) : (
                      <span className="w-5 -ml-6 mr-1" />
                    )}

                    <Link
                      href={`/tickets/${feature.key}`}
                      className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline shrink-0"
                    >
                      {feature.key}
                    </Link>
                    <span className="flex-1 truncate">{feature.title}</span>

                    {featureLeaveAlerts > 0 && (
                      <span
                        className="text-[10px] font-semibold px-1.5 rounded bg-orange-500/15 text-orange-700"
                        title={`${featureLeaveAlerts} ticket(s) enfant(s) avec un assignee en conge`}
                      >
                        <AlertTriangle className="w-3 h-3 inline" />
                      </span>
                    )}

                    <Badge variant={fStatusMeta.badgeVariant} className="hidden md:inline-flex">
                      {fStatusMeta.label}
                    </Badge>

                    {userStories > 0 && (
                      <span
                        className="text-xs inline-flex items-center gap-1 text-muted-foreground"
                        title={`${userStories} User Story${userStories > 1 ? "s" : ""}`}
                      >
                        <Users className="h-3 w-3" aria-hidden />
                        {userStories}
                      </span>
                    )}
                    {bugs > 0 && (
                      <span
                        className="text-xs inline-flex items-center gap-1 px-1.5 rounded bg-red-500/15 text-red-600"
                        title={`${bugs} bug${bugs > 1 ? "s" : ""}`}
                      >
                        <BugIcon className="h-3 w-3" aria-hidden />
                        {bugs}
                      </span>
                    )}

                    <span
                      className={cn(
                        "text-xs tabular-nums w-28 text-right",
                        fOver && "text-destructive font-medium"
                      )}
                    >
                      {formatDays(fr?.totalLoggedMinutes ?? 0)} /{" "}
                      {formatDays(fr?.totalEstimatedMinutes ?? 0)}
                    </span>
                    <span
                      className={cn(
                        "text-xs tabular-nums w-20 text-right",
                        fOver ? "text-destructive font-medium" : "text-muted-foreground"
                      )}
                      title="Projection (loggé + reste)"
                    >
                      {formatDays(fr?.totalProjectedMinutes ?? 0)}
                    </span>
                    <span className="text-xs tabular-nums w-12 text-right font-semibold">
                      {fr?.progressPercent ?? 0}%
                    </span>
                  </div>

                  {/* Phase 4 : 3eme niveau - sous-tickets US/Task/Bug */}
                  {featureExpanded && (
                    <div className="bg-muted/40 border-t">
                      {feature.children.map((child) => (
                        <ChildTicketRow key={child.id} child={child} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Phase 4 : ligne d'un ticket enfant (US/Task/Bug) dans le tree-view.
 */
function ChildTicketRow({ child }: { child: EpicFeatureChild }) {
  const childStatusMeta = TICKET_STATUS_META[child.status];
  const isFullLeave = child.leaveAlert?.severity === "full";
  const isPartialLeave = child.leaveAlert?.severity === "partial";

  const typeIcon =
    child.type === "BUG"
      ? "🐛"
      : child.type === "USER_STORY"
        ? "📝"
        : child.type === "TASK"
          ? "✓"
          : "•";

  return (
    <div className="flex items-center gap-3 pl-20 pr-4 py-1.5 text-xs border-t border-muted-foreground/10">
      <span className="text-[10px] shrink-0" aria-hidden>
        {typeIcon}
      </span>
      <Link
        href={`/tickets/${child.key}`}
        className="font-mono text-muted-foreground hover:text-foreground hover:underline shrink-0"
      >
        {child.key}
      </Link>
      <span className="flex-1 truncate">{child.title}</span>

      {child.leaveAlert && (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded",
            isFullLeave
              ? "bg-red-500/15 text-red-700 dark:text-red-300"
              : "bg-orange-500/15 text-orange-700 dark:text-orange-300"
          )}
          title={
            isFullLeave
              ? `Conge total (${child.leaveAlert.overlapDays}j)`
              : `Conge partiel (${child.leaveAlert.overlapDays}j)`
          }
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          {child.leaveAlert.overlapDays}j
        </span>
      )}

      <Badge variant={childStatusMeta.badgeVariant} className="hidden md:inline-flex text-[10px]">
        {childStatusMeta.label}
      </Badge>

      {child.assigneeName && (
        <span className="hidden sm:inline text-[10px] text-muted-foreground truncate max-w-[120px]">
          {child.assigneeName}
        </span>
      )}

      <span className="text-[10px] tabular-nums w-20 text-right text-muted-foreground">
        {formatDays(child.loggedMinutes)} / {formatDays(child.estimatedMinutes)}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={cn("font-semibold", tone === "danger" && "text-destructive")}>{value}</div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Mountain, Users, Bug as BugIcon } from "lucide-react";
import type { TicketStatus } from "@prisma/client";
import { cn, formatEUR, formatHours } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { TICKET_STATUS_META } from "@/lib/tickets/metadata";
import { isOverBudget } from "@/lib/tickets/types";
import type { RollupRow } from "@/lib/tickets/types";

export interface EpicFeatureChild {
  id: string;
  type: "FEATURE" | "BUG" | "USER_STORY" | "TASK" | "EPIC";
  status: TicketStatus;
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

  const progress = rollup?.progressPercent ?? 0;
  const overBudget = isOverBudget(rollup);
  const statusMeta = TICKET_STATUS_META[epic.status];

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
        <Badge variant={statusMeta.badgeVariant} className="hidden md:inline-flex">
          {statusMeta.label}
        </Badge>

        <div className="hidden sm:flex items-center gap-6 text-sm tabular-nums shrink-0">
          <Metric label="Coût" value={formatEUR(rollup?.totalCostCents ?? 0)} />
          <Metric
            label="Temps"
            value={`${formatHours(rollup?.totalLoggedMinutes ?? 0)} / ${formatHours(
              rollup?.totalEstimatedMinutes ?? 0
            )}`}
            tone={overBudget ? "danger" : "default"}
          />
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
              const userStories = feature.children.filter((c) => c.type === "USER_STORY").length;

              return (
                <div
                  key={feature.id}
                  className="flex items-center gap-3 pl-12 pr-4 py-2 text-sm border-t"
                >
                  <Link
                    href={`/tickets/${feature.key}`}
                    className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline shrink-0"
                  >
                    {feature.key}
                  </Link>
                  <span className="flex-1 truncate">{feature.title}</span>

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

                  <span className="text-xs tabular-nums text-muted-foreground w-24 text-right">
                    {formatEUR(fr?.totalCostCents ?? 0)}
                  </span>
                  <span
                    className={cn(
                      "text-xs tabular-nums w-28 text-right",
                      fOver && "text-destructive font-medium"
                    )}
                  >
                    {formatHours(fr?.totalLoggedMinutes ?? 0)} /{" "}
                    {formatHours(fr?.totalEstimatedMinutes ?? 0)}
                  </span>
                  <span className="text-xs tabular-nums w-12 text-right font-semibold">
                    {fr?.progressPercent ?? 0}%
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
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

"use client";

import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Bug as BugIcon,
  CheckCircle2,
  Clock,
  Euro,
  Target,
} from "lucide-react";
import { KpiCard, type KpiTone } from "./KpiCard";
import { EpicRow, type EpicForDashboard } from "./EpicRow";
import { formatEUR, formatDays } from "@/lib/utils";
import { sumRollups, formatVariance, getVarianceTone } from "@/lib/rollup-presenter";
import type { RollupRow } from "@/lib/tickets/types";

export interface PmKpis {
  bugsOpen: number;
  bugsResolved: number;
  blockedTickets: number;
  koLast7Days: number;
}

interface Props {
  project: { id: string; key: string; name: string };
  epics: EpicForDashboard[];
  rollups: Map<string, RollupRow>;
  kpis: PmKpis;
}

export function PmDashboard({ project, epics, rollups, kpis }: Props) {
  const totals = useMemo(() => {
    const epicRollups: RollupRow[] = [];
    for (const e of epics) {
      const r = rollups.get(e.id);
      if (r) epicRollups.push(r);
    }
    return sumRollups(epicRollups);
  }, [epics, rollups]);

  const varianceTone: KpiTone = ((): KpiTone => {
    const t = getVarianceTone(totals.variancePercent);
    if (t === "neutral") return "primary";
    return t;
  })();

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="container py-6 space-y-6">
        <header>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Vue Pilotage</p>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {epics.length} epic{epics.length > 1 ? "s" : ""} · coût total{" "}
            <span className="font-semibold text-foreground">{formatEUR(totals.totalCostCents)}</span>
          </p>
        </header>

        {/* KPIs */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            icon={Euro}
            label="Coût total (loggé)"
            value={formatEUR(totals.totalCostCents)}
            tone="primary"
          />
          <KpiCard
            icon={Clock}
            label="Temps loggé/estimé"
            value={`${formatDays(totals.totalLoggedMinutes)} / ${formatDays(
              totals.totalEstimatedMinutes
            )}`}
            hint={`${totals.progressPercent}% avancement`}
          />
          <KpiCard
            icon={Activity}
            label="Dérive budgétaire"
            value={formatVariance(totals.variancePercent)}
            tone={varianceTone}
          />
          <KpiCard
            icon={BugIcon}
            label="Bugs ouverts"
            value={kpis.bugsOpen}
            tone={kpis.bugsOpen > 0 ? "warning" : "success"}
          />
          <KpiCard
            icon={CheckCircle2}
            label="Bugs résolus"
            value={kpis.bugsResolved}
            tone="success"
          />
          <KpiCard
            icon={AlertTriangle}
            label="Tickets bloqués"
            value={kpis.blockedTickets}
            tone={kpis.blockedTickets > 0 ? "danger" : "success"}
            hint={
              kpis.koLast7Days > 0 ? `${kpis.koLast7Days} KO sur 7 jours` : "Aucun KO récent"
            }
          />
        </section>

        {/* Arbre Epics → Features */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">
              Epics ({epics.length})
            </h2>
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Target className="h-3 w-3" aria-hidden /> cliquez pour voir les Features
            </p>
          </div>

          <div className="border rounded-lg divide-y bg-card">
            {epics.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Aucune Epic dans ce projet.
              </p>
            ) : (
              epics.map((epic) => (
                <EpicRow
                  key={epic.id}
                  epic={epic}
                  rollup={rollups.get(epic.id)}
                  featureRollups={rollups}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Wand2, AlertTriangle, Calendar, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { autoPlaceP1Action } from "@/app/actions/capacity";
import type {
  CapacityViewWeek,
  CapacityViewP1Ticket,
} from "@/app/actions/capacity";

interface Props {
  projectKey: string;
  weeks: CapacityViewWeek[];
  p1Tickets: CapacityViewP1Ticket[];
  hasPlan: boolean;
  planGeneratedAt: string | null;
  projectedEndDate: string | null;
  leftoverMinutes: number;
}

const MINUTES_PER_DAY = 480;

function formatDays(minutes: number): string {
  if (minutes <= 0) return "0j";
  const days = minutes / MINUTES_PER_DAY;
  // Affichage avec 1 décimale, sauf si entier
  return Number.isInteger(days) ? `${days}j` : `${days.toFixed(1)}j`;
}

function formatDateShort(dateIso: string | Date): string {
  const d = typeof dateIso === "string" ? new Date(dateIso) : dateIso;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

function formatWeekRange(weekStart: Date, weekEnd: Date): string {
  // weekEnd est dimanche, mais on veut afficher jusqu'au vendredi (jour ouvré)
  const friday = new Date(weekEnd);
  friday.setUTCDate(friday.getUTCDate() - 2);
  return `${formatDateShort(weekStart)} → ${formatDateShort(friday)}`;
}

function getTypeBadgeColor(type: "TASK" | "BUG" | "FEATURE"): string {
  switch (type) {
    case "BUG":
      return "bg-red-100 text-red-800";
    case "FEATURE":
      return "bg-purple-100 text-purple-800";
    case "TASK":
      return "bg-blue-100 text-blue-800";
  }
}

export function CapacityTimeline({
  projectKey,
  weeks,
  p1Tickets,
  hasPlan,
  planGeneratedAt,
  projectedEndDate,
  leftoverMinutes,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  // Stats
  const totalP1Minutes = p1Tickets.reduce(
    (sum, t) => sum + t.estimatedMinutes,
    0
  );
  const totalCapacityMinutes = weeks.reduce(
    (sum, w) => sum + w.totalDays * MINUTES_PER_DAY,
    0
  );
  const developersCount = weeks[0]?.perDeveloper.length ?? 0;

  const handlePlace = () => {
    setPending(true);
    startTransition(async () => {
      const res = await autoPlaceP1Action({ projectKey, weeksCount: 12 });
      setPending(false);
      if (!res.ok) {
        const msg = {
          VALIDATION: "Données invalides",
          FORBIDDEN: "Vous n'avez pas les droits",
          NOT_FOUND: "Projet introuvable",
          RATE_LIMITED: "Trop de calculs rapides, réessayez dans quelques minutes",
          NO_DEVELOPERS: "Aucun développeur actif dans l'équipe",
        }[res.error];
        toast.error(msg ?? "Erreur");
        return;
      }
      const planText =
        res.unplacedTicketsCount > 0
          ? `Plan généré (${res.allocationsCount} allocations, ${res.unplacedTicketsCount} ticket(s) non placé(s))`
          : `Plan généré (${res.allocationsCount} allocations)`;
      toast.success(planText);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Barre de stats + bouton placement */}
      <div className="flex items-center gap-4 px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Équipe :</span>
          <strong>{developersCount} dev{developersCount > 1 ? "s" : ""}</strong>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Capacité {weeks.length}sem :</span>
          <strong>{formatDays(totalCapacityMinutes)}</strong>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Charge P1 :</span>
          <strong className={totalP1Minutes > totalCapacityMinutes ? "text-red-600" : ""}>
            {formatDays(totalP1Minutes)}
          </strong>
          <span className="text-muted-foreground">
            ({p1Tickets.length} ticket{p1Tickets.length > 1 ? "s" : ""})
          </span>
        </div>

        {hasPlan && projectedEndDate && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Fin projetée :</span>
            <strong className="text-blue-700">
              {formatDateShort(projectedEndDate)}
            </strong>
          </div>
        )}

        {hasPlan && leftoverMinutes > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-orange-700">
            <AlertTriangle className="h-4 w-4" />
            <strong>{formatDays(leftoverMinutes)} non placés</strong>
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {hasPlan && planGeneratedAt && (
            <span className="text-xs text-muted-foreground">
              Plan calculé le{" "}
              {new Date(planGeneratedAt).toLocaleString("fr-FR", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          <Button onClick={handlePlace} disabled={pending} size="sm">
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Calcul…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                {hasPlan ? "Recalculer" : "Placement automatique"}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* État vide : pas de P1 */}
      {p1Tickets.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="text-lg">Aucun ticket P1 à planifier</p>
            <p className="text-sm mt-1">
              Les tickets P1 (priorité 1) chiffrés et non terminés apparaîtront ici.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          {/* Liste des P1 (panneau gauche) + Timeline (panneau droit) */}
          <div className="grid grid-cols-[300px_1fr] gap-4 min-h-full">
            {/* P1 backlog */}
            <div className="border rounded-md bg-card">
              <div className="px-3 py-2 border-b bg-muted/50">
                <h2 className="text-sm font-semibold">Backlog P1</h2>
                <p className="text-xs text-muted-foreground">
                  Ordre : FIFO (créés en premier traités en premier)
                </p>
              </div>
              <ul className="divide-y">
                {p1Tickets.map((t) => (
                  <li key={t.id} className="px-3 py-2 hover:bg-muted/30">
                    <Link
                      href={`/tickets/${t.key}`}
                      className="flex flex-col gap-1"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${getTypeBadgeColor(t.type)}`}
                        >
                          {t.type}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {t.key}
                        </span>
                        <span className="ml-auto text-xs font-medium">
                          {formatDays(t.estimatedMinutes)}
                        </span>
                      </div>
                      <span className="text-sm line-clamp-2">{t.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Timeline des semaines */}
            <div className="overflow-x-auto">
              <div className="flex gap-2 min-h-full">
                {weeks.map((week) => {
                  const usedMinutes = week.allocations.reduce(
                    (s, a) => s + a.allocatedMinutes,
                    0
                  );
                  const capacityMinutes = week.totalDays * MINUTES_PER_DAY;
                  const fillPercent =
                    capacityMinutes > 0
                      ? Math.min(100, (usedMinutes / capacityMinutes) * 100)
                      : 0;

                  return (
                    <div
                      key={week.weekStart.toString()}
                      className="flex flex-col w-48 shrink-0 border rounded-md bg-card"
                    >
                      {/* En-tête semaine */}
                      <div className="px-2 py-2 border-b bg-muted/50">
                        <div className="text-xs font-medium">
                          {formatWeekRange(week.weekStart, week.weekEnd)}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted-foreground">
                            {week.totalEtp} ETP
                          </span>
                          <span className="text-xs font-medium">
                            {formatDays(capacityMinutes)}
                          </span>
                        </div>
                        {week.holidayDays > 0 && (
                          <div className="text-[10px] text-orange-700 mt-0.5">
                            {week.holidayDays} férié{week.holidayDays > 1 ? "s" : ""}
                          </div>
                        )}
                        {/* Barre de remplissage */}
                        <div className="h-1.5 bg-gray-200 rounded-full mt-1.5 overflow-hidden">
                          <div
                            className={`h-full ${
                              fillPercent >= 100
                                ? "bg-red-500"
                                : fillPercent >= 80
                                  ? "bg-orange-500"
                                  : "bg-green-500"
                            }`}
                            style={{ width: `${fillPercent}%` }}
                          />
                        </div>
                      </div>

                      {/* Allocations */}
                      <div className="flex-1 p-1.5 space-y-1">
                        {week.allocations.length === 0 ? (
                          <div className="text-[11px] text-muted-foreground text-center py-2">
                            Vide
                          </div>
                        ) : (
                          week.allocations.map((a) => (
                            <Link
                              key={`${a.ticketId}-${a.position}`}
                              href={`/tickets/${a.ticketKey}`}
                              className="block rounded border bg-background hover:border-blue-400 px-1.5 py-1"
                            >
                              <div className="flex items-center gap-1">
                                <span
                                  className={`text-[9px] font-mono px-1 py-0.5 rounded ${getTypeBadgeColor(a.type)}`}
                                >
                                  {a.type[0]}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  {a.ticketKey}
                                </span>
                                <span className="ml-auto text-[10px] font-semibold">
                                  {formatDays(a.allocatedMinutes)}
                                </span>
                              </div>
                              <div className="text-[11px] line-clamp-2 mt-0.5">
                                {a.title}
                              </div>
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, FlaskConical, Sparkles, User, Wrench } from "lucide-react";
import { cn, formatDate, formatDays } from "@/lib/utils";
import { TICKET_TYPE_META, getPriorityMeta } from "@/lib/tickets/metadata";
import { isOverBudget } from "@/lib/tickets/types";
import type { KanbanTicket } from "@/lib/tickets/types";
import { KanbanTestButton } from "./KanbanTestButton";

/**
 * Formate une date avec date + heure + minutes + secondes (heure de Paris).
 * Utilise pour M2.2 : afficher l'horodatage exact des bugs sur la carte Kanban.
 */
function formatDateTimeFull(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Paris",
  });
}

interface Props {
  ticket: KanbanTicket;
  currentUserId: string;
  /** Affichage spécial pour le DragOverlay (carte suivant le curseur) */
  isOverlay?: boolean;
}

export function TicketCard({ ticket, currentUserId, isOverlay = false }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ticket.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  const typeMeta = TICKET_TYPE_META[ticket.type];
  const TypeIcon = typeMeta.icon;
  const isMine = ticket.assignee?.id === currentUserId;
  const overBudget = isOverBudget(ticket.rollup);
  const priority = getPriorityMeta(ticket.priority);

  // Règle demandée : afficher "Estimé initial / Atterrissage (loggé + RAF)"
  // La vue SQL fournit déjà totalProjectedMinutes = loggé + reste, et
  // totalEstimatedMinutes = estimation initiale (soi + descendants).
  const estimatedDisplay = formatDays(
    ticket.rollup?.totalEstimatedMinutes ?? ticket.estimatedMinutes
  );
  const projectedDisplay = formatDays(
    ticket.rollup?.totalProjectedMinutes ?? ticket.loggedMinutes
  );
  const progress = ticket.rollup?.progressPercent ?? 0;

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-roledescription="Ticket déplaçable"
      aria-label={`${ticket.key}: ${ticket.title}`}
      className={cn(
        "group relative rounded-md border bg-card p-3 shadow-sm cursor-grab active:cursor-grabbing",
        "hover:shadow-md hover:border-primary/40 transition-all",
        isDragging && !isOverlay && "opacity-40",
        isOverlay && "shadow-xl ring-2 ring-primary rotate-2",
        isMine && !isOverlay && "ring-1 ring-primary/30"
      )}
    >
      {/* Header : type icon + key + priority */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <TypeIcon className={cn("w-3.5 h-3.5", typeMeta.iconColor)} aria-hidden />
          <Link
            href={`/tickets/${ticket.key}`}
            className="text-xs font-mono text-muted-foreground hover:text-foreground hover:underline"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {ticket.key}
          </Link>
        </div>
        {ticket.priority <= 2 && (
          <span
            className={cn(
              "text-[10px] font-semibold px-1.5 rounded uppercase tabular-nums",
              priority.variant === "destructive"
                ? "bg-red-500/15 text-red-600"
                : "bg-amber-500/15 text-amber-600"
            )}
          >
            {priority.shortLabel}
          </span>
        )}
      </div>

      {/* Titre */}
      <h4 className="text-sm font-medium leading-snug mb-2 line-clamp-2">{ticket.title}</h4>

      {/* Badge "À estimer" — Feature sans enfant Task/Bug */}
      {ticket.needsEstimation && (
        <div className="mb-2">
          <Link
            href="/estimations"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300 transition-colors"
            title="Cette Feature n'a pas encore été décomposée en tâches. Cliquez pour lancer la session d'estimation."
          >
            <Sparkles className="w-3 h-3" aria-hidden />
            À estimer
          </Link>
        </div>
      )}

      {/* Badge TODO — tâche non chiffrée */}
      {ticket.isEstimated === false && (
        <div className="mb-2">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-500/15 text-slate-700 dark:text-slate-300"
            title="Tâche TODO : non chiffrée, ne compte pas dans l'atterrissage de la Feature parente."
          >
            <CheckCircle2 className="w-3 h-3" aria-hidden />
            TODO · Hors estimation
          </span>
        </div>
      )}

      {/* Badge Technique — Feature ou Task marquee comme technique */}
      {ticket.isTechnical && (
        <div className="mb-2">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
            title="Ticket technique (refactor, infrastructure, dette technique)"
          >
            <Wrench className="w-3 h-3" aria-hidden />
            Technique
          </span>
        </div>
      )}

      {/* Parent Feature : affichage enrichi pour les bugs escaladés */}
      {ticket.parentKey && (
        <p
          className="text-[10px] text-muted-foreground mb-2 truncate"
          title={
            ticket.parentTitle
              ? `Feature parente : ${ticket.parentKey} — ${ticket.parentTitle}`
              : undefined
          }
        >
          {`\u2196 ${ticket.parentKey}`}
          {ticket.parentTitle && (
            <span className="ml-1">— {ticket.parentTitle}</span>
          )}
        </p>
      )}

      {/* F05.3 + M2.2 : panneau enrichi de provenance RUN pour les bugs escaladés.
          Affiche : nom complet Feature parente, horodatage exact, nom du RUN source,
          lien direct vers les specs en lecture seule. */}
      {ticket.sourceRunKey && (
        <div
          className="mb-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50 p-2 text-[10px] space-y-1"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
            <Sparkles className="w-3 h-3" aria-hidden />
            Bug issu d&apos;un RUN
          </div>
          {ticket.parentFullTitle && ticket.parentKey && (
            <div className="text-amber-900 dark:text-amber-200">
              <span className="font-medium">Feature :</span>{" "}
              <Link
                href={`/tickets/${ticket.parentKey}/specs`}
                className="font-mono hover:underline"
                title="Voir les specs de la Feature parente (lecture seule)"
              >
                {ticket.parentKey}
              </Link>{" "}
              — {ticket.parentFullTitle}
            </div>
          )}
          {ticket.sourceRunName && (
            <div className="text-amber-900 dark:text-amber-200">
              <span className="font-medium">RUN source :</span>{" "}
              <Link
                href={`/projects/${ticket.sourceRunKey}/board`}
                className="font-mono hover:underline"
              >
                {ticket.sourceRunKey}
              </Link>{" "}
              — {ticket.sourceRunName}
            </div>
          )}
          {ticket.createdAt && (
            <div className="text-amber-900 dark:text-amber-200">
              <span className="font-medium">Créé le :</span>{" "}
              {formatDateTimeFull(ticket.createdAt)}
            </div>
          )}
        </div>
      )}

      {/* Date de fin prévue */}
      {ticket.endDate && (
        <p
          className="text-[10px] text-muted-foreground mb-2 inline-flex items-center gap-1"
          title="Date de fin prévue"
        >
          <CalendarClock className="w-3 h-3" aria-hidden />
          Fin : {formatDate(ticket.endDate)}
        </p>
      )}

      {/* Phase 3 : alerte si l'assignee a un conge sur la periode du ticket */}
      {ticket.leaveAlert && (
        <div
          className={
            ticket.leaveAlert.severity === "full"
              ? "mb-2 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-red-500/15 text-red-700 dark:text-red-300"
              : "mb-2 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-300"
          }
          title={
            ticket.leaveAlert.severity === "full"
              ? `L'assignee est en conge sur TOUTE la periode du ticket (du ${ticket.leaveAlert.overlapStart} au ${ticket.leaveAlert.overlapEnd}, ${ticket.leaveAlert.overlapDays} jours).`
              : `L'assignee est en conge ${ticket.leaveAlert.overlapDays} jour(s) sur la periode du ticket (du ${ticket.leaveAlert.overlapStart} au ${ticket.leaveAlert.overlapEnd}).`
          }
        >
          <AlertTriangle className="w-3 h-3" aria-hidden />
          {ticket.leaveAlert.severity === "full"
            ? "Conge total"
            : `Conge partiel (${ticket.leaveAlert.overlapDays}j)`}
        </div>
      )}

      {/* Progress bar (si estimation > 0) */}
      {ticket.rollup && ticket.rollup.totalEstimatedMinutes > 0 && (
        <div className="mb-2 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full transition-all", overBudget ? "bg-destructive" : "bg-primary")}
            style={{ width: `${Math.min(progress, 100)}%` }}
            aria-hidden
          />
        </div>
      )}

      {/* Footer : estimé / atterrissage, tests, assignee */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex items-center gap-1 tabular-nums",
              overBudget && "text-destructive font-medium"
            )}
            title={`Estimé initial : ${estimatedDisplay} · Atterrissage (loggé + reste) : ${projectedDisplay}`}
          >
            <Clock className="w-3 h-3" aria-hidden />
            {estimatedDisplay}/{projectedDisplay}
          </span>

          {ticket.testStats && ticket.testStats.total > 0 && (
            <span
              className={cn(
                "flex items-center gap-1",
                ticket.testStats.failed > 0 ? "text-red-500" : "text-green-600"
              )}
              title={`${ticket.testStats.passed} OK / ${ticket.testStats.failed} KO / ${ticket.testStats.total}`}
            >
              <FlaskConical className="w-3 h-3" aria-hidden />
              {ticket.testStats.passed}/{ticket.testStats.total}
            </span>
          )}

          {/* M2.1 : bouton "Tester" sur les Features/US qui ont des cas de test */}
          {ticket.testStats &&
            ticket.testStats.total > 0 &&
            (ticket.type === "FEATURE" || ticket.type === "USER_STORY") && (
              <KanbanTestButton ticketId={ticket.id} ticketKey={ticket.key} />
            )}
        </div>

        {ticket.assignee ? (
          <Avatar name={ticket.assignee.name} />
        ) : (
          <User className="w-4 h-4 opacity-40" aria-label="Non assigné" />
        )}
      </div>
    </article>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      aria-label={`Assigné à ${name}`}
      title={name}
      className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold grid place-items-center"
    >
      {initials}
    </div>
  );
}

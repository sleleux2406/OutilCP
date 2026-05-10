"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, FlaskConical, User } from "lucide-react";
import { cn, formatDays } from "@/lib/utils";
import { TICKET_TYPE_META, getPriorityMeta } from "@/lib/tickets/metadata";
import { isOverBudget } from "@/lib/tickets/types";
import type { KanbanTicket } from "@/lib/tickets/types";

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

  const loggedDisplay = formatDays(ticket.rollup?.totalLoggedMinutes ?? ticket.loggedMinutes);
  const estimatedDisplay = formatDays(ticket.rollup?.totalEstimatedMinutes ?? ticket.estimatedMinutes);
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

      {ticket.parentKey && (
        <p className="text-[10px] text-muted-foreground mb-2 truncate">↖ {ticket.parentKey}</p>
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

      {/* Footer : temps, tests, assignee */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex items-center gap-1 tabular-nums",
              overBudget && "text-destructive font-medium"
            )}
            title={`${loggedDisplay} loggés / ${estimatedDisplay} estimés`}
          >
            <Clock className="w-3 h-3" aria-hidden />
            {loggedDisplay}/{estimatedDisplay}
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

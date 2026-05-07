"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { KanbanTicket } from "@/lib/tickets/types";
import type { KanbanColumnConfig } from "@/lib/kanban/columns";
import { TicketCard } from "./TicketCard";

interface Props {
  column: KanbanColumnConfig;
  tickets: KanbanTicket[];
  currentUserId: string;
}

export function KanbanColumn({ column, tickets, currentUserId }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  const count = tickets.length;
  const overLimit = column.wipLimit !== undefined && count > column.wipLimit;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col w-80 shrink-0 rounded-lg border bg-muted/30 transition-colors",
        isOver && "bg-muted/60 ring-2 ring-primary/50"
      )}
      aria-label={`Colonne ${column.label}, ${count} ticket${count > 1 ? "s" : ""}`}
    >
      <header className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("w-2 h-2 rounded-full shrink-0", column.dotColor)} aria-hidden />
          <h3 className="text-sm font-semibold truncate">{column.label}</h3>
          <span
            className={cn(
              "text-xs px-1.5 py-0.5 rounded-full tabular-nums shrink-0",
              overLimit ? "bg-destructive/20 text-destructive" : "bg-muted"
            )}
          >
            {count}
            {column.wipLimit ? ` / ${column.wipLimit}` : ""}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px]">
        {count === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">Déposer un ticket ici</p>
        ) : (
          tickets.map((t) => <TicketCard key={t.id} ticket={t} currentUserId={currentUserId} />)
        )}
      </div>
    </div>
  );
}

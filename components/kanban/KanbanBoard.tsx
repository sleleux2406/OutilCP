"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TicketStatus } from "@prisma/client";
import type { KanbanTicket } from "@/lib/tickets/types";
import { KANBAN_COLUMNS, isColumnId } from "@/lib/kanban/columns";
import { computeNewOrder } from "@/lib/kanban/order";
import { useMoveTicket } from "@/lib/kanban/useMoveTicket";
import { KanbanColumn } from "./KanbanColumn";
import { TicketCard } from "./TicketCard";

interface Props {
  projectId: string;
  initialTickets: KanbanTicket[];
  currentUserId: string;
}

export function KanbanBoard({ projectId, initialTickets, currentUserId }: Props) {
  const qc = useQueryClient();
  const queryKey = ["kanban", projectId] as const;

  // TanStack Query stocke le tableau en cache ; on initialise avec la donnée SSR
  const { data: tickets = initialTickets } = useQuery<KanbanTicket[]>({
    queryKey,
    queryFn: async () => initialTickets,
    initialData: initialTickets,
    staleTime: Infinity, // la source de vérité passe par optimistic updates + revalidatePath
  });

  // Resync si la page est remontée avec de nouveaux props (revalidatePath côté serveur)
  useEffect(() => {
    qc.setQueryData<KanbanTicket[]>(queryKey, initialTickets);
  }, [initialTickets, qc, queryKey]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const move = useMoveTicket(projectId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Regroupement par colonne, trié par boardOrder
  const byColumn = useMemo(() => {
    const map = new Map<TicketStatus, KanbanTicket[]>();
    for (const col of KANBAN_COLUMNS) map.set(col.id, []);
    for (const t of tickets) map.get(t.status)?.push(t);
    for (const list of map.values()) list.sort((a, b) => a.boardOrder - b.boardOrder);
    return map;
  }, [tickets]);

  const activeTicket = activeId ? tickets.find((t) => t.id === activeId) ?? null : null;

  const findColumn = (id: string): TicketStatus | null => {
    if (isColumnId(id)) return id;
    return tickets.find((t) => t.id === id)?.status ?? null;
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  // Feedback visuel inter-colonnes pendant le drag
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeCol = findColumn(String(active.id));
    const overCol = findColumn(String(over.id));
    if (!activeCol || !overCol || activeCol === overCol) return;

    qc.setQueryData<KanbanTicket[]>(queryKey, (old) =>
      (old ?? []).map((t) => (t.id === active.id ? { ...t, status: overCol } : t))
    );
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const aId = String(active.id);
    const oId = String(over.id);
    const targetStatus = findColumn(oId);
    if (!targetStatus) return;

    // Recalcule l'index de destination à partir de l'état courant
    const current = qc.getQueryData<KanbanTicket[]>(queryKey) ?? tickets;
    const columnTickets = current
      .filter((t) => t.status === targetStatus && t.id !== aId)
      .sort((a, b) => a.boardOrder - b.boardOrder);

    let destIndex: number;
    if (isColumnId(oId)) {
      destIndex = columnTickets.length;
    } else {
      destIndex = columnTickets.findIndex((t) => t.id === oId);
      if (destIndex < 0) destIndex = columnTickets.length;
    }

    const prev = columnTickets[destIndex - 1]?.boardOrder ?? null;
    const next = columnTickets[destIndex]?.boardOrder ?? null;
    const newOrder = computeNewOrder(prev, next);

    move.mutate(
      { ticketId: aId, toStatus: targetStatus, newOrder },
      {
        onError: (err) => {
          const msg =
            err instanceof Error && err.message === "FORBIDDEN"
              ? "Vous n'êtes pas autorisé à déplacer ce ticket"
              : "Déplacement impossible. Les changements ont été annulés.";
          toast.error(msg);
        },
      }
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Ticket ${active.id} saisi.`,
          onDragOver: ({ active, over }) =>
            over ? `Ticket ${active.id} au-dessus de ${over.id}.` : "",
          onDragEnd: ({ active, over }) =>
            over ? `Ticket ${active.id} déposé sur ${over.id}.` : "Déplacement annulé.",
          onDragCancel: () => "Déplacement annulé.",
        },
      }}
    >
      <div
        className="flex gap-4 overflow-x-auto p-4 h-[calc(100vh-7rem)]"
        role="region"
        aria-label="Tableau Kanban"
      >
        {KANBAN_COLUMNS.map((col) => {
          const colTickets = byColumn.get(col.id) ?? [];
          return (
            <SortableContext
              key={col.id}
              id={col.id}
              items={colTickets.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <KanbanColumn column={col} tickets={colTickets} currentUserId={currentUserId} />
            </SortableContext>
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeTicket ? (
          <TicketCard ticket={activeTicket} isOverlay currentUserId={currentUserId} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

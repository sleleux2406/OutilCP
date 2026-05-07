import { TicketStatus } from "@prisma/client";

/**
 * Configuration des colonnes Kanban.
 * L'ordre ci-dessous est l'ordre d'affichage gauche → droite.
 */
export interface KanbanColumnConfig {
  id: TicketStatus;
  label: string;
  dotColor: string;
  /** Limite WIP (Work In Progress) — dépassement = alerte visuelle, pas de blocage. */
  wipLimit?: number;
}

export const KANBAN_COLUMNS: KanbanColumnConfig[] = [
  { id: "BACKLOG", label: "Backlog", dotColor: "bg-slate-500" },
  { id: "TODO", label: "À faire", dotColor: "bg-blue-500" },
  { id: "IN_PROGRESS", label: "En cours", dotColor: "bg-amber-500", wipLimit: 5 },
  { id: "IN_REVIEW", label: "Revue", dotColor: "bg-purple-500", wipLimit: 3 },
  { id: "IN_TESTING", label: "Test", dotColor: "bg-cyan-500" },
  { id: "DONE", label: "Terminé", dotColor: "bg-green-500" },
  { id: "BLOCKED", label: "Bloqué", dotColor: "bg-red-500" },
];

export const COLUMN_IDS = new Set<TicketStatus>(KANBAN_COLUMNS.map((c) => c.id));

export function isColumnId(id: string): id is TicketStatus {
  return COLUMN_IDS.has(id as TicketStatus);
}

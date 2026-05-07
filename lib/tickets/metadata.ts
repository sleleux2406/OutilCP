import { TicketStatus, TicketType } from "@prisma/client";
import {
  Bug,
  BookOpen,
  Mountain,
  CheckSquare,
  ListTodo,
  type LucideIcon,
} from "lucide-react";

/**
 * Source unique pour tout ce qui est présentation visuelle des tickets.
 * Évite la duplication des mappings icône/couleur/label à travers l'app.
 */

export interface TypeMeta {
  icon: LucideIcon;
  label: string;
  /** Classe Tailwind color appliquée à l'icône */
  iconColor: string;
  /** Classe pour fond léger (badge, carte) */
  bgColor: string;
}

export const TICKET_TYPE_META: Record<TicketType, TypeMeta> = {
  EPIC: {
    icon: Mountain,
    label: "Epic",
    iconColor: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
  FEATURE: {
    icon: CheckSquare,
    label: "Feature",
    iconColor: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
  },
  USER_STORY: {
    icon: BookOpen,
    label: "User Story",
    iconColor: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  TASK: {
    icon: ListTodo,
    label: "Tâche",
    iconColor: "text-slate-500",
    bgColor: "bg-slate-500/10",
  },
  BUG: {
    icon: Bug,
    label: "Bug",
    iconColor: "text-red-500",
    bgColor: "bg-red-500/10",
  },
};

export interface StatusMeta {
  label: string;
  /** Pastille colorée dans les en-têtes de colonne Kanban */
  dotColor: string;
  /** Variante du composant Badge */
  badgeVariant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";
}

export const TICKET_STATUS_META: Record<TicketStatus, StatusMeta> = {
  BACKLOG: { label: "Backlog", dotColor: "bg-slate-500", badgeVariant: "secondary" },
  TODO: { label: "À faire", dotColor: "bg-blue-500", badgeVariant: "info" },
  IN_PROGRESS: { label: "En cours", dotColor: "bg-amber-500", badgeVariant: "warning" },
  IN_REVIEW: { label: "Revue", dotColor: "bg-purple-500", badgeVariant: "secondary" },
  IN_TESTING: { label: "Test", dotColor: "bg-cyan-500", badgeVariant: "info" },
  DONE: { label: "Terminé", dotColor: "bg-green-500", badgeVariant: "success" },
  BLOCKED: { label: "Bloqué", dotColor: "bg-red-500", badgeVariant: "destructive" },
};

export interface PriorityMeta {
  label: string;
  shortLabel: string;
  variant: "destructive" | "warning" | "secondary" | "outline";
}

export const PRIORITY_META: Record<number, PriorityMeta> = {
  1: { label: "P1 — Bloquant", shortLabel: "P1", variant: "destructive" },
  2: { label: "P2 — Critique", shortLabel: "P2", variant: "warning" },
  3: { label: "P3 — Majeur", shortLabel: "P3", variant: "secondary" },
  4: { label: "P4 — Mineur", shortLabel: "P4", variant: "outline" },
  5: { label: "P5 — Cosmétique", shortLabel: "P5", variant: "outline" },
};

/** Garantit qu'on renvoie toujours un meta valide même si valeur hors range. */
export function getPriorityMeta(priority: number): PriorityMeta {
  return PRIORITY_META[priority] ?? PRIORITY_META[3];
}

import { z } from "zod";
import { TicketStatus, TicketType } from "@prisma/client";

/**
 * Schémas Zod partagés pour la validation des tickets.
 * Ces schémas sont utilisés à la fois côté client (validation du form)
 * ET côté serveur (Server Actions). Source unique de vérité = sécurité [A03].
 */

// Bornes techniques (alignées sur les CHECK constraints SQL)
export const TITLE_MIN = 3;
export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 10_000;
export const ESTIMATED_MIN = 0;
export const ESTIMATED_MAX = 60 * 24 * 30; // 30 jours-homme max
export const PRIORITY_MIN = 1;
export const PRIORITY_MAX = 5;

export const CreateTicketSchema = z.object({
  projectId: z.string().cuid(),
  type: z.nativeEnum(TicketType),
  title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX),
  description: z.string().trim().max(DESCRIPTION_MAX).optional(),
  parentId: z.string().cuid().nullable().optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  priority: z.number().int().min(PRIORITY_MIN).max(PRIORITY_MAX).default(3),
  estimatedMinutes: z.number().int().min(ESTIMATED_MIN).max(ESTIMATED_MAX).default(0),
});
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

export const UpdateTicketSchema = z.object({
  ticketId: z.string().cuid(),
  title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX).optional(),
  description: z.string().trim().max(DESCRIPTION_MAX).nullable().optional(),
  priority: z.number().int().min(PRIORITY_MIN).max(PRIORITY_MAX).optional(),
  estimatedMinutes: z.number().int().min(ESTIMATED_MIN).max(ESTIMATED_MAX).optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  status: z.nativeEnum(TicketStatus).optional(),
});
export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;

export const LogTimeSchema = z.object({
  ticketId: z.string().cuid(),
  // Max 30 jours par entrée = 14400 min (aligné CHECK SQL time_entry_minutes_positive)
  minutes: z.number().int().positive().max(14400),
  description: z.string().trim().max(500).optional(),
});
export type LogTimeInput = z.infer<typeof LogTimeSchema>;

export const MoveTicketSchema = z.object({
  ticketId: z.string().cuid(),
  toStatus: z.nativeEnum(TicketStatus),
  newOrder: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type MoveTicketInput = z.infer<typeof MoveTicketSchema>;

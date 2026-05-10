import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { RollupRow } from "@/lib/tickets/types";

/**
 * Accès typé à la vue SQL récursive `ticket_rollup`.
 *
 * La vue agrège pour chaque ticket :
 *   - temps estimé et loggé (lui + tous descendants)
 *   - coût (minutes × taux horaire utilisateur, en centimes)
 *   - comptage enfants par type (US, Bug, Feature, Task)
 *   - progression en %
 *
 * Toutes les requêtes passent par Prisma.$queryRaw avec interpolation
 * tagged-template (paramétrée → safe A03).
 */

/**
 * Schéma Zod pour valider les lignes retournées par Postgres.
 * Protection contre une modification de la vue qui casserait les types.
 */
const RollupRowSchema = z.object({
  ticketId: z.string(),
  // Postgres SUM() peut retourner un bigint même après ::int selon le driver.
  // On accepte number ET bigint, puis on transforme en number.
  totalEstimatedMinutes: z
    .union([z.number(), z.bigint()])
    .transform((v) => (typeof v === "bigint" ? Number(v) : v)),
  totalLoggedMinutes: z
    .union([z.number(), z.bigint()])
    .transform((v) => (typeof v === "bigint" ? Number(v) : v)),
  totalCostCents: z.union([z.number(), z.bigint()]).transform((v) =>
    typeof v === "bigint" ? Number(v) : v
  ),
  usCount: z.union([z.number(), z.bigint()]).transform((v) => Number(v)),
  bugCount: z.union([z.number(), z.bigint()]).transform((v) => Number(v)),
  featureCount: z.union([z.number(), z.bigint()]).transform((v) => Number(v)),
  taskCount: z.union([z.number(), z.bigint()]).transform((v) => Number(v)),
  progressPercent: z.union([z.number(), z.string()]).transform((v) =>
    typeof v === "string" ? parseFloat(v) : v
  ),
});

/**
 * Roll-up d'un unique ticket.
 * Retourne un objet avec des valeurs zéro si le ticket n'a aucun descendant.
 */
export async function getTicketRollup(ticketId: string): Promise<RollupRow> {
  const rows = await prisma.$queryRaw<unknown[]>`
    SELECT
      "ticketId", "totalEstimatedMinutes", "totalLoggedMinutes",
      "totalCostCents", "usCount", "bugCount", "featureCount", "taskCount",
      "progressPercent"
    FROM ticket_rollup
    WHERE "ticketId" = ${ticketId}
    LIMIT 1
  `;

  const parsed = RollupRowSchema.safeParse(rows[0]);
  if (parsed.success) return parsed.data;

  // Valeurs neutres : ticket sans descendants ni temps loggé
  return {
    ticketId,
    totalEstimatedMinutes: 0,
    totalLoggedMinutes: 0,
    totalCostCents: 0,
    usCount: 0,
    bugCount: 0,
    featureCount: 0,
    taskCount: 0,
    progressPercent: 0,
  };
}

/**
 * Roll-ups de TOUS les tickets d'un projet en une seule requête.
 * Utilisé par le Kanban et le Dashboard CP pour éviter les N+1.
 *
 * Retourne un Map<ticketId, RollupRow> pour accès O(1) côté rendu.
 */
export async function getProjectRollups(projectId: string): Promise<Map<string, RollupRow>> {
  const rows = await prisma.$queryRaw<unknown[]>`
    SELECT
      r."ticketId", r."totalEstimatedMinutes", r."totalLoggedMinutes",
      r."totalCostCents", r."usCount", r."bugCount", r."featureCount", r."taskCount",
      r."progressPercent"
    FROM ticket_rollup r
    JOIN "Ticket" t ON t.id = r."ticketId"
    WHERE t."projectId" = ${projectId}
  `;

  const map = new Map<string, RollupRow>();
  for (const raw of rows) {
    const parsed = RollupRowSchema.safeParse(raw);
    if (parsed.success) {
      map.set(parsed.data.ticketId, parsed.data);
    }
  }
  return map;
}

/**
 * Roll-ups des tickets racines (Epics) d'un projet.
 * Pratique pour le Dashboard CP où on n'affiche que les Epics en haut niveau.
 */
export async function getEpicsRollups(projectId: string): Promise<Map<string, RollupRow>> {
  const rows = await prisma.$queryRaw<unknown[]>`
    SELECT
      r."ticketId", r."totalEstimatedMinutes", r."totalLoggedMinutes",
      r."totalCostCents", r."usCount", r."bugCount", r."featureCount", r."taskCount",
      r."progressPercent"
    FROM ticket_rollup r
    JOIN "Ticket" t ON t.id = r."ticketId"
    WHERE t."projectId" = ${projectId} AND t.type = 'EPIC'
  `;

  const map = new Map<string, RollupRow>();
  for (const raw of rows) {
    const parsed = RollupRowSchema.safeParse(raw);
    if (parsed.success) {
      map.set(parsed.data.ticketId, parsed.data);
    }
  }
  return map;
}

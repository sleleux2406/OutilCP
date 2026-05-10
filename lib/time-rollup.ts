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
 * Robustesse : PostgreSQL + le driver `pg` peuvent retourner des nombres
 * sous 4 formes selon le type SQL et la version :
 *   - number (petits entiers natifs)
 *   - bigint (SUM sur int → bigint en JavaScript)
 *   - string (numeric / decimal → string pour préserver la précision)
 *   - Prisma.Decimal (objet avec toString())
 * On normalise tout en `number` JavaScript via toNumber().
 */
function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return parseFloat(v);
  if (v && typeof v === "object" && "toString" in v) {
    const n = parseFloat(String(v));
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

const numericLike = z.unknown().transform(toNumber);

const RollupRowSchema = z.object({
  ticketId: z.string(),
  totalEstimatedMinutes: numericLike,
  totalLoggedMinutes: numericLike,
  totalCostCents: numericLike,
  usCount: numericLike,
  bugCount: numericLike,
  featureCount: numericLike,
  taskCount: numericLike,
  progressPercent: numericLike,
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

  // Valeurs neutres : ticket absent de la vue
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

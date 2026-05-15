import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { RollupRow } from "@/lib/tickets/types";

/**
 * Accès typé à la vue SQL récursive `ticket_rollup`.
 *
 * La vue agrège pour chaque ticket :
 *   - temps estimé initial (soi + descendants)
 *   - temps loggé total
 *   - reste à faire total (saisi manuellement, avec fallback)
 *   - projection totale (loggé + reste)
 *   - variance (projection − estimation) — positif = dépassement
 *   - comptage enfants par type
 *   - progression en %
 */

/**
 * Normalise les valeurs numériques qui peuvent arriver sous plusieurs formes
 * depuis Postgres/Prisma (number, bigint, string, Decimal).
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
  totalRemainingMinutes: numericLike,
  totalRemainingSelfMinutes: numericLike,
  totalRemainingChildrenMinutes: numericLike,
  totalProjectedMinutes: numericLike,
  varianceMinutes: numericLike,
  usCount: numericLike,
  bugCount: numericLike,
  featureCount: numericLike,
  taskCount: numericLike,
  progressPercent: numericLike,
});

const COLUMNS = `
  "ticketId", "totalEstimatedMinutes", "totalLoggedMinutes",
  "totalRemainingMinutes", "totalRemainingSelfMinutes", "totalRemainingChildrenMinutes",
  "totalProjectedMinutes", "varianceMinutes",
  "usCount", "bugCount", "featureCount", "taskCount", "progressPercent"
`;

function emptyRollup(ticketId: string): RollupRow {
  return {
    ticketId,
    totalEstimatedMinutes: 0,
    totalLoggedMinutes: 0,
    totalRemainingMinutes: 0,
    totalRemainingSelfMinutes: 0,
    totalRemainingChildrenMinutes: 0,
    totalProjectedMinutes: 0,
    varianceMinutes: 0,
    usCount: 0,
    bugCount: 0,
    featureCount: 0,
    taskCount: 0,
    progressPercent: 0,
  };
}

export async function getTicketRollup(ticketId: string): Promise<RollupRow> {
  const rows = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT ${COLUMNS} FROM ticket_rollup WHERE "ticketId" = $1 LIMIT 1`,
    ticketId
  );

  const parsed = RollupRowSchema.safeParse(rows[0]);
  if (parsed.success) return parsed.data;
  return emptyRollup(ticketId);
}

export async function getProjectRollups(
  projectId: string
): Promise<Map<string, RollupRow>> {
  const rows = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT ${COLUMNS} FROM ticket_rollup r
     JOIN "Ticket" t ON t.id = r."ticketId"
     WHERE t."projectId" = $1`,
    projectId
  );

  const map = new Map<string, RollupRow>();
  for (const raw of rows) {
    const parsed = RollupRowSchema.safeParse(raw);
    if (parsed.success) map.set(parsed.data.ticketId, parsed.data);
  }
  return map;
}

export async function getEpicsRollups(
  projectId: string
): Promise<Map<string, RollupRow>> {
  const rows = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT ${COLUMNS} FROM ticket_rollup r
     JOIN "Ticket" t ON t.id = r."ticketId"
     WHERE t."projectId" = $1 AND t.type = 'EPIC'`,
    projectId
  );

  const map = new Map<string, RollupRow>();
  for (const raw of rows) {
    const parsed = RollupRowSchema.safeParse(raw);
    if (parsed.success) map.set(parsed.data.ticketId, parsed.data);
  }
  return map;
}

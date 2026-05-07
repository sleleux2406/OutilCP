/**
 * Politique de rétention des données [SYM-GR-0014].
 *
 * À exécuter périodiquement via un cron (Vercel Cron, GitHub Actions,
 * or `pnpm tsx lib/retention.ts`).
 *
 * Ce script purge :
 *   - Les sessions expirées ou révoquées depuis > 7 jours
 *   - Les audit logs > 18 mois (conservation légale standard)
 *
 * Les tickets, time entries, test executions, attachments sont conservés
 * (historique projet). Pour une vraie application RGPD, ajouter ici :
 *   - Anonymisation des User supprimés (remplacer email par hash)
 *   - Suppression des attachments S3 référencés (dépend du bucket lifecycle)
 */

import { prisma } from "./prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionReport {
  sessionsDeleted: number;
  auditLogsDeleted: number;
}

export async function runRetention(now: Date = new Date()): Promise<RetentionReport> {
  const sessionCutoff = new Date(now.getTime() - 7 * DAY_MS);
  const auditCutoff = new Date(now.getTime() - 18 * 30 * DAY_MS); // ~18 mois

  const [{ count: sessionsDeleted }, { count: auditLogsDeleted }] = await Promise.all([
    prisma.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: sessionCutoff } }, { revokedAt: { lt: sessionCutoff } }],
      },
    }),
    prisma.auditLog.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    }),
  ]);

  return { sessionsDeleted, auditLogsDeleted };
}

// Execution directe : `pnpm tsx lib/retention.ts`
if (require.main === module) {
  runRetention()
    .then((r) => {
      console.log("Retention completed:", r);
      return prisma.$disconnect();
    })
    .catch((e) => {
      console.error("Retention failed:", e);
      process.exit(1);
    });
}

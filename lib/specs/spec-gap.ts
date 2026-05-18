import { prisma } from "@/lib/prisma";

/**
 * Compte les Features "en retard de documentation" :
 *   - statut IN_TESTING (case Test du tableau RUN)
 *   - sur les sous-projets RUN (project.parentProjectId IS NOT NULL)
 *   - dont la version actuelle (versionSpecsCourante) n'a pas encore ete exportee
 *     OU qui n'ont pas de versionSpecsCourante (anciennes Features)
 *
 * Module 1.3 : compteur pour le PO/Admin afin de voir en direct les Features
 * dont les specs ont evolue mais n'ont pas ete re-exportees dans le cahier
 * de tests / specs courantes.
 *
 * Une Feature compte si :
 *   - lastExportedAtVersion IS NULL (jamais exportee)
 *   - OU lastExportedAtVersion < versionSpecsCourante (export obsolete)
 *
 * Comportement de fallback : si une Feature n'a pas du tout de
 * versionSpecsCourante (ancienne donnee), on la compte aussi pour inciter
 * a regulariser.
 */
export async function countFeaturesInTestingOnRoots(): Promise<number> {
  // On utilise une raw query pour pouvoir comparer 2 colonnes (Prisma ne
  // permet pas directement la comparaison versionSpecsCourante != lastExportedAtVersion)
  // Comme Postgres est case-sensitive et que nos versions sont des strings,
  // on compare textuellement. La logique :
  //   - Status IN_TESTING
  //   - Type FEATURE
  //   - Sur un sous-projet RUN (Project.parentProjectId IS NOT NULL)
  //   - lastExportedAtVersion IS NULL OU != versionSpecsCourante
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Ticket" t
    JOIN "Project" p ON p.id = t."projectId"
    WHERE t.type = 'FEATURE'
      AND t.status = 'IN_TESTING'
      AND p."parentProjectId" IS NOT NULL
      AND (
        t."lastExportedAtVersion" IS NULL
        OR t."versionSpecsCourante" IS NULL
        OR t."lastExportedAtVersion" <> t."versionSpecsCourante"
      )
  `;

  const count = rows[0]?.count ?? BigInt(0);
  return Number(count);
}

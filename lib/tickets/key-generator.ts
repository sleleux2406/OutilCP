import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Génère la prochaine clé de ticket unique pour un projet (ex: "PROJ-142").
 *
 * Algorithme robuste :
 *   1. Lock PostgreSQL advisory transactionnel par projet (sérialise les créations
 *      concurrentes sur ce projet, sans bloquer les autres projets).
 *   2. Trouve la plus grande clé existante de la forme "<projectKey>-N"
 *      en extrayant N et en prenant max(N).
 *   3. Renvoie "<projectKey>-{max+1}".
 *
 * Robustesse :
 *   - Résiste aux suppressions de tickets (count(tickets)+1 serait incorrect).
 *   - Résiste aux clés non séquentielles (gaps).
 *   - Résiste aux re-seeds partiels.
 *
 * IMPORTANT : doit être appelée dans une transaction Prisma (le lock advisory
 * xact est libéré automatiquement en fin de transaction).
 */
export async function nextTicketKey(
  tx: Prisma.TransactionClient | PrismaClient,
  projectId: string
): Promise<string> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { key: true },
  });
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // Lock transactionnel sur le projet pour sérialiser les créations concurrentes
  const lockId = hashStringToBigint(projectId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;

  // Cherche la plus grande clé existante de la forme "<projectKey>-N"
  // On extrait le numéro après le dernier "-" et on prend le max.
  // Exemple :
  //   PROJ-RUN-1, PROJ-RUN-2, PROJ-RUN-3 → on veut le dernier "3"
  //   On préfixe la clé du projet avec un échappement LIKE pour éviter qu'un
  //   "_" ou "%" dans le projectKey ne soit interprété.
  const escapedKey = project.key.replace(/[%_]/g, "\\$&");
  const likePattern = `${escapedKey}-%`;

  // Requête : récupère toutes les clés du projet, extrait le suffixe numérique,
  // prend le MAX. NULLIF gère le cas "aucun ticket" → retourne 0.
  const rows = await tx.$queryRaw<Array<{ max_num: number | bigint | null }>>`
    SELECT COALESCE(MAX(
      CAST(
        SUBSTRING(key FROM '[0-9]+$')
        AS INTEGER
      )
    ), 0) AS max_num
    FROM "Ticket"
    WHERE "projectId" = ${projectId}
      AND key LIKE ${likePattern}
      AND key ~ '-[0-9]+$'
  `;

  const maxNum = rows[0]?.max_num;
  const currentMax =
    typeof maxNum === "bigint" ? Number(maxNum) : maxNum ?? 0;

  return `${project.key}-${currentMax + 1}`;
}

/**
 * Hash déterministe string -> bigint (64 bits signé).
 * Utilisé comme identifiant stable pour pg_advisory_xact_lock.
 * NB : pas besoin de qualité crypto ici, juste d'unicité raisonnable.
 */
function hashStringToBigint(s: string): bigint {
  // FNV-1a 64-bit
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  let hash = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    hash ^= BigInt(s.charCodeAt(i));
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
  }
  // Convertit en int64 signé (PostgreSQL utilise bigint signé)
  const signed = hash > 0x7fffffffffffffffn ? hash - 0x10000000000000000n : hash;
  return signed;
}

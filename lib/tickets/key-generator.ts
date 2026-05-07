import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Génère la prochaine clé de ticket unique pour un projet (ex: "PROJ-142").
 *
 * Problème classique : deux utilisateurs créent un ticket en même temps →
 * risque de collision sur la clé.
 *
 * Solution retenue : LOCK PostgreSQL advisory par projet + COUNT + 1.
 * pg_advisory_xact_lock est libéré automatiquement en fin de transaction.
 *
 * Alternative plus scalable : une séquence SQL par projet (à faire si > 100 req/s).
 *
 * IMPORTANT : cette fonction DOIT être appelée à l'intérieur d'une transaction Prisma
 * (pour que pg_advisory_xact_lock soit correctement scopé).
 */
export async function nextTicketKey(
  tx: Prisma.TransactionClient | PrismaClient,
  projectId: string
): Promise<string> {
  // Charge la key du projet (ex: "PROJ") — utilisée pour le préfixe
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { key: true },
  });
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // Hash stable du projectId en bigint pour l'advisory lock
  // (pg_advisory_xact_lock attend un bigint)
  const lockId = hashStringToBigint(projectId);

  // Lock transactionnel : deux appels concurrents sur le même projet
  // se sérialisent. Les autres projets ne sont pas bloqués.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;

  // Compte les tickets existants du projet pour calculer le prochain index
  const count = await tx.ticket.count({ where: { projectId } });
  return `${project.key}-${count + 1}`;
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

/**
 * Helpers pour la gestion de l'identifiant fonctionnel stable d'une Feature.
 *
 * Format : F<numEpic>.<numFeatureDansEpic>
 * Exemples :
 *   - 1ere Feature de l'Epic n°2 : "F02.1"
 *   - 4eme Feature de l'Epic n°2 : "F02.4"
 *   - 12eme Feature de l'Epic n°1 : "F01.12"
 *
 * Les numeros sont paddes a 2 chiffres minimum pour le tri lexical.
 *
 * Cet identifiant est :
 *   - STABLE : ne change jamais une fois attribue
 *   - UNIQUE par projet : sert de cle de doublon pour les re-imports JSON
 *   - INDEPENDANT du titre : permet de renommer une Feature sans casser la tracabilite
 */

import type { PrismaClient, Prisma } from "@prisma/client";

/**
 * Pad un nombre sur 2 chiffres minimum (1 -> "01", 12 -> "12", 100 -> "100").
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Construit un idFeatureSource a partir des numeros d'epic et de feature.
 *   formatFeatureSourceId(2, 4) => "F02.4"
 */
export function formatFeatureSourceId(
  epicNumber: number,
  featureNumber: number
): string {
  return `F${pad2(epicNumber)}.${featureNumber}`;
}

/**
 * Calcule l'idFeatureSource d'une nouvelle Feature etant cree sous un Epic donne.
 *
 * Algorithme :
 *   1. On regarde le rang de l'Epic dans le projet (ordre de creation, 1-indexed)
 *   2. On compte combien de Features existent deja sous cet Epic
 *   3. La nouvelle Feature aura le numero (count + 1)
 *
 * Exemples :
 *   - Premier Epic du projet, premiere Feature : "F01.1"
 *   - Premier Epic du projet, 5e Feature : "F01.5"
 *   - 3e Epic du projet, 1ere Feature : "F03.1"
 *
 * Cette fonction doit etre appelee dans une transaction pour eviter les races.
 */
export async function computeFeatureSourceId(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    projectId: string;
    epicId: string;
  }
): Promise<string> {
  // 1. Rang de l'Epic dans son projet (par ordre de creation)
  // On utilise un raw query car il faut un row_number()
  const epicsOrdered = await tx.ticket.findMany({
    where: {
      projectId: args.projectId,
      type: "EPIC",
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const epicIndex = epicsOrdered.findIndex((e) => e.id === args.epicId);
  const epicNumber = epicIndex >= 0 ? epicIndex + 1 : epicsOrdered.length + 1;

  // 2. Nombre de Features existantes sous cet Epic
  const existingFeaturesCount = await tx.ticket.count({
    where: {
      parentId: args.epicId,
      type: "FEATURE",
    },
  });

  return formatFeatureSourceId(epicNumber, existingFeaturesCount + 1);
}

/**
 * Verifie si un idFeatureSource a un format valide.
 * Utile pour valider les donnees importees depuis un JSON externe.
 */
export function isValidFeatureSourceId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  return /^F\d{2,3}\.\d+$/.test(id);
}

/**
 * Compare deux versions de specs (ex: "retrospec-1" vs "retrospec-2").
 * Retourne :
 *   -1 si a < b
 *    0 si a == b
 *    1 si a > b
 *
 * Strategie : extrait le suffixe numerique pour comparer, fallback comparaison lexicale.
 */
export function compareSpecVersions(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;

  const numA = extractTrailingNumber(a);
  const numB = extractTrailingNumber(b);

  if (numA !== null && numB !== null) {
    return numA - numB;
  }

  // Fallback lexical
  return a < b ? -1 : a > b ? 1 : 0;
}

function extractTrailingNumber(s: string): number | null {
  const m = s.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

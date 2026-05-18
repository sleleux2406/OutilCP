import type { Prisma } from "@prisma/client";
import { TicketStatus, TicketType } from "@prisma/client";
import { nextTicketKey } from "@/lib/tickets/key-generator";
import { buildPath } from "@/lib/tickets/path";

export interface CreatedBugInfo {
  id: string;
  key: string;
  title: string;
  parentKey: string;
  url: string;
}

interface CreateFromKoInput {
  sourceTicketId: string;
  testExecutionId: string;
  testCaseTitle: string;
  comment: string;
  screenshotUrl: string | null;
  executedAt: Date;
  testerId: string;
  testerName: string;
}

/**
 * Crée automatiquement un BUG enfant du ticket testé suite à un KO, et passe
 * le ticket source en statut BLOCKED.
 *
 * À appeler UNIQUEMENT depuis une transaction Prisma (tx paramètre).
 * Les appelants se chargent de revalidatePath et de la gestion de session.
 *
 * Sécurité :
 *   - Description construite côté serveur uniquement (comment validé en amont) [A03]
 *   - Screenshot stocké comme Attachment avec uploader tracé [A09]
 *   - AuditLog : BUG.AUTO_CREATED + TICKET.BLOCKED_BY_KO
 */
export async function createBugFromKo(
  tx: Prisma.TransactionClient,
  input: CreateFromKoInput
): Promise<CreatedBugInfo> {
  const source = await tx.ticket.findUnique({
    where: { id: input.sourceTicketId },
    select: {
      id: true,
      key: true,
      projectId: true,
      type: true,
      parentId: true,
      path: true,
      versionSpecsCourante: true,
    },
  });
  if (!source) throw new Error("SOURCE_NOT_FOUND");

  // Le bug est rattaché directement au ticket testé (US ou Feature)
  const bugKey = await nextTicketKey(tx, source.projectId);

  // Description construite côté serveur - aucune injection possible ici :
  // - input.comment a été validé par Zod côté Server Action
  // - input.testCaseTitle vient de la BDD (source fiable)
  // - la description est ensuite rendue via react-markdown avec rehype-sanitize [A03]
  const description = [
    `**Bug détecté automatiquement suite à un KO**`,
    ``,
    `- **Ticket source** : ${source.key}`,
    `- **Cas de test** : ${input.testCaseTitle}`,
    `- **Horodatage** : ${input.executedAt.toISOString()}`,
    `- **Testeur** : ${input.testerName}`,
    ``,
    `### Description du problème`,
    input.comment,
    input.screenshotUrl ? `\n### Capture\n![screenshot](${input.screenshotUrl})` : "",
  ].join("\n");

  const bug = await tx.ticket.create({
    data: {
      key: bugKey,
      projectId: source.projectId,
      type: TicketType.BUG,
      title: `[KO] ${input.testCaseTitle}`.slice(0, 200),
      description,
      status: TicketStatus.TODO,
      priority: 2,
      parentId: source.id,
      path: buildPath(source.path, source.id),
      creatorId: input.testerId,
      // Module 1.1 : heritage de la version des specs depuis le ticket source
      // (immuable). Permet de tracer quelles specs ont produit ce bug.
      versionSpecsOriginelle: source.versionSpecsCourante,
    },
  });

  // Si capture → on l'enregistre comme Attachment pour traçabilité
  if (input.screenshotUrl) {
    await tx.attachment.create({
      data: {
        ticketId: bug.id,
        url: input.screenshotUrl,
        mimeType: "image/png",
        sizeBytes: 0, // mis à jour par l'API upload si disponible
        uploadedBy: input.testerId,
      },
    });
  }

  // Lien bidirectionnel avec l'exécution de test
  await tx.testExecution.update({
    where: { id: input.testExecutionId },
    data: { generatedBugId: bug.id },
  });

  // Blocage du ticket testé (exigence métier)
  await tx.ticket.update({
    where: { id: source.id },
    data: { status: TicketStatus.BLOCKED },
  });

  await tx.auditLog.createMany({
    data: [
      {
        userId: input.testerId,
        action: "BUG.AUTO_CREATED",
        entityType: "Ticket",
        entityId: bug.id,
        metadata: {
          sourceTicketId: source.id,
          testExecutionId: input.testExecutionId,
        },
      },
      {
        userId: input.testerId,
        action: "TICKET.BLOCKED_BY_KO",
        entityType: "Ticket",
        entityId: source.id,
        metadata: { bugId: bug.id },
      },
    ],
  });

  return {
    id: bug.id,
    key: bug.key,
    title: bug.title,
    parentKey: source.key,
    url: `/tickets/${bug.key}`,
  };
}

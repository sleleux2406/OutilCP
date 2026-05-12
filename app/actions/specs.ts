"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { TicketStatus, TicketType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { nextTicketKey } from "@/lib/tickets/key-generator";
import { buildPath } from "@/lib/tickets/path";
import {
  parseRetroSpec,
  type ParseResult,
} from "@/lib/specs/parse-retrospec";

// ─────────────────────────────────────────────────────────────
// Server Actions — Upload et création de RUN depuis une rétro-spec
//
// Workflow en 2 étapes :
//   1. previewSpecAction : parse le texte, retourne la preview sans écrire
//   2. createRunFromSpecAction : crée le sous-projet RUN + tous les tickets
//      dans une seule transaction, en se basant sur les éléments validés par
//      l'utilisateur
//
// RBAC : ADMIN + PRODUCT_OWNER uniquement (spec = vision produit)
// ─────────────────────────────────────────────────────────────

const MAX_SPEC_CHARS = 200_000; // ~50 pages, largement suffisant

// ─────────────────────────────────────────────────────────────
// previewSpecAction
// ─────────────────────────────────────────────────────────────

const PreviewSchema = z.object({
  text: z.string().trim().min(1).max(MAX_SPEC_CHARS),
});

export type PreviewResult =
  | {
      ok: true;
      parsed: ParseResult;
    }
  | { ok: false; error: "VALIDATION" | "FORBIDDEN" | "RATE_LIMITED" };

/**
 * Parse un texte de rétro-spec et retourne le résultat structuré.
 * N'écrit rien en base. Utilisé par l'UI pour afficher un aperçu avant
 * confirmation.
 */
export async function previewSpecAction(
  input: z.input<typeof PreviewSchema>
): Promise<PreviewResult> {
  const session = await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  // Rate-limit léger (la preview est légère mais on évite le spam)
  const rl = rateLimit(`spec:preview:${session.userId}`, {
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = PreviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const result = parseRetroSpec(parsed.data.text);
  return { ok: true, parsed: result };
}

// ─────────────────────────────────────────────────────────────
// createRunFromSpecAction
// ─────────────────────────────────────────────────────────────

// Schéma d'entrée : la liste des éléments validés par l'utilisateur
// (après qu'il ait vu la preview et éventuellement décoché des items).
// Tout est revalidé côté serveur pour éviter une injection côté client.

const ScenarioInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  expected: z.string().trim().max(5000),
});

const FeatureInputSchema = z.object({
  code: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional().default(""),
  rules: z.array(z.string().trim().max(2000)).max(50).default([]),
  scenarios: z.array(ScenarioInputSchema).max(100).default([]),
});

const EpicInputSchema = z.object({
  code: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(200),
  features: z.array(FeatureInputSchema).max(100).default([]),
});

const CreateRunSchema = z.object({
  parentProjectId: z.string().cuid(),
  runName: z.string().trim().min(3).max(200),
  epics: z.array(EpicInputSchema).max(50),
});

export type CreateRunResult =
  | {
      ok: true;
      projectKey: string;
      projectId: string;
      counts: { epics: number; features: number; testCases: number };
    }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "PARENT_NOT_FOUND"
        | "EMPTY_SPEC"
        | "RATE_LIMITED";
    };

/**
 * Crée un sous-projet RUN et tous ses tickets dans une seule transaction.
 *
 * Étapes atomiques :
 *   1. Créer le Project enfant (parentProjectId = projet parent)
 *   2. Pour chaque Epic → créer un Ticket EPIC dans ce RUN
 *   3. Pour chaque Feature d'un Epic → créer un Ticket FEATURE rattaché
 *   4. Pour chaque Scénario d'une Feature → créer un TestCase sur la Feature
 *   5. Audit log global de la création
 *
 * Si une étape échoue, tout est rollback (transaction Prisma).
 *
 * Sécurité :
 *   - requireRole ADMIN/PO [A01]
 *   - Rate-limit 5 RUNs / 15 min / user [A07]
 *   - Zod strict sur tous les inputs (bornes + types) [A03]
 *   - Vérification parent projet existe et est un projet racine [A04]
 *   - nextTicketKey atomique via advisory lock (pas de collision) [A08]
 */
export async function createRunFromSpecAction(
  input: z.input<typeof CreateRunSchema>
): Promise<CreateRunResult> {
  const session = await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  // Rate-limit : création de RUN est une action lourde
  const rl = rateLimit(`spec:create-run:${session.userId}`, {
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = CreateRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  if (data.epics.length === 0) {
    return { ok: false, error: "EMPTY_SPEC" };
  }

  // Vérifier que le projet parent existe et est bien un projet racine
  const parent = await prisma.project.findUnique({
    where: { id: data.parentProjectId },
    select: { id: true, key: true, name: true, parentProjectId: true },
  });
  if (!parent) return { ok: false, error: "PARENT_NOT_FOUND" };
  // Règle : on refuse de créer un RUN sur un projet qui est lui-même un RUN
  // (pas d'arborescence de sous-sous-projets)
  if (parent.parentProjectId !== null) {
    return { ok: false, error: "PARENT_NOT_FOUND" };
  }

  // Calculer la clé du nouveau RUN : PARENT-RUN-N
  // N = (nombre de sous-projets RUN existants du parent) + 1
  const existingRuns = await prisma.project.count({
    where: { parentProjectId: parent.id },
  });
  const runKey = `${parent.key}-RUN-${existingRuns + 1}`;

  // Création en transaction atomique
  let createdCounts = { epics: 0, features: 0, testCases: 0 };
  let createdProject: { id: string; key: string } | null = null;

  try {
    createdProject = await prisma.$transaction(async (tx) => {
      // 1. Créer le Project RUN
      const runProject = await tx.project.create({
        data: {
          key: runKey,
          name: data.runName,
          description: `RUN généré depuis une rétro-spec (${data.epics.length} Epics)`,
          parentProjectId: parent.id,
        },
        select: { id: true, key: true },
      });

      // 2-3-4. Créer Epics → Features → TestCases
      for (const epicInput of data.epics) {
        const epicKey = await nextTicketKey(tx, runProject.id);
        const epicTicket = await tx.ticket.create({
          data: {
            key: epicKey,
            projectId: runProject.id,
            type: TicketType.EPIC,
            title: `[${epicInput.code}] ${epicInput.title}`,
            description: null,
            status: TicketStatus.BACKLOG,
            priority: 3,
            parentId: null,
            path: "/",
            creatorId: session.userId,
          },
          select: { id: true, path: true },
        });
        createdCounts.epics += 1;

        const epicChildPath = buildPath(epicTicket.path, epicTicket.id);

        for (const featureInput of epicInput.features) {
          const featureKey = await nextTicketKey(tx, runProject.id);

          // Construire la description Feature à partir des sections parsées
          const descParts: string[] = [];
          if (featureInput.description) {
            descParts.push(`**Description**\n\n${featureInput.description}`);
          }
          if (featureInput.rules.length > 0) {
            descParts.push(
              "**Règles métier & Contraintes**\n\n" +
                featureInput.rules.map((r) => `- ${r}`).join("\n")
            );
          }
          const featureDescription =
            descParts.length > 0 ? descParts.join("\n\n") : null;

          const featureTicket = await tx.ticket.create({
            data: {
              key: featureKey,
              projectId: runProject.id,
              type: TicketType.FEATURE,
              title: `[${featureInput.code}] ${featureInput.title}`,
              description: featureDescription,
              status: TicketStatus.BACKLOG,
              priority: 3,
              parentId: epicTicket.id,
              path: epicChildPath,
              creatorId: session.userId,
            },
            select: { id: true },
          });
          createdCounts.features += 1;

          // TestCases : un par scénario
          for (let i = 0; i < featureInput.scenarios.length; i++) {
            const sc = featureInput.scenarios[i];
            await tx.testCase.create({
              data: {
                ticketId: featureTicket.id,
                order: i + 1,
                title: sc.title,
                preconditions: null,
                steps:
                  "À compléter (étapes de reproduction détaillées à ajouter par le testeur)",
                expected: sc.expected || "(résultat attendu non précisé dans la spec)",
              },
            });
            createdCounts.testCases += 1;
          }
        }
      }

      // 5. Audit log
      await tx.auditLog.create({
        data: {
          userId: session.userId,
          action: "RUN.CREATED_FROM_SPEC",
          entityType: "Project",
          entityId: runProject.id,
          metadata: {
            parentProjectKey: parent.key,
            runKey: runProject.key,
            counts: createdCounts,
          },
        },
      });

      return runProject;
    });
  } catch (error) {
    // Un échec de transaction peut venir d'une contrainte BDD ou d'un crash.
    // Dans tous les cas on renvoie une validation générique (on ne fuite
    // pas les détails internes).
    console.error("[createRunFromSpecAction] transaction failed:", error);
    return { ok: false, error: "VALIDATION" };
  }

  revalidatePath(`/projects/${parent.key}/board`);
  revalidatePath(`/projects/${createdProject.key}/board`);

  return {
    ok: true,
    projectKey: createdProject.key,
    projectId: createdProject.id,
    counts: createdCounts,
  };
}

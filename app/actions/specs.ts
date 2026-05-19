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
import {
  parseRetroSpecMarkdown,
  looksLikeMarkdown,
} from "@/lib/specs/parse-retrospec-md";

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
      /** Format detecte automatiquement : "markdown" ou "text" */
      detectedFormat: "markdown" | "text";
      /** Version extraite du frontmatter Markdown si presente, null sinon */
      detectedVersion: string | null;
    }
  | { ok: false; error: "VALIDATION" | "FORBIDDEN" | "RATE_LIMITED" };

/**
 * Parse un texte de rétro-spec et retourne le résultat structuré.
 * N'écrit rien en base. Utilisé par l'UI pour afficher un aperçu avant
 * confirmation.
 *
 * Auto-detection : si le texte ressemble a du Markdown (contient des headings #),
 * utilise parseRetroSpecMarkdown. Sinon utilise le parseur texte historique.
 * Le frontmatter YAML --- version: xxx --- est extrait automatiquement.
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

  // Auto-detection format : Markdown si contient des headings ATX
  if (looksLikeMarkdown(parsed.data.text)) {
    const mdResult = parseRetroSpecMarkdown(parsed.data.text);
    return {
      ok: true,
      parsed: {
        epics: mdResult.epics,
        orphanFeatures: mdResult.orphanFeatures,
        warnings: mdResult.warnings,
        counts: mdResult.counts,
      },
      detectedFormat: "markdown",
      detectedVersion: mdResult.detectedVersion,
    };
  }

  const result = parseRetroSpec(parsed.data.text);
  return {
    ok: true,
    parsed: result,
    detectedFormat: "text",
    detectedVersion: null,
  };
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
  // Module 1.1 : version des specs (ex: "retrospec-1"). Si non fournie, defaut "v1".
  // Stockee dans versionCreation (immuable) et versionSpecsCourante des Features.
  specVersion: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "Format invalide (lettres, chiffres, ._- uniquement)")
    .default("v1"),
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
      // Module 1.1 : on tient un compteur local par Epic pour generer l'idFeatureSource
      // au format F<epicNum>.<featureNum>. epicNum commence a 1 et incremente par Epic.
      let epicNumber = 0;
      for (const epicInput of data.epics) {
        epicNumber += 1;
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

        let featureNumberInEpic = 0;
        for (const featureInput of epicInput.features) {
          featureNumberInEpic += 1;
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

          // Module 1.1 : idFeatureSource auto-genere et versions
          const idFeatureSource = `F${epicNumber < 10 ? "0" + epicNumber : epicNumber}.${featureNumberInEpic}`;

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
              // Versioning des specs (Module 1.1)
              idFeatureSource,
              versionCreation: data.specVersion,
              versionSpecsCourante: data.specVersion,
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

// ─────────────────────────────────────────────────────────────
// syncRunFromSpecAction (Module 1.2)
//
// Re-import / mise a jour d'un RUN existant depuis une rétro-spec.
//
// Regle d'or anti-doublon : on identifie les Features par leur idFeatureSource
// (ex: "F02.4"), PAS par leur titre. Si l'ID existe deja, on UPDATE le titre,
// la description et la versionSpecsCourante. On ne recree JAMAIS un ticket
// pour un ID deja present.
//
// Pour chaque Feature mise a jour, un commentaire d'audit est ajoute :
//   "[Système] Spécifications mises à jour vers la version {version}"
//
// Les Features qui n'existent pas encore (idFeatureSource non trouve) sont
// CREEES avec versionCreation = nouvelle version.
// ─────────────────────────────────────────────────────────────

const SyncRunSchema = z.object({
  runProjectId: z.string().cuid(),
  specVersion: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/),
  epics: z.array(EpicInputSchema).max(50),
});

export type SyncRunResult =
  | {
      ok: true;
      counts: {
        featuresCreated: number;
        featuresUpdated: number;
        featuresUnchanged: number;
        epicsCreated: number;
        testCasesCreated: number;
      };
    }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "RUN_NOT_FOUND"
        | "NOT_A_RUN"
        | "RATE_LIMITED";
    };

export async function syncRunFromSpecAction(
  input: z.input<typeof SyncRunSchema>
): Promise<SyncRunResult> {
  const session = await requireRole(["ADMIN", "PRODUCT_OWNER"]);

  const rl = rateLimit(`spec:sync-run:${session.userId}`, {
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = SyncRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  const runProject = await prisma.project.findUnique({
    where: { id: data.runProjectId },
    select: {
      id: true,
      key: true,
      parentProjectId: true,
      parentProject: { select: { key: true } },
    },
  });
  if (!runProject) return { ok: false, error: "RUN_NOT_FOUND" };
  if (!runProject.parentProjectId) return { ok: false, error: "NOT_A_RUN" };

  const counts = {
    featuresCreated: 0,
    featuresUpdated: 0,
    featuresUnchanged: 0,
    epicsCreated: 0,
    testCasesCreated: 0,
  };

  try {
    await prisma.$transaction(async (tx) => {
      // Pre-charge tous les Epics existants du RUN par leur "code" extrait du titre
      // [CODE] Title => CODE est utilise comme cle de matching pour les Epics
      const existingEpics = await tx.ticket.findMany({
        where: { projectId: runProject.id, type: TicketType.EPIC },
        select: { id: true, title: true, path: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      // Utilitaire : extrait le code [CODE] d'un titre, ou null si pas de prefix
      const extractCode = (title: string): string | null => {
        const m = title.match(/^\[([^\]]+)\]/);
        return m ? m[1] : null;
      };

      const epicByCode = new Map<string, (typeof existingEpics)[number]>();
      for (const e of existingEpics) {
        const code = extractCode(e.title);
        if (code) epicByCode.set(code, e);
      }

      let epicNumber = existingEpics.length;

      for (const epicInput of data.epics) {
        let epic = epicByCode.get(epicInput.code);
        let epicChildPath: string;

        if (!epic) {
          // Creation d'un nouveau Epic
          epicNumber += 1;
          const epicKey = await nextTicketKey(tx, runProject.id);
          const created = await tx.ticket.create({
            data: {
              key: epicKey,
              projectId: runProject.id,
              type: TicketType.EPIC,
              title: `[${epicInput.code}] ${epicInput.title}`,
              status: TicketStatus.BACKLOG,
              priority: 3,
              parentId: null,
              path: "/",
              creatorId: session.userId,
            },
            select: { id: true, path: true, title: true, createdAt: true },
          });
          epic = created;
          epicByCode.set(epicInput.code, created);
          counts.epicsCreated += 1;
          epicChildPath = buildPath(created.path, created.id);
        } else {
          epicChildPath = buildPath(epic.path, epic.id);
        }

        // Pre-charge les Features deja presentes sous cet Epic, indexees par idFeatureSource
        const existingFeatures = await tx.ticket.findMany({
          where: { parentId: epic.id, type: TicketType.FEATURE },
          select: {
            id: true,
            title: true,
            description: true,
            idFeatureSource: true,
            versionSpecsCourante: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        });

        // Compteur de Features deja existantes pour generer l'idFeatureSource des nouvelles
        let featureNumberInEpic = existingFeatures.length;
        const featureByIdSource = new Map<string, (typeof existingFeatures)[number]>();
        for (const f of existingFeatures) {
          if (f.idFeatureSource) featureByIdSource.set(f.idFeatureSource, f);
        }

        // Position de l'epic dans le projet pour le format FXX.Y
        // Note : on utilise epicNumber qui suit l'ordre de creation
        const epicIndex =
          existingEpics.findIndex((e) => e.id === epic!.id) >= 0
            ? existingEpics.findIndex((e) => e.id === epic!.id) + 1
            : epicNumber;

        let featureLocalIdx = 0;
        for (const featureInput of epicInput.features) {
          featureLocalIdx += 1;

          // Construire la description Feature
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

          // L'idFeatureSource attendu pour cette Feature SI elle etait creee
          // selon sa position. Mais pour matcher : on regarde d'abord si une
          // Feature avec ce code (extrait du titre [CODE]) existe deja.
          // Strategie : on essaie de matcher avec une Feature existante par
          // le code [XXX] dans le titre OU par idFeatureSource calcule.
          const expectedIdFeatureSource = `F${epicIndex < 10 ? "0" + epicIndex : epicIndex}.${featureLocalIdx}`;

          // 1. Match par idFeatureSource calcule (priorite haute)
          let matchedFeature = featureByIdSource.get(expectedIdFeatureSource);

          // 2. Si pas trouve, match par code [XXX] dans le titre
          if (!matchedFeature) {
            matchedFeature = existingFeatures.find(
              (f) => extractCode(f.title) === featureInput.code
            );
          }

          if (matchedFeature) {
            // UPDATE de la Feature existante
            const newTitle = `[${featureInput.code}] ${featureInput.title}`;
            const newVersion = data.specVersion;
            const previousVersion = matchedFeature.versionSpecsCourante;

            const titleChanged = newTitle !== matchedFeature.title;
            const descriptionChanged = featureDescription !== matchedFeature.description;
            const versionChanged = newVersion !== previousVersion;

            if (titleChanged || descriptionChanged || versionChanged) {
              await tx.ticket.update({
                where: { id: matchedFeature.id },
                data: {
                  title: newTitle,
                  description: featureDescription,
                  versionSpecsCourante: newVersion,
                  // Garantit que idFeatureSource est rempli (peut manquer pour anciens tickets)
                  idFeatureSource:
                    matchedFeature.idFeatureSource ?? expectedIdFeatureSource,
                },
              });

              // Commentaire d'audit automatique (Module 1.2)
              if (versionChanged) {
                await tx.auditLog.create({
                  data: {
                    userId: session.userId,
                    action: "FEATURE.SPECS_UPDATED",
                    entityType: "Ticket",
                    entityId: matchedFeature.id,
                    metadata: {
                      idFeatureSource:
                        matchedFeature.idFeatureSource ?? expectedIdFeatureSource,
                      previousVersion,
                      newVersion,
                      message: `[Système] Spécifications mises à jour vers la version ${newVersion}`,
                    },
                  },
                });
              }

              counts.featuresUpdated += 1;
            } else {
              counts.featuresUnchanged += 1;
            }

            // Synchronise les TestCases : ajoute les nouveaux scenarios
            // (on ne supprime pas les TestCases existants pour preserver l'historique)
            const existingCases = await tx.testCase.findMany({
              where: { ticketId: matchedFeature.id },
              select: { title: true },
            });
            const existingCaseTitles = new Set(existingCases.map((c) => c.title));
            for (let i = 0; i < featureInput.scenarios.length; i++) {
              const sc = featureInput.scenarios[i];
              if (!existingCaseTitles.has(sc.title)) {
                await tx.testCase.create({
                  data: {
                    ticketId: matchedFeature.id,
                    order: existingCases.length + i + 1,
                    title: sc.title,
                    preconditions: null,
                    steps:
                      "À compléter (étapes de reproduction détaillées à ajouter par le testeur)",
                    expected:
                      sc.expected || "(résultat attendu non précisé dans la spec)",
                  },
                });
                counts.testCasesCreated += 1;
              }
            }
          } else {
            // CREATION d'une nouvelle Feature
            featureNumberInEpic += 1;
            const featureKey = await nextTicketKey(tx, runProject.id);
            const newIdFeatureSource = `F${epicIndex < 10 ? "0" + epicIndex : epicIndex}.${featureNumberInEpic}`;

            const created = await tx.ticket.create({
              data: {
                key: featureKey,
                projectId: runProject.id,
                type: TicketType.FEATURE,
                title: `[${featureInput.code}] ${featureInput.title}`,
                description: featureDescription,
                status: TicketStatus.BACKLOG,
                priority: 3,
                parentId: epic.id,
                path: epicChildPath,
                creatorId: session.userId,
                idFeatureSource: newIdFeatureSource,
                versionCreation: data.specVersion,
                versionSpecsCourante: data.specVersion,
              },
              select: { id: true },
            });

            // TestCases pour la nouvelle Feature
            for (let i = 0; i < featureInput.scenarios.length; i++) {
              const sc = featureInput.scenarios[i];
              await tx.testCase.create({
                data: {
                  ticketId: created.id,
                  order: i + 1,
                  title: sc.title,
                  preconditions: null,
                  steps:
                    "À compléter (étapes de reproduction détaillées à ajouter par le testeur)",
                  expected:
                    sc.expected || "(résultat attendu non précisé dans la spec)",
                },
              });
              counts.testCasesCreated += 1;
            }

            counts.featuresCreated += 1;
          }
        }
      }

      // Audit log global
      await tx.auditLog.create({
        data: {
          userId: session.userId,
          action: "RUN.SYNCED_FROM_SPEC",
          entityType: "Project",
          entityId: runProject.id,
          metadata: {
            runKey: runProject.key,
            specVersion: data.specVersion,
            counts,
          },
        },
      });
    });
  } catch (error) {
    console.error("[syncRunFromSpecAction] transaction failed:", error);
    return { ok: false, error: "VALIDATION" };
  }

  revalidatePath(`/projects/${runProject.key}/board`);
  if (runProject.parentProject) {
    revalidatePath(`/projects/${runProject.parentProject.key}/board`);
  }

  return { ok: true, counts };
}

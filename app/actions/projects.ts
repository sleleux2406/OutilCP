"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────
// createProjectAction
// Cree un nouveau projet racine (sans parentProjectId).
// Reserve aux ADMIN. Le PRODUCT_OWNER peut creer des RUN sub-projects
// via createRunFromSpecAction, mais pas des projets racine.
// ─────────────────────────────────────────────────────────────

const CreateProjectSchema = z.object({
  // Nom lisible : 3 a 100 caracteres
  name: z.string().trim().min(3).max(100),
  // Cle unique : 2 a 10 caracteres majuscules + chiffres + tirets autorises
  // Pattern stricte pour eviter problemes d'URL et collision avec RUN-N
  key: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(10)
    .regex(/^[A-Z][A-Z0-9]*$/, "La cle doit commencer par une lettre majuscule et ne contenir que des lettres et chiffres"),
  description: z.string().trim().max(500).optional(),
});

export type CreateProjectResult =
  | { ok: true; projectId: string; projectKey: string }
  | {
      ok: false;
      error:
        | "VALIDATION"
        | "FORBIDDEN"
        | "DUPLICATE_KEY"
        | "RATE_LIMITED";
    };

export async function createProjectAction(
  input: z.input<typeof CreateProjectSchema>
): Promise<CreateProjectResult> {
  // Reserve a ADMIN : la creation de projet racine est une action sensible
  const session = await requireRole(["ADMIN"]);

  // Rate limit : 10 creations / 15 minutes
  const rl = rateLimit(`project:create:${session.userId}`, {
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!rl.allowed) return { ok: false, error: "RATE_LIMITED" };

  const parsed = CreateProjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  const data = parsed.data;

  // Verifie l'unicite de la cle (case-insensitive grace au toUpperCase du schema)
  const existing = await prisma.project.findUnique({
    where: { key: data.key },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "DUPLICATE_KEY" };

  // Creation atomique + audit
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        key: data.key,
        name: data.name,
        description: data.description,
        // parentProjectId reste null : c'est un projet racine
      },
      select: { id: true, key: true },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId,
        action: "PROJECT.CREATED",
        entityType: "Project",
        entityId: created.id,
        metadata: {
          projectKey: created.key,
          projectName: data.name,
        },
      },
    });

    return created;
  });

  // Invalide la liste des projets et le pilotage
  revalidatePath("/");
  revalidatePath("/pilotage");

  return { ok: true, projectId: project.id, projectKey: project.key };
}

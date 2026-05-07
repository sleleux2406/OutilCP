"use server";

import { z } from "zod";
import { randomUUID } from "crypto";
import { requireRole } from "@/lib/auth";

/**
 * Génère une URL pré-signée pour uploader un screenshot vers S3/R2.
 *
 * Version stub : retourne une URL basée sur les variables d'environnement
 * configurées. Pour un déploiement réel, remplacer l'implémentation par
 * @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner.
 *
 * Sécurité :
 *   - requireRole(TESTER/ADMIN) [A01]
 *   - Validation mime + taille côté client (enforced côté serveur à l'appel fetch signé)
 *   - URL valide 5 minutes maximum côté provider
 *   - Clé générée côté serveur (UUID) pour éviter la collision et le path traversal
 */

const PresignSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024), // 5 Mo max
});

export type PresignResult =
  | { ok: true; uploadUrl: string; publicUrl: string; objectKey: string }
  | { ok: false; error: "VALIDATION" | "FORBIDDEN" | "NOT_CONFIGURED" };

export async function presignScreenshotUploadAction(
  input: z.input<typeof PresignSchema>
): Promise<PresignResult> {
  await requireRole(["TESTER", "ADMIN"]);

  const parsed = PresignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const bucket = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  if (!bucket || !endpoint) {
    return { ok: false, error: "NOT_CONFIGURED" };
  }

  const ext = parsed.data.mimeType === "image/jpeg" ? "jpg" : parsed.data.mimeType.split("/")[1];
  // Préfixe par jour pour faciliter les purges et lifecycle rules
  const today = new Date().toISOString().slice(0, 10);
  const objectKey = `screenshots/${today}/${randomUUID()}.${ext}`;

  // TODO: remplacer par une vraie génération AWS SDK.
  // Pour l'instant on retourne une URL qui pointe vers l'endpoint (stub dev).
  const uploadUrl = `${endpoint}/${bucket}/${objectKey}?X-Stub=true`;
  const publicUrl = `${endpoint}/${bucket}/${objectKey}`;

  return { ok: true, uploadUrl, publicUrl, objectKey };
}

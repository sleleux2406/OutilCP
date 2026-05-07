"use client";

import { presignScreenshotUploadAction } from "@/app/actions/uploads";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024;

/**
 * Upload une capture d'écran via URL pré-signée.
 * Retourne l'URL publique finale (à passer à recordTestExecutionAction).
 */
export async function uploadScreenshot(file: File): Promise<string | null> {
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error("Format non supporté (PNG, JPEG, WebP uniquement)");
  }
  if (file.size > MAX_SIZE) {
    throw new Error("Fichier trop volumineux (max 5 Mo)");
  }

  const res = await presignScreenshotUploadAction({
    mimeType: file.type as "image/png" | "image/jpeg" | "image/webp",
    sizeBytes: file.size,
  });
  if (!res.ok) {
    if (res.error === "NOT_CONFIGURED") {
      console.warn("[uploadScreenshot] S3 non configuré — screenshot ignoré");
      return null;
    }
    throw new Error("Upload refusé");
  }

  // Upload direct client → S3/R2 via URL signée (la clé secrète ne transite jamais)
  const uploadResp = await fetch(res.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!uploadResp.ok) {
    throw new Error(`Upload échoué (${uploadResp.status})`);
  }

  return res.publicUrl;
}

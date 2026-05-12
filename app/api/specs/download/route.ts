import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { APP_SPECS } from "@/lib/specs/app-specs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Route de téléchargement de la rétro-spécification fonctionnelle de l'app.
 *
 * Sécurité :
 *   - requireAuth via getSession (pas de redirect ici, on renvoie 401 en JSON)
 *   - RBAC : tout rôle SAUF DEVELOPER peut télécharger (la doc contient des
 *     détails sur le modèle de sécurité, rate limits, etc. qu'on ne veut pas
 *     exposer aux devs internes comme donnée de référence "officielle")
 *   - Content-Type application/json + header Content-Disposition pour
 *     déclencher un download côté navigateur plutôt qu'un affichage
 *   - Audit log : trace chaque téléchargement (utile pour compliance)
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // RBAC : DEV refusé, autres rôles acceptés
  if (session.role === "DEVELOPER") {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
  }

  // Audit best-effort (non bloquant)
  prisma.auditLog
    .create({
      data: {
        userId: session.userId,
        action: "SPECS.DOWNLOADED",
        entityType: "AppSpecs",
        entityId: "retrospec",
        metadata: { role: session.role },
      },
    })
    .catch(() => {
      // On ne bloque pas le téléchargement si l'audit log échoue
    });

  // Sérialisation avec indentation pour lisibilité humaine
  const json = JSON.stringify(APP_SPECS, null, 2);
  const filename = `qa-platform-specs-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Pas de cache : le fichier peut évoluer à chaque déploiement
      "Cache-Control": "no-store",
    },
  });
}
